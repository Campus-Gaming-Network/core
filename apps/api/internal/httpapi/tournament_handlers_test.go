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
	f.calls = append(f.calls, fmt.Sprintf("put %s %s %s %s size=%d subs=%d cap=%d closes=%s format=%q rules=%q bracket=%q mode=%q",
		input.Slug, input.EditorUserID, input.GameID, input.EntryType, *input.TeamSize, input.Substitutes,
		*input.EntrantCap, input.RegistrationClosesAt.UTC().Format(time.RFC3339), input.Format, input.Rules, input.BracketURL, input.RegistrationMode))
	return eventstore.Tournament{EntryType: input.EntryType, RegistrationMode: input.RegistrationMode, Status: eventstore.TournamentDraft}, f.created, nil
}

func (f *fakeEventTournaments) DeleteTournament(_ context.Context, slug string, userID string) error {
	f.calls = append(f.calls, "delete "+slug+" "+userID)
	return eventstore.ErrTournamentLocked
}

func (f *fakeEventTournaments) SetTournamentStatus(_ context.Context, slug string, userID string, status string) (eventstore.Tournament, error) {
	f.calls = append(f.calls, "status "+slug+" "+userID+" "+status)
	return eventstore.Tournament{RegistrationMode: eventstore.RegistrationOpenMode, Status: status}, nil
}

func (f *fakeEventTournaments) Register(_ context.Context, input eventstore.RegisterInput) (eventstore.TournamentEntry, error) {
	f.calls = append(f.calls, fmt.Sprintf("register %s %s team=%q roster=%q", input.Slug, input.UserID, input.TeamSlug, input.Roster))
	return eventstore.TournamentEntry{ID: "entry-1", Status: eventstore.EntryPending}, nil
}

func (f *fakeEventTournaments) UpdateRoster(_ context.Context, slug string, userID string, entryID string, roster []string) (eventstore.TournamentEntry, error) {
	f.calls = append(f.calls, fmt.Sprintf("roster %s %s %s %q", slug, userID, entryID, roster))
	return eventstore.TournamentEntry{ID: entryID, Status: eventstore.EntryRegistered, Seed: 1}, nil
}

func (f *fakeEventTournaments) DecideEntry(_ context.Context, slug string, userID string, entryID string, approve bool) (eventstore.TournamentEntry, error) {
	f.calls = append(f.calls, fmt.Sprintf("decide %s %s %s approve=%t", slug, userID, entryID, approve))
	if !approve {
		return eventstore.TournamentEntry{}, eventstore.ErrEntryNotPending
	}
	return eventstore.TournamentEntry{ID: entryID, Status: eventstore.EntryRegistered, Seed: 3}, nil
}

func (f *fakeEventTournaments) DeleteEntry(_ context.Context, slug string, userID string, entryID string) error {
	f.calls = append(f.calls, "delete entry "+slug+" "+userID+" "+entryID)
	return nil
}

// ListEntries treats the signed-in test user as an organizer, who also gets
// the pending requests.
func (f *fakeEventTournaments) ListEntries(_ context.Context, slug string, userID string) ([]eventstore.TournamentEntry, []eventstore.TournamentEntry, error) {
	f.calls = append(f.calls, fmt.Sprintf("list %s %q", slug, userID))
	entries := []eventstore.TournamentEntry{
		{ID: "entry-1", Status: eventstore.EntryRegistered, Seed: 1, Player: &eventstore.EntryPlayer{PublicID: "p1", Name: "Ada"}},
		{ID: "entry-2", Status: eventstore.EntryRegistered, Seed: 2, Team: &eventstore.TeamSummary{Name: "Knights", Slug: "knights"},
			Roster: []eventstore.EntryPlayer{{PublicID: "p2", Name: "Bo"}}},
	}
	if userID == "" {
		return entries, nil, nil
	}
	return entries, []eventstore.TournamentEntry{
		{ID: "entry-3", Status: eventstore.EntryPending, Player: &eventstore.EntryPlayer{PublicID: "p3", Name: "Cy"}},
	}, nil
}

func (f *fakeEventTournaments) ViewerEntry(_ context.Context, slug string, userID string) (*eventstore.ViewerEntry, error) {
	f.calls = append(f.calls, "viewer "+slug+" "+userID)
	return &eventstore.ViewerEntry{ID: "entry-1", CanManage: true}, nil
}

