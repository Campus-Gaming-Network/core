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
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

// credentialFakeUsers is one account whose password is "OldPassword1".
type credentialFakeUsers struct {
	*profileFakeUsers
	passwordHash string
}

func (r *credentialFakeUsers) FindCredentialsByEmail(_ context.Context, email string) (users.Credentials, error) {
	if email != r.profile.Email {
		return users.Credentials{}, pgx.ErrNoRows
	}
	return users.Credentials{Profile: r.profile, PasswordHash: r.passwordHash}, nil
}

// fakeAccountChanges records what the handlers asked the store to change.
type fakeAccountChanges struct {
	calls []string
}

func (f *fakeAccountChanges) ChangePassword(_ context.Context, userID string, _ string, keepSessionHash []byte, _ time.Time) error {
	f.calls = append(f.calls, "password:"+userID+":keep="+string(keepSessionHash))
	return nil
}

func (f *fakeAccountChanges) CreateEmailChangeToken(_ context.Context, userID string, newEmail string, _ string, _ []byte, _ time.Time) error {
	f.calls = append(f.calls, "email:"+userID+":"+newEmail)
	return nil
}

func (f *fakeAccountChanges) UseEmailChangeToken(_ context.Context, tokenHash []byte, _ time.Time) error {
	if string(tokenHash) != string(auth.HashToken("good-token")) {
		return pgx.ErrNoRows
	}
	f.calls = append(f.calls, "confirm")
	return nil
}

func serveAccountChange(t *testing.T, handler func(*Router) http.HandlerFunc, request *http.Request) (*httptest.ResponseRecorder, []string) {
	t.Helper()
	passwordHash, err := auth.HashPassword("OldPassword1")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	store := &credentialFakeUsers{profileFakeUsers: newProfileFakeUsers(true), passwordHash: passwordHash}
	changes := &fakeAccountChanges{}
	account := auth.NewAccountService(store, passV0ContractSchools{}, passV0ContractSessions{}, passV0ContractTokens{}, time.Hour, time.Hour, time.Hour)
	account.Changes = changes
	router := &Router{cfg: config.Config{SessionCookie: "session", SessionTTL: time.Hour}, account: account}
	response := httptest.NewRecorder()
	auth.WithSession(
		fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(handler(router)).ServeHTTP(response, request)
	return response, changes.calls
}

func changePassword(r *Router) http.HandlerFunc { return r.handleChangePassword }
func changeEmail(r *Router) http.HandlerFunc    { return r.handleChangeEmail }
func confirmEmail(r *Router) http.HandlerFunc   { return r.handleConfirmEmailChange }

func TestAccountChangeHandlers(t *testing.T) {
	anonymous := func(target string, body string) *http.Request {
		return httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	}
	keep := "keep=" + string(auth.HashToken("raw-token"))
	for _, test := range []struct {
		name      string
		handler   func(*Router) http.HandlerFunc
		request   *http.Request
		status    int
		bodyHas   string
		wantCalls []string
	}{
		{
			name: "password change keeps the requesting session", handler: changePassword,
			request: authenticatedEventRequest(http.MethodPost, "/me/password", `{"current_password":"OldPassword1","new_password":"NewPassword1"}`),
			status:  http.StatusNoContent, wantCalls: []string{"password:" + testUserID + ":" + keep},
		},
		{
			name: "wrong current password", handler: changePassword,
			request: authenticatedEventRequest(http.MethodPost, "/me/password", `{"current_password":"Wrong","new_password":"NewPassword1"}`),
			status:  http.StatusUnprocessableEntity, bodyHas: "invalid_current_password",
		},
		{
			name: "short new password", handler: changePassword,
			request: authenticatedEventRequest(http.MethodPost, "/me/password", `{"current_password":"OldPassword1","new_password":"short"}`),
			status:  http.StatusBadRequest,
		},
		{
			name: "password change needs a session", handler: changePassword,
			request: anonymous("/me/password", `{"current_password":"OldPassword1","new_password":"NewPassword1"}`),
			status:  http.StatusUnauthorized, bodyHas: "authentication_required",
		},
		{
			name: "email change queues the normalized address", handler: changeEmail,
			request: authenticatedEventRequest(http.MethodPost, "/me/email", `{"current_password":"OldPassword1","new_email":" New@Example.com "}`),
			status:  http.StatusAccepted, bodyHas: "confirmation_sent_if_available", wantCalls: []string{"email:" + testUserID + ":new@example.com"},
		},
		{
			name: "malformed email", handler: changeEmail,
			request: authenticatedEventRequest(http.MethodPost, "/me/email", `{"current_password":"OldPassword1","new_email":"not an email"}`),
			status:  http.StatusBadRequest, bodyHas: "invalid_request",
		},
		{
			name: "unchanged email", handler: changeEmail,
			request: authenticatedEventRequest(http.MethodPost, "/me/email", `{"current_password":"OldPassword1","new_email":"player@example.com"}`),
			status:  http.StatusBadRequest, bodyHas: "email_unchanged",
		},
		{
			name: "email change needs a session", handler: changeEmail,
			request: anonymous("/me/email", `{"current_password":"OldPassword1","new_email":"new@example.com"}`),
			status:  http.StatusUnauthorized, bodyHas: "authentication_required",
		},
		{
			name: "confirmation needs no session", handler: confirmEmail,
			request: anonymous("/auth/confirm-email-change", `{"token":"good-token"}`),
			status:  http.StatusOK, bodyHas: "email_changed", wantCalls: []string{"confirm"},
		},
		{
			name: "expired or unknown link", handler: confirmEmail,
			request: anonymous("/auth/confirm-email-change", `{"token":"stale-token"}`),
			status:  http.StatusBadRequest, bodyHas: "invalid_or_expired_token",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, calls := serveAccountChange(t, test.handler, test.request)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.bodyHas) {
				t.Fatalf("response = %d %s, want %d containing %q", response.Code, response.Body.String(), test.status, test.bodyHas)
			}
			if !reflect.DeepEqual(calls, test.wantCalls) && (len(calls) != 0 || len(test.wantCalls) != 0) {
				t.Fatalf("store calls = %q, want %q", calls, test.wantCalls)
			}
		})
	}
}
