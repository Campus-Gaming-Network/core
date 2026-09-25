package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type fakeSessionStore struct {
	session Session
	err     error
	seen    []byte
}

func (s *fakeSessionStore) FindSession(_ context.Context, tokenHash []byte) (Session, error) {
	s.seen = tokenHash
	return s.session, s.err
}

func TestWithSessionAddsAuthenticatedUserToContext(t *testing.T) {
	rawToken, _, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}

	store := &fakeSessionStore{session: Session{
		ID:        "session-id",
		UserID:    "user-id",
		ExpiresAt: time.Now().Add(time.Hour),
	}}
	var gotUserID string
	handler := WithSession(store, SessionCookieConfig{Name: "session"})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotUserID, _ = UserID(req.Context())
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: rawToken})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if gotUserID != "user-id" {
		t.Fatalf("user ID = %q, want %q", gotUserID, "user-id")
	}
	if string(store.seen) == rawToken {
		t.Fatal("middleware passed the raw session token to the store")
	}
}

func TestWithSessionClearsExpiredCookie(t *testing.T) {
	rawToken, _, err := NewToken()
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}

	store := &fakeSessionStore{session: Session{UserID: "user-id", ExpiresAt: time.Now().Add(-time.Minute)}}
	handler := WithSession(store, SessionCookieConfig{Name: "session", Secure: true})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: rawToken})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge != -1 || !cookies[0].HttpOnly || !cookies[0].Secure {
		t.Fatalf("expired session cookie = %#v", cookies)
	}
}

func TestWithSessionSeparatesMissingSessionFromLookupFailure(t *testing.T) {
	type outcome struct {
		Status        int
		CookieCleared bool
		NextCalled    bool
	}
	for _, test := range []struct {
		name string
		err  error
		want outcome
	}{
		{name: "missing session", err: pgx.ErrNoRows, want: outcome{Status: http.StatusNoContent, CookieCleared: true, NextCalled: true}},
		{name: "lookup failure", err: errors.New("connection refused"), want: outcome{Status: http.StatusServiceUnavailable}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var got outcome
			handler := WithSession(&fakeSessionStore{err: test.err}, SessionCookieConfig{Name: "session"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				got.NextCalled = true
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodGet, "/me", nil)
			req.AddCookie(&http.Cookie{Name: "session", Value: "raw-token"})
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, req)

			got.Status = response.Code
			got.CookieCleared = len(response.Result().Cookies()) == 1 && response.Result().Cookies()[0].MaxAge == -1
			if got != test.want {
				t.Fatalf("outcome = %+v, want %+v", got, test.want)
			}
		})
	}
}
