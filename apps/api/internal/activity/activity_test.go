package activity

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
)

type fakeStore struct {
	writes []string
	fail   bool
}

func (s *fakeStore) RecordDay(_ context.Context, userID string, day string) error {
	s.writes = append(s.writes, userID+" "+day)
	if s.fail {
		return errors.New("database unavailable")
	}
	return nil
}

type fakeSessions map[string]auth.Session

func (s fakeSessions) FindSession(_ context.Context, tokenHash []byte) (auth.Session, error) {
	for token, session := range s {
		if string(auth.HashToken(token)) == string(tokenHash) {
			return session, nil
		}
	}
	return auth.Session{}, errors.New("unexpected token")
}

func TestMiddlewareRecordsEachSignedInAccountOncePerUTCDay(t *testing.T) {
	store := &fakeStore{}
	recorder := NewRecorder(store, nil)
	now := time.Date(2026, 10, 20, 23, 0, 0, 0, time.UTC)
	recorder.now = func() time.Time { return now }

	expires := time.Now().Add(time.Hour)
	sessions := fakeSessions{
		"alice-token": {UserID: "alice", ExpiresAt: expires},
		"bob-token":   {UserID: "bob", ExpiresAt: expires},
	}
	served := 0
	handler := auth.WithSession(sessions, auth.SessionCookieConfig{Name: "session"})(
		Middleware(recorder)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			served++
			w.WriteHeader(http.StatusNoContent)
		})),
	)
	request := func(token string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "session", Value: token})
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
		}
	}

	request("")
	request("alice-token")
	request("alice-token")
	request("bob-token")
	store.fail = true
	now = now.Add(2 * time.Hour)
	request("alice-token")
	store.fail = false
	request("alice-token")
	request("alice-token")

	want := []string{
		"alice 2026-10-20",
		"bob 2026-10-20",
		"alice 2026-10-21",
		"alice 2026-10-21",
	}
	if !reflect.DeepEqual(store.writes, want) {
		t.Fatalf("writes = %v, want %v", store.writes, want)
	}
	if served != 7 {
		t.Fatalf("served %d requests, want 7", served)
	}
}
