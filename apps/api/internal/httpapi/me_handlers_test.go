package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

// profileFakeUsers serves one account and records the update it is asked to
// apply.
type profileFakeUsers struct {
	passV0ContractUsers
	profile     users.Profile
	updateCalls int
	update      users.ProfileUpdate
	links       []users.SocialLink
}

func (r *profileFakeUsers) FindByID(_ context.Context, id string) (users.Profile, error) {
	if id != r.profile.ID {
		return users.Profile{}, pgx.ErrNoRows
	}
	return r.profile, nil
}

func (r *profileFakeUsers) UpdateProfileWithSocialLinks(_ context.Context, _ string, update users.ProfileUpdate, links []users.SocialLink) (users.Profile, error) {
	r.updateCalls++
	r.update = update
	r.links = links
	r.profile.Name = update.Name
	r.profile.Bio = update.Bio
	r.profile.Timezone = update.Timezone
	r.profile.ShowInLists = update.ShowInLists
	r.profile.SocialLinks = links
	return r.profile, nil
}

func newProfileFakeUsers(showInLists bool) *profileFakeUsers {
	return &profileFakeUsers{profile: users.Profile{
		ID:                testUserID,
		Email:             "player@example.com",
		VerificationLevel: "verified",
		Name:              "Player One",
		Bio:               "Plays on weekends.",
		Timezone:          "America/Los_Angeles",
		HomeSchoolID:      "33333333-3333-3333-3333-333333333333",
		SocialLinks:       []users.SocialLink{{ID: "link-1", Label: "Twitch", URL: "https://twitch.example.test/player"}},
		ShowInLists:       showInLists,
	}}
}

func serveMe(store *profileFakeUsers, request *http.Request) *httptest.ResponseRecorder {
	router := &Router{
		cfg: config.Config{SessionCookie: "session", SessionTTL: time.Hour},
		account: auth.NewAccountService(
			store,
			passV0ContractSchools{},
			passV0ContractSessions{},
			passV0ContractTokens{},
			time.Hour, time.Hour, time.Hour,
		),
	}
	handler := auth.WithSession(
		fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(http.HandlerFunc(router.handleMe))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeProfile(t *testing.T, response *httptest.ResponseRecorder) users.Profile {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var profile users.Profile
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return profile
}

func TestMeReportsShowInLists(t *testing.T) {
	for _, showInLists := range []bool{true, false} {
		store := newProfileFakeUsers(showInLists)

		got := decodeProfile(t, serveMe(store, authenticatedEventRequest(http.MethodGet, "/me", "")))

		if !reflect.DeepEqual(got, store.profile) {
			t.Fatalf("show_in_lists=%t: profile = %#v, want %#v", showInLists, got, store.profile)
		}
	}
}

func TestMePatchChangesShowInListsAndKeepsEveryOtherField(t *testing.T) {
	for _, showInLists := range []bool{true, false} {
		store := newProfileFakeUsers(!showInLists)
		before := store.profile

		got := decodeProfile(t, serveMe(store, authenticatedEventRequest(http.MethodPatch, "/me", `{"show_in_lists":`+strconv.FormatBool(showInLists)+`}`)))

		wantUpdate := users.ProfileUpdate{Name: before.Name, Bio: before.Bio, Timezone: before.Timezone, ShowInLists: showInLists}
		if store.update != wantUpdate || !reflect.DeepEqual(store.links, before.SocialLinks) {
			t.Fatalf("update = %#v with links %#v, want %#v with the existing links", store.update, store.links, wantUpdate)
		}
		want := before
		want.ShowInLists = showInLists
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("profile = %#v, want %#v", got, want)
		}
	}
}

func TestMePatchWithoutShowInListsLeavesItUnchanged(t *testing.T) {
	for _, body := range []string{`{"name":"Player Two"}`, `{"name":"Player Two","show_in_lists":null}`} {
		for _, showInLists := range []bool{true, false} {
			store := newProfileFakeUsers(showInLists)

			got := decodeProfile(t, serveMe(store, authenticatedEventRequest(http.MethodPatch, "/me", body)))

			want := store.profile
			want.Name = "Player Two"
			if !reflect.DeepEqual(got, want) || store.update.ShowInLists != showInLists {
				t.Fatalf("%s with show_in_lists=%t: profile = %#v, update = %#v; want only the name changed", body, showInLists, got, store.update)
			}
		}
	}
}

func TestMePatchRejectsANonBooleanShowInLists(t *testing.T) {
	for _, value := range []string{`"no"`, `"false"`, `0`, `{}`, `[]`} {
		store := newProfileFakeUsers(true)

		response := serveMe(store, authenticatedEventRequest(http.MethodPatch, "/me", `{"show_in_lists":`+value+`}`))

		assertError(t, response, http.StatusBadRequest, "invalid_json")
		if store.updateCalls != 0 {
			t.Fatalf("show_in_lists=%s: the profile was updated", value)
		}
	}
}

func TestMePatchRequiresAuthentication(t *testing.T) {
	store := newProfileFakeUsers(true)

	response := serveMe(store, httptest.NewRequest(http.MethodPatch, "/me", strings.NewReader(`{"show_in_lists":false}`)))

	assertError(t, response, http.StatusUnauthorized, "authentication_required")
	if store.updateCalls != 0 {
		t.Fatal("the profile was updated for a signed-out visitor")
	}
}
