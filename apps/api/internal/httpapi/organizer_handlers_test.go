package httpapi

import (
	"context"
	"encoding/json"
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

const organizerTestUserID = "55555555-5555-4555-8555-555555555555"

type fakeEventOrganizers struct {
	calls []string
	err   error
}

func (f *fakeEventOrganizers) InviteOrganizer(_ context.Context, params eventstore.OrganizerInviteParams) (eventstore.OrganizerInvite, error) {
	f.calls = append(f.calls, fmt.Sprintf("invite %s %s %s token=%t", params.Slug, params.CreatorUserID, params.Email,
		params.RawToken != "" && reflect.DeepEqual(auth.HashToken(params.RawToken), params.TokenHash)))
	return eventstore.OrganizerInvite{ID: "invite-1", Email: params.Email}, f.err
}

func (f *fakeEventOrganizers) ListOrganizerInvites(_ context.Context, slug string, creatorUserID string) ([]eventstore.OrganizerInvite, error) {
	f.calls = append(f.calls, "list "+slug+" "+creatorUserID)
	return []eventstore.OrganizerInvite{}, f.err
}

func (f *fakeEventOrganizers) RevokeOrganizerInvite(_ context.Context, slug string, creatorUserID string, inviteID string) error {
	f.calls = append(f.calls, "revoke "+slug+" "+creatorUserID+" "+inviteID)
	return f.err
}

func (f *fakeEventOrganizers) AcceptOrganizerInvite(_ context.Context, tokenHash []byte, userID string) (string, error) {
	f.calls = append(f.calls, fmt.Sprintf("accept %t %s", reflect.DeepEqual(tokenHash, auth.HashToken("raw-invite")), userID))
	return "campus-chess", f.err
}

func (f *fakeEventOrganizers) RemoveOrganizer(_ context.Context, slug string, actorUserID string, organizerUserID string) error {
	f.calls = append(f.calls, "remove "+slug+" "+actorUserID+" "+organizerUserID)
	return f.err
}

func (f *fakeEventOrganizers) TransferCreator(_ context.Context, slug string, creatorUserID string, organizerUserID string) error {
	f.calls = append(f.calls, "transfer "+slug+" "+creatorUserID+" "+organizerUserID)
	return f.err
}

func organizerRequest(t *testing.T, store *fakeEventOrganizers, method, target, body string) (int, string) {
	t.Helper()
	router := &Router{
		cfg:        config.Config{SessionCookie: "session", SessionTTL: time.Hour},
		events:     &fakeEventRepository{},
		organizers: store,
	}
	sessions := fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}}
	handler := auth.WithSession(sessions, auth.SessionCookieConfig{Name: "session", TTL: time.Hour})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/organizer-invites/accept" {
			router.handleAcceptOrganizerInvite(w, req)
			return
		}
		router.handleEventPath(w, req)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authenticatedEventRequest(method, target, body))
	return response.Code, strings.TrimSpace(response.Body.String())
}

func TestOrganizerRoutesReachTheStoreAsTheSignedInUser(t *testing.T) {
	store := &fakeEventOrganizers{}
	type result struct {
		Status int
		Body   string
	}
	var got []result
	for _, request := range []struct{ method, target, body string }{
		{http.MethodPost, "/events/campus-chess/organizer-invites", `{"email":" Guest@Example.TEST "}`},
		{http.MethodGet, "/events/campus-chess/organizer-invites", ""},
		{http.MethodDelete, "/events/campus-chess/organizer-invites/" + organizerTestUserID, ""},
		{http.MethodDelete, "/events/campus-chess/organizers/" + organizerTestUserID, ""},
		{http.MethodPost, "/events/campus-chess/organizers/" + organizerTestUserID + "/creator", ""},
		{http.MethodPost, "/organizer-invites/accept", `{"token":"raw-invite"}`},
		{http.MethodPost, "/events/campus-chess/organizer-invites", `{"email":"not an address"}`},
		{http.MethodDelete, "/events/campus-chess/organizers/not-a-uuid", ""},
		{http.MethodPut, "/events/campus-chess/organizer-invites", ""},
	} {
		status, body := organizerRequest(t, store, request.method, request.target, request.body)
		got = append(got, result{status, body})
	}

	want := []result{
		{http.StatusCreated, `{"id":"invite-1","email":"guest@example.test","expires_at":"0001-01-01T00:00:00Z","created_at":"0001-01-01T00:00:00Z"}`},
		{http.StatusOK, `{"invites":[]}`},
		{http.StatusNoContent, ""},
		{http.StatusNoContent, ""},
		{http.StatusNoContent, ""},
		{http.StatusOK, `{"event_slug":"campus-chess"}`},
		{http.StatusBadRequest, `{"error":"invalid_email"}`},
		{http.StatusNotFound, `{"error":"organizer_not_found"}`},
		{http.StatusMethodNotAllowed, `{"error":"method_not_allowed"}`},
	}
	wantCalls := []string{
		"invite campus-chess " + testUserID + " guest@example.test token=true",
		"list campus-chess " + testUserID,
		"revoke campus-chess " + testUserID + " " + organizerTestUserID,
		"remove campus-chess " + testUserID + " " + organizerTestUserID,
		"transfer campus-chess " + testUserID + " " + organizerTestUserID,
		"accept true " + testUserID,
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(store.calls, wantCalls) {
		t.Fatalf("results = %+v\ncalls = %q\nwant %+v\nand %q", got, store.calls, want, wantCalls)
	}
}

func TestOrganizerRoutesMapStoreErrors(t *testing.T) {
	var got []string
	for _, err := range []error{
		eventstore.ErrCreatorRequired,
		eventstore.ErrOrganizerLimit,
		eventstore.ErrOrganizerInviteNotFound,
		eventstore.ErrOrganizerInviteWrongEmail,
		eventstore.ErrCreatorCannotLeave,
	} {
		status, body := organizerRequest(t, &fakeEventOrganizers{err: err}, http.MethodPost, "/organizer-invites/accept", `{"token":"raw-invite"}`)
		got = append(got, fmt.Sprintf("%d %s", status, body))
	}
	want := []string{
		`403 {"error":"not_event_creator"}`,
		`409 {"error":"organizer_limit_reached"}`,
		`404 {"error":"organizer_invite_not_found"}`,
		`403 {"error":"organizer_invite_wrong_account"}`,
		`409 {"error":"creator_cannot_leave"}`,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("responses = %q, want %q", got, want)
	}
}

func TestEventDetailTellsTheCreatorApartFromCoOrganizers(t *testing.T) {
	var got []bool
	for _, creatorID := range []string{testUserID, organizerTestUserID} {
		events := &fakeEventRepository{isOrganizer: true, detail: eventstore.Event{
			Slug:       "campus-chess",
			Visibility: eventstore.VisibilityPublic,
			Organizers: []eventstore.Organizer{
				{ID: creatorID, Role: "creator"},
				{ID: "66666666-6666-4666-8666-666666666666", Role: "organizer"},
			},
		}}
		handler := authenticatedEventPathHandler(events)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, authenticatedEventRequest(http.MethodGet, "/events/campus-chess", ""))
		var body struct {
			ViewerCanEdit   bool `json:"viewer_can_edit"`
			ViewerIsCreator bool `json:"viewer_is_creator"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || !body.ViewerCanEdit {
			t.Fatalf("decode event: %v, can edit = %t", err, body.ViewerCanEdit)
		}
		got = append(got, body.ViewerIsCreator)
	}
	if want := []bool{true, false}; !reflect.DeepEqual(got, want) {
		t.Fatalf("viewer_is_creator = %v, want %v", got, want)
	}
}
