package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
)

type fakeEventTournaments struct {
	calls   []string
	created bool
}

func (f *fakeEventTournaments) PutTournament(_ context.Context, input eventstore.TournamentInput) (eventstore.Tournament, bool, error) {
	f.calls = append(f.calls, fmt.Sprintf("put %s %s %s %s size=%d subs=%d cap=%d closes=%s format=%q rules=%q",
		input.Slug, input.EditorUserID, input.GameID, input.EntryType, *input.TeamSize, input.Substitutes,
		*input.EntrantCap, input.RegistrationClosesAt.UTC().Format(time.RFC3339), input.Format, input.Rules))
	return eventstore.Tournament{EntryType: input.EntryType, Status: eventstore.TournamentDraft}, f.created, nil
}

func (f *fakeEventTournaments) DeleteTournament(_ context.Context, slug string, userID string) error {
	f.calls = append(f.calls, "delete "+slug+" "+userID)
	return eventstore.ErrTournamentLocked
}

func (f *fakeEventTournaments) SetTournamentStatus(_ context.Context, slug string, userID string, status string) (eventstore.Tournament, error) {
	f.calls = append(f.calls, "status "+slug+" "+userID+" "+status)
	return eventstore.Tournament{Status: status}, nil
}

func tournamentRouter(store *fakeEventTournaments, events *fakeEventRepository) http.Handler {
	router := &Router{
		cfg:         config.Config{SessionCookie: "session", SessionTTL: time.Hour},
		events:      events,
		tournaments: store,
	}
	sessions := fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}}
	return auth.WithSession(sessions, auth.SessionCookieConfig{Name: "session", TTL: time.Hour})(router.eventRoutes())
}

func TestTournamentRoutesReachTheStoreAsTheSignedInUser(t *testing.T) {
	store := &fakeEventTournaments{}
	handler := tournamentRouter(store, &fakeEventRepository{})
	type result struct {
		Status int
		Body   string
	}
	settings := `{"game_id":"game-1","entry_type":"team","team_size":5,"substitutes":1,"entrant_cap":16,` +
		`"registration_closes_at":"2031-06-01T17:00:00Z","rules":"Best of three"}`
	var got []result
	for _, request := range []struct {
		method, target, body string
		created, signedIn    bool
	}{
		{http.MethodPut, "/events/spring-bracket/tournament", settings, true, true},
		{http.MethodPut, "/events/spring-bracket/tournament", settings, false, true},
		{http.MethodPost, "/events/spring-bracket/tournament/status", `{"status":"registration_open"}`, false, true},
		{http.MethodPost, "/events/spring-bracket/tournament/status", `{"status":"finished"}`, false, true},
		{http.MethodDelete, "/events/spring-bracket/tournament", "", false, true},
		{http.MethodPut, "/events/spring-bracket/tournament", `{"bracket":"x"}`, false, true},
		{http.MethodGet, "/events/spring-bracket/tournament", "", false, true},
		{http.MethodPut, "/events/spring-bracket/tournament", settings, false, false},
	} {
		store.created = request.created
		req := httptest.NewRequest(request.method, request.target, strings.NewReader(request.body))
		if request.signedIn {
			req = authenticatedEventRequest(request.method, request.target, request.body)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		got = append(got, result{response.Code, strings.TrimSpace(response.Body.String())})
	}

	draft := `{"game":{"id":"","name":"","slug":"","has_cover":false},"entry_type":"team","substitutes":0,"format":"","rules":"","prizes":"","status":"draft"}`
	want := []result{
		{http.StatusCreated, draft},
		{http.StatusOK, draft},
		{http.StatusOK, `{"game":{"id":"","name":"","slug":"","has_cover":false},"entry_type":"","substitutes":0,"format":"","rules":"","prizes":"","status":"registration_open"}`},
		{http.StatusBadRequest, `{"error":"invalid_tournament_status"}`},
		{http.StatusConflict, `{"error":"tournament_locked"}`},
		{http.StatusBadRequest, `{"error":"invalid_json"}`},
		{http.StatusMethodNotAllowed, `{"error":"method_not_allowed"}`},
		{http.StatusUnauthorized, `{"error":"authentication_required"}`},
	}
	put := "put spring-bracket " + testUserID + ` game-1 team size=5 subs=1 cap=16 closes=2031-06-01T17:00:00Z format="" rules="Best of three"`
	wantCalls := []string{
		put,
		put,
		"status spring-bracket " + testUserID + " registration_open",
		"delete spring-bracket " + testUserID,
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(store.calls, wantCalls) {
		t.Fatalf("results = %+v\ncalls = %q\nwant %+v\nand %q", got, store.calls, want, wantCalls)
	}
}

func TestEventDetailShowsADraftTournamentToOrganizersOnly(t *testing.T) {
	visible := map[string]bool{}
	for _, viewer := range []struct {
		name               string
		organizer, session bool
		status             string
	}{
		{"organizer, draft", true, true, eventstore.TournamentDraft},
		{"member, draft", false, true, eventstore.TournamentDraft},
		{"signed out, draft", false, false, eventstore.TournamentDraft},
		{"signed out, open", false, false, eventstore.TournamentRegistrationOpen},
	} {
		events := &fakeEventRepository{
			detail: eventstore.Event{
				Slug:       "spring-bracket",
				Visibility: eventstore.VisibilityPublic,
				Tournament: &eventstore.Tournament{Status: viewer.status},
			},
			isOrganizer: viewer.organizer,
		}
		req := httptest.NewRequest(http.MethodGet, "/events/spring-bracket", nil)
		if viewer.session {
			req = authenticatedEventRequest(http.MethodGet, "/events/spring-bracket", "")
		}
		response := httptest.NewRecorder()
		tournamentRouter(&fakeEventTournaments{}, events).ServeHTTP(response, req)
		if response.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200", viewer.name, response.Code)
		}
		visible[viewer.name] = strings.Contains(response.Body.String(), `"tournament":`)
	}
	want := map[string]bool{
		"organizer, draft":  true,
		"member, draft":     false,
		"signed out, draft": false,
		"signed out, open":  true,
	}
	if !reflect.DeepEqual(visible, want) {
		t.Fatalf("tournament shown = %v, want %v", visible, want)
	}
}
