package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
)

// fakeClubOfficers records each command as name:slug:argument and refuses
// the club "chess-club" as someone else's.
type fakeClubOfficers struct{ calls *[]string }

func (f fakeClubOfficers) record(name, slug, argument string) error {
	*f.calls = append(*f.calls, name+":"+slug+":"+argument)
	if slug == "chess-club" {
		return clubs.ErrNotClubOfficer
	}
	return nil
}

func (f fakeClubOfficers) Viewer(_ context.Context, clubID, _ string) (clubs.Viewer, error) {
	return clubs.Viewer{Role: clubs.RoleEditor}, f.record("viewer", clubID, "")
}

func (f fakeClubOfficers) Manage(_ context.Context, slug, _ string) (clubs.Management, error) {
	return clubs.Management{Role: clubs.RoleEditor, Members: []clubs.Member{}, Invites: []clubs.EditorInvite{}}, f.record("manage", slug, "")
}

func (f fakeClubOfficers) EditProfile(_ context.Context, slug, _ string, edit clubs.ProfileEdit) error {
	return f.record("profile", slug, edit.Name)
}

func (f fakeClubOfficers) EditLinks(_ context.Context, slug, _ string, links []clubs.Link) error {
	return f.record("links", slug, links[0].URL)
}

func (f fakeClubOfficers) InviteEditor(_ context.Context, params clubs.EditorInviteParams) (clubs.EditorInvite, error) {
	return clubs.EditorInvite{Email: params.Email}, f.record("invite", params.Slug, params.Email)
}

func (f fakeClubOfficers) RevokeEditorInvite(_ context.Context, slug, _, inviteID string) error {
	return f.record("revoke", slug, inviteID)
}

func (f fakeClubOfficers) AcceptEditorInvite(_ context.Context, tokenHash []byte, _ string) (string, error) {
	matches := "wrong-token"
	if string(tokenHash) == string(auth.HashToken("raw-token")) {
		matches = "raw-token"
	}
	return "smash-club", f.record("accept-invite", "", matches)
}

func (f fakeClubOfficers) RemoveMember(_ context.Context, slug, _, target string) error {
	return f.record("remove", slug, target)
}

func (f fakeClubOfficers) Leave(_ context.Context, slug, _ string) error {
	return f.record("leave", slug, "")
}

func (f fakeClubOfficers) OfferOwnership(_ context.Context, slug, _, recipient string) error {
	return f.record("offer", slug, recipient)
}

func (f fakeClubOfficers) CancelOwnershipOffer(_ context.Context, slug, _ string) error {
	return f.record("cancel-offer", slug, "")
}

func (f fakeClubOfficers) AcceptOwnership(_ context.Context, slug, _ string) error {
	return f.record("accept-offer", slug, "")
}

const memberID = "22222222-2222-4222-8222-222222222222"

func TestClubOfficerRoutesNeedASignedInUserAndPassThroughTheirArguments(t *testing.T) {
	var calls []string
	router := &Router{mux: http.NewServeMux(), clubs: fakeClubs{}, clubOfficers: fakeClubOfficers{calls: &calls}}
	router.registerPublicRoutes()
	handler := signedIn(router.mux.ServeHTTP)
	for _, test := range []struct {
		method, path, body string
		status             int
	}{
		{http.MethodGet, "/clubs/smash-club/manage", "", http.StatusOK},
		{http.MethodPost, "/clubs/smash-club/profile", `{"name":"Smash","type":"student_club"}`, http.StatusNoContent},
		{http.MethodPost, "/clubs/chess-club/profile", `{"name":"Chess","type":"student_club"}`, http.StatusForbidden},
		{http.MethodPost, "/clubs/smash-club/links", `{"links":[{"type":"website","label":"Site","url":"https://smash.example.test"}]}`, http.StatusNoContent},
		{http.MethodPost, "/clubs/smash-club/editor-invites", `{"email":" Editor@Example.test "}`, http.StatusCreated},
		{http.MethodPost, "/clubs/smash-club/editor-invites", `{"email":"not an address"}`, http.StatusBadRequest},
		{http.MethodDelete, "/clubs/smash-club/editor-invites/" + memberID, "", http.StatusNoContent},
		{http.MethodPost, "/club-editor-invites/accept", `{"token":"raw-token"}`, http.StatusOK},
		{http.MethodPost, "/clubs/smash-club/remove-member", `{"user_id":"` + memberID + `"}`, http.StatusNoContent},
		{http.MethodPost, "/clubs/smash-club/remove-member", `{"user_id":"someone"}`, http.StatusBadRequest},
		{http.MethodPost, "/clubs/smash-club/leave", "", http.StatusNoContent},
		{http.MethodPost, "/clubs/smash-club/ownership-offer", `{"user_id":"` + memberID + `"}`, http.StatusNoContent},
		{http.MethodDelete, "/clubs/smash-club/ownership-offer", "", http.StatusNoContent},
		{http.MethodPost, "/clubs/smash-club/ownership-offer/accept", "", http.StatusNoContent},
		{http.MethodGet, "/clubs/esports-program", "", http.StatusOK},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, authenticatedEventRequest(test.method, test.path, test.body))
		if response.Code != test.status {
			t.Errorf("%s %s = %d %s, want %d", test.method, test.path, response.Code, response.Body.String(), test.status)
		}
		if test.path == "/clubs/esports-program" && !strings.Contains(response.Body.String(), `"viewer":{"role":"editor"}`) {
			t.Errorf("signed-in club page = %s, want the viewer's role", response.Body.String())
		}
	}
	want := []string{
		"manage:smash-club:", "profile:smash-club:Smash", "profile:chess-club:Chess",
		"links:smash-club:https://smash.example.test", "invite:smash-club:editor@example.test",
		"revoke:smash-club:" + memberID, "accept-invite::raw-token", "remove:smash-club:" + memberID,
		"leave:smash-club:", "offer:smash-club:" + memberID, "cancel-offer:smash-club:", "accept-offer:smash-club:",
		"viewer:club-1:",
	}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("calls = %v, want %v", calls, want)
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/clubs/smash-club/leave", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out leave = %d, want 401", response.Code)
	}
}
