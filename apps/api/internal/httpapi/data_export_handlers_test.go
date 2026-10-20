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
	"github.com/Campus-Gaming-Network/core/apps/api/internal/dataexport"
)

type fakeDataExports struct {
	exported []string
}

func (f *fakeDataExports) Export(_ context.Context, userID string) (dataexport.Export, error) {
	f.exported = append(f.exported, userID)
	return dataexport.Export{FormatVersion: 1, Account: json.RawMessage(`{"name":"Player"}`)}, nil
}

func TestDataExportNeedsTheSignedInHoldersPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("OldPassword1")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	store := &credentialFakeUsers{profileFakeUsers: newProfileFakeUsers(true), passwordHash: passwordHash}
	exports := &fakeDataExports{}
	router := &Router{
		cfg:         config.Config{SessionCookie: "session", SessionTTL: time.Hour},
		account:     auth.NewAccountService(store, passV0ContractSchools{}, passV0ContractSessions{}, passV0ContractTokens{}, time.Hour, time.Hour, time.Hour),
		dataExports: exports,
	}
	handler := auth.WithSession(
		fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(http.HandlerFunc(router.handleDataExport))

	type result struct {
		Status int
		Cache  string
		Body   string
	}
	var got []result
	for _, request := range []*http.Request{
		authenticatedEventRequest(http.MethodPost, "/me/export", `{"current_password":"OldPassword1"}`),
		authenticatedEventRequest(http.MethodPost, "/me/export", `{"current_password":"Wrong"}`),
		httptest.NewRequest(http.MethodPost, "/me/export", strings.NewReader(`{"current_password":"OldPassword1"}`)),
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		got = append(got, result{response.Code, response.Header().Get("Cache-Control"), strings.TrimSpace(response.Body.String())})
	}

	want := []result{
		{http.StatusOK, "private, no-store", `{"format_version":1,"exported_at":"0001-01-01T00:00:00Z","account":{"name":"Player"},"social_links":null,"followed_schools":null,"school_admin_roles":null,"site_roles":null,"game_lists":null,"teams":null,"clubs":null,"club_claims":null,"events_organized":null,"rsvps":null,"interested_events":null,"support_tickets":null,"reports":null,"notifications":null,"policy_acceptances":null,"sessions":null}`},
		{http.StatusUnprocessableEntity, "", `{"error":"invalid_current_password"}`},
		{http.StatusUnauthorized, "", `{"error":"authentication_required"}`},
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(exports.exported, []string{testUserID}) {
		t.Fatalf("results = %+v\nexports = %v\nwant %+v and one export", got, exports.exported, want)
	}
}
