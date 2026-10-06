package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
)

// fakeGamePicker imports any IGDB ID as "igdb-<id>" except 404, which IGDB
// does not know, and stores any typed name as "typed-game".
type fakeGamePicker struct {
	typed []string
}

func (*fakeGamePicker) SearchForPicker(_ context.Context, query string) ([]games.IGDBResult, error) {
	return []games.IGDBResult{{IGDBID: 11198, Name: "Result for " + query, ReleaseYear: 2015}}, nil
}

func (*fakeGamePicker) EnsureFromIGDB(_ context.Context, igdbID int64) (games.AdminGame, error) {
	if igdbID == 404 {
		return games.AdminGame{}, igdb.ErrNotFound
	}
	return games.AdminGame{Game: games.Game{ID: "igdb-" + string(rune('0'+igdbID))}}, nil
}

func (picker *fakeGamePicker) EnsureCustom(_ context.Context, name string) (games.AdminGame, error) {
	picker.typed = append(picker.typed, name)
	return games.AdminGame{Game: games.Game{ID: "typed-game"}}, nil
}

func signedIn(handler http.HandlerFunc) http.Handler {
	store := fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}}
	return auth.WithSession(store, auth.SessionCookieConfig{Name: "session", TTL: time.Hour})(handler)
}

func TestGameSearchNeedsASessionAndIGDBAndIsRateLimited(t *testing.T) {
	picker := &fakeGamePicker{}
	router := &Router{picker: picker, gameSearchLimiter: ratelimit.New(1, time.Minute)}
	type result struct {
		status int
		body   string
	}
	send := func(handler http.Handler, request *http.Request) result {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return result{response.Code, strings.TrimSpace(response.Body.String())}
	}
	search := func() *http.Request {
		return authenticatedEventRequest(http.MethodGet, "/games/igdb-search?q=rocket", "")
	}

	got := []result{
		send(signedIn(router.handleGameSearch), httptest.NewRequest(http.MethodGet, "/games/igdb-search?q=rocket", nil)),
		send(signedIn((&Router{}).handleGameSearch), search()),
		send(signedIn(router.handleGameSearch), search()),
		send(signedIn(router.handleGameSearch), search()),
	}
	want := []result{
		{http.StatusUnauthorized, `{"error":"authentication_required"}`},
		{http.StatusServiceUnavailable, `{"error":"igdb_not_configured"}`},
		{http.StatusOK, `{"games":[{"igdb_id":11198,"name":"Result for rocket","release_year":2015}]}`},
		{http.StatusTooManyRequests, `{"error":"rate_limited"}`},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("responses = %+v, want %+v", got, want)
	}
}

func TestCreateEventResolvesPickedAndTypedGames(t *testing.T) {
	body := func(extra string) string {
		return strings.Replace(validCreateEventJSON("public", ""), `"game_ids":["44444444-4444-4444-4444-444444444444"],`, extra, 1)
	}
	for _, test := range []struct {
		name        string
		games       string
		status      int
		wantGameIDs []string
		wantTyped   []string
	}{
		{
			name:        "catalog, IGDB, and typed games together",
			games:       `"game_ids":["44444444-4444-4444-4444-444444444444"],"igdb_game_ids":[7],"other_game":"  Campus Trivia  ",`,
			status:      http.StatusCreated,
			wantGameIDs: []string{"44444444-4444-4444-4444-444444444444", "igdb-7", "typed-game"},
			wantTyped:   []string{"Campus Trivia"},
		},
		{
			name:        "a typed game alone is enough",
			games:       `"other_game":"Campus Trivia",`,
			status:      http.StatusCreated,
			wantGameIDs: []string{"typed-game"},
			wantTyped:   []string{"Campus Trivia"},
		},
		{name: "no game at all", games: ``, status: http.StatusBadRequest},
		{name: "a game IGDB does not know", games: `"igdb_game_ids":[404],`, status: http.StatusUnprocessableEntity},
		{name: "too many IGDB games", games: `"igdb_game_ids":[1,2,3,4,5,6],`, status: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &fakeEventRepository{}
			picker := &fakeGamePicker{}
			router := &Router{events: repository, picker: picker, customGames: picker}
			response := httptest.NewRecorder()
			signedIn(router.handleEvents).ServeHTTP(response, withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", body(test.games))))

			if response.Code != test.status || !reflect.DeepEqual(repository.createParams.GameIDs, test.wantGameIDs) || !reflect.DeepEqual(picker.typed, test.wantTyped) {
				t.Fatalf("status = %d, game IDs = %v, typed = %v; want %d, %v, %v: %s",
					response.Code, repository.createParams.GameIDs, picker.typed, test.status, test.wantGameIDs, test.wantTyped, response.Body.String())
			}
		})
	}
}