func (f *fakeEventTournaments) RegistrationTeams(_ context.Context, slug string, userID string) ([]eventstore.RegistrationTeam, error) {
	f.calls = append(f.calls, "teams "+slug+" "+userID)
	return []eventstore.RegistrationTeam{}, nil
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
		`"registration_closes_at":"2031-06-01T17:00:00Z","rules":"Best of three","bracket_url":"https://challonge.com/spring","registration_mode":"approval"}`
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

	draft := `{"game":{"id":"","name":"","slug":"","has_cover":false},"entry_type":"team","substitutes":0,"format":"","rules":"","prizes":"","registration_mode":"approval","status":"draft","entry_count":0}`
	want := []result{
		{http.StatusCreated, draft},
		{http.StatusOK, draft},
		{http.StatusOK, `{"game":{"id":"","name":"","slug":"","has_cover":false},"entry_type":"","substitutes":0,"format":"","rules":"","prizes":"","registration_mode":"open","status":"registration_open","entry_count":0}`},
		{http.StatusBadRequest, `{"error":"invalid_tournament_status"}`},
		{http.StatusConflict, `{"error":"tournament_locked"}`},
		{http.StatusBadRequest, `{"error":"invalid_json"}`},
		{http.StatusMethodNotAllowed, `{"error":"method_not_allowed"}`},
		{http.StatusUnauthorized, `{"error":"authentication_required"}`},
	}
	put := "put spring-bracket " + testUserID + ` game-1 team size=5 subs=1 cap=16 closes=2031-06-01T17:00:00Z format="" rules="Best of three" bracket="https://challonge.com/spring" mode="approval"`
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

func TestTournamentEntryRoutes(t *testing.T) {
	const entryID = "22222222-2222-4222-8222-222222222222"
	store := &fakeEventTournaments{}
	public := &fakeEventRepository{detail: eventstore.Event{Slug: "spring-bracket", Visibility: eventstore.VisibilityPublic}}
	private := &fakeEventRepository{detail: eventstore.Event{Slug: "spring-bracket", Visibility: eventstore.VisibilityPrivate}}
	type result struct {
		Status int
		Body   string
	}
	var got []result
	for _, request := range []struct {
		method, target, body string
		events               *fakeEventRepository
		signedIn             bool
	}{
		{http.MethodGet, "/events/spring-bracket/tournament/entries", "", public, false},
		{http.MethodGet, "/events/spring-bracket/tournament/entries", "", public, true},
		{http.MethodPost, "/events/spring-bracket/tournament/entries", `{"team_slug":"knights","roster":["p1","p2"]}`, public, true},
		{http.MethodPost, "/events/spring-bracket/tournament/entries", `{}`, private, true},
		{http.MethodPatch, "/events/spring-bracket/tournament/entries/" + entryID, `{"roster":["p1"]}`, public, true},
		{http.MethodDelete, "/events/spring-bracket/tournament/entries/" + entryID, "", public, true},
		{http.MethodDelete, "/events/spring-bracket/tournament/entries/not-an-id", "", public, true},
		{http.MethodGet, "/events/spring-bracket/tournament/my-teams", "", public, true},
		{http.MethodPost, "/events/spring-bracket/tournament/entries", `{}`, public, false},
		{http.MethodPost, "/events/spring-bracket/tournament/entries/" + entryID + "/approve", "", public, true},
		{http.MethodPost, "/events/spring-bracket/tournament/entries/" + entryID + "/decline", "", public, true},
		{http.MethodPost, "/events/spring-bracket/tournament/entries/not-an-id/approve", "", public, true},
		{http.MethodPost, "/events/spring-bracket/tournament/entries/" + entryID + "/approve", "", public, false},
	} {
		req := httptest.NewRequest(request.method, request.target, strings.NewReader(request.body))
		if request.signedIn {
			req = authenticatedEventRequest(request.method, request.target, request.body)
		}
		response := httptest.NewRecorder()
		tournamentRouter(store, request.events).ServeHTTP(response, req)
		got = append(got, result{response.Code, strings.TrimSpace(response.Body.String())})
	}

	signedOut := `{"entries":[{"id":"entry-1","status":"registered","seed":1,"registered_at":"0001-01-01T00:00:00Z"},` +
		`{"id":"entry-2","status":"registered","seed":2,"team":{"id":"","name":"Knights","slug":"knights"},"registered_at":"0001-01-01T00:00:00Z"}]}`
	signedIn := `{"entries":[{"id":"entry-1","status":"registered","seed":1,"player":{"public_id":"p1","name":"Ada"},"registered_at":"0001-01-01T00:00:00Z"},` +
		`{"id":"entry-2","status":"registered","seed":2,"team":{"id":"","name":"Knights","slug":"knights"},"roster":[{"public_id":"p2","name":"Bo"}],"registered_at":"0001-01-01T00:00:00Z"}],` +
		`"requests":[{"id":"entry-3","status":"pending","player":{"public_id":"p3","name":"Cy"},"registered_at":"0001-01-01T00:00:00Z"}]}`
	want := []result{
		{http.StatusOK, signedOut},
		{http.StatusOK, signedIn},
		{http.StatusCreated, `{"id":"entry-1","status":"pending","registered_at":"0001-01-01T00:00:00Z"}`},
		{http.StatusForbidden, `{"error":"private_event_locked"}`},
		{http.StatusOK, `{"id":"` + entryID + `","status":"registered","seed":1,"registered_at":"0001-01-01T00:00:00Z"}`},
		{http.StatusNoContent, ""},
		{http.StatusNotFound, `{"error":"tournament_entry_not_found"}`},
		{http.StatusOK, `{"teams":[]}`},
		{http.StatusUnauthorized, `{"error":"authentication_required"}`},
		{http.StatusOK, `{"id":"` + entryID + `","status":"registered","seed":3,"registered_at":"0001-01-01T00:00:00Z"}`},
		{http.StatusConflict, `{"error":"tournament_entry_not_pending"}`},
		{http.StatusNotFound, `{"error":"tournament_entry_not_found"}`},
		{http.StatusUnauthorized, `{"error":"authentication_required"}`},
	}
	wantCalls := []string{
		`list spring-bracket ""`,
		`list spring-bracket "` + testUserID + `"`,
		"register spring-bracket " + testUserID + ` team="knights" roster=["p1" "p2"]`,
		"roster spring-bracket " + testUserID + " " + entryID + ` ["p1"]`,
		"delete entry spring-bracket " + testUserID + " " + entryID,
		"teams spring-bracket " + testUserID,
		"decide spring-bracket " + testUserID + " " + entryID + " approve=true",
		"decide spring-bracket " + testUserID + " " + entryID + " approve=false",
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(store.calls, wantCalls) {
		t.Fatalf("results = %+v\ncalls = %q\nwant %+v\nand %q", got, store.calls, want, wantCalls)
	}
}
