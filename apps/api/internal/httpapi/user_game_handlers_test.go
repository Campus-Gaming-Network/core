package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
)

const listedGameID = "44444444-4444-4444-4444-444444444444"

type fakeUserGames struct {
	lists    games.UserLists
	listsFor string
	err      error
	changes  []string
}

func (f *fakeUserGames) UserLists(_ context.Context, userID string) (games.UserLists, error) {
	f.listsFor = userID
	return f.lists, nil
}

func (f *fakeUserGames) AddToList(_ context.Context, userID string, list games.List, gameIDs []string) error {
	f.changes = append(f.changes, "add "+userID+" "+string(list)+" "+strings.Join(gameIDs, ","))
	return f.err
}

func (f *fakeUserGames) RemoveFromLists(_ context.Context, userID, gameID string) error {
	f.changes = append(f.changes, "remove "+userID+" "+gameID)
	return f.err
}

func (f *fakeUserGames) MoveInList(_ context.Context, userID, gameID string, position int) error {
	f.changes = append(f.changes, "move "+userID+" "+gameID+" "+string(rune('0'+position)))
	return f.err
}

func newUserGamesRouter(store *fakeUserGames) http.Handler {
	picker := &fakeGamePicker{}
	router := &Router{
		cfg:         config.Config{SessionCookie: "session", SessionTTL: time.Hour, SiteURL: "https://cgn.example"},
		mux:         http.NewServeMux(),
		userGames:   store,
		picker:      picker,
		customGames: picker,
	}
	router.registerPublicRoutes()
	return auth.WithSession(
		fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(router.mux)
}

func TestUserGameRoutesAddRemoveAndMoveTheViewersGames(t *testing.T) {
	lists := games.UserLists{
		Favorite:   []games.Game{{ID: listedGameID, Name: "Rocket League", Slug: "rocket-league", HasCover: true}},
		Like:       []games.Game{},
		WantToPlay: []games.Game{},
	}
	listsJSON := `{"favorite":[{"id":"` + listedGameID + `","name":"Rocket League","slug":"rocket-league","cover_url":"https://cgn.example/api/games/rocket-league/cover"}],"like":[],"want_to_play":[]}`
	type result struct {
		status  int
		body    string
		changes []string
	}
	tests := []struct {
		name   string
		method string
		path   string
		body   string
		signed bool
		err    error
		want   result
	}{
		{name: "signed out", method: http.MethodGet, path: "/me/games", want: result{status: 401, body: `{"error":"authentication_required"}`}},
		{name: "read", method: http.MethodGet, path: "/me/games", signed: true, want: result{status: 200, body: listsJSON}},
		{
			name: "add picked games", method: http.MethodPost, path: "/me/games", signed: true,
			body: `{"list":"favorite","game_ids":["` + listedGameID + `"],"igdb_game_ids":[1],"other_game":"Campus Kart"}`,
			want: result{status: 200, body: listsJSON, changes: []string{"add " + testUserID + " favorite " + listedGameID + ",igdb-1,typed-game"}},
		},
		{
			name: "unknown list", method: http.MethodPost, path: "/me/games", signed: true,
			body: `{"list":"best","game_ids":["` + listedGameID + `"]}`,
			want: result{status: 400, body: `{"error":"invalid_request"}`},
		},
		{
			name: "no games", method: http.MethodPost, path: "/me/games", signed: true,
			body: `{"list":"like"}`,
			want: result{status: 400, body: `{"error":"invalid_request"}`},
		},
		{
			name: "more than ten games", method: http.MethodPost, path: "/me/games", signed: true,
			body: `{"list":"like","igdb_game_ids":[1,2,3,4,5],"game_ids":["` + strings.Repeat(listedGameID+`","`, 5) + listedGameID + `"]}`,
			want: result{status: 400, body: `{"error":"invalid_request"}`},
		},
		{
			name: "sixth favorite", method: http.MethodPost, path: "/me/games", signed: true, err: games.ErrFavoritesFull,
			body: `{"list":"favorite","game_ids":["` + listedGameID + `"]}`,
			want: result{status: 409, body: `{"error":"favorite_games_full"}`, changes: []string{"add " + testUserID + " favorite " + listedGameID}},
		},
		{
			name: "remove", method: http.MethodDelete, path: "/me/games/" + listedGameID, signed: true,
			want: result{status: 200, body: listsJSON, changes: []string{"remove " + testUserID + " " + listedGameID}},
		},
		{
			name: "remove an unlisted game", method: http.MethodDelete, path: "/me/games/" + listedGameID, signed: true, err: games.ErrListedGameNotFound,
			want: result{status: 404, body: `{"error":"listed_game_not_found"}`, changes: []string{"remove " + testUserID + " " + listedGameID}},
		},
		{
			name: "remove a malformed ID", method: http.MethodDelete, path: "/me/games/not-a-game", signed: true,
			want: result{status: 400, body: `{"error":"invalid_id"}`},
		},
		{
			name: "move", method: http.MethodPost, path: "/me/games/" + listedGameID + "/position", signed: true,
			body: `{"position":2}`,
			want: result{status: 200, body: listsJSON, changes: []string{"move " + testUserID + " " + listedGameID + " 2"}},
		},
		{
			name: "move without a position", method: http.MethodPost, path: "/me/games/" + listedGameID + "/position", signed: true,
			body: `{}`,
			want: result{status: 400, body: `{"error":"invalid_request"}`},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeUserGames{lists: lists, err: test.err}
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			if test.signed {
				request.AddCookie(&http.Cookie{Name: "session", Value: "raw-token"})
			}
			response := httptest.NewRecorder()
			newUserGamesRouter(store).ServeHTTP(response, request)

			if got := (result{response.Code, strings.TrimSpace(response.Body.String()), store.changes}); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("%s %s = %#v, want %#v", test.method, test.path, got, test.want)
			}
		})
	}
}

func TestPublicProfileShowsTheOwnersGameLists(t *testing.T) {
	store := newProfileFakeUsers(true)
	lists := &fakeUserGames{lists: games.UserLists{
		Favorite:   []games.Game{{ID: listedGameID, Name: "Rocket League", Slug: "rocket-league", HasCover: true}},
		Like:       []games.Game{},
		WantToPlay: []games.Game{{ID: "55555555-5555-5555-5555-555555555555", Name: "Campus Kart", Slug: "campus-kart"}},
	}}
	router := &Router{
		cfg: config.Config{SiteURL: "https://cgn.example"},
		account: auth.NewAccountService(
			store, passV0ContractSchools{}, passV0ContractSessions{}, passV0ContractTokens{},
			time.Hour, time.Hour, time.Hour,
		),
		userGames: lists,
	}
	response := httptest.NewRecorder()
	router.handleUserPath(response, httptest.NewRequest(http.MethodGet, "/users/"+testUserPublicID, nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	var got publicProfileResponse
	if err := json.NewDecoder(response.Body).Decode(&got); err != nil {
		t.Fatalf("decode profile: %v", err)
	}
	want := publicProfileResponse{
		PublicProfile: store.profile.Public(),
		Games: games.UserLists{
			Favorite:   []games.Game{{ID: listedGameID, Name: "Rocket League", Slug: "rocket-league", CoverURL: "https://cgn.example/api/games/rocket-league/cover"}},
			Like:       []games.Game{},
			WantToPlay: []games.Game{{ID: "55555555-5555-5555-5555-555555555555", Name: "Campus Kart", Slug: "campus-kart"}},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("profile = %#v, want %#v", got, want)
	}
	if lists.listsFor != testUserID {
		t.Fatalf("game lists read for %q, want the internal ID %q", lists.listsFor, testUserID)
	}
}

// A profile URL names the user by public ID. The internal UUID is not a
// profile address.
func TestPublicProfileRejectsTheInternalID(t *testing.T) {
	router := &Router{account: auth.NewAccountService(
		newProfileFakeUsers(true), passV0ContractSchools{}, passV0ContractSessions{}, passV0ContractTokens{},
		time.Hour, time.Hour, time.Hour,
	)}
	response := httptest.NewRecorder()
	router.handleUserPath(response, httptest.NewRequest(http.MethodGet, "/users/"+testUserID, nil))

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_id") {
		t.Fatalf("status = %d; body = %s; want 400 invalid_id", response.Code, response.Body.String())
	}
}
