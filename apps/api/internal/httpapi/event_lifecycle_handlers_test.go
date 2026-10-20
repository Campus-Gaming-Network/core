package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

func TestEventPageShowsARecentlyCancelledPublicEvent(t *testing.T) {
	cancelledAt := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	event := testEvent(eventstore.VisibilityPublic)
	event.CancelledAt = &cancelledAt
	router := &Router{events: &fakeEventRepository{detail: event}}
	response := httptest.NewRecorder()

	router.handleEventPath(response, httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.CancelledAt == nil || !payload.CancelledAt.Equal(cancelledAt) {
		t.Fatalf("cancelled_at = %v, want %v", payload.CancelledAt, cancelledAt)
	}
}

// A cancelled private event has no organizers or unlocks left to let anyone
// in, so its page is not found rather than locked.
func TestEventPageHidesACancelledPrivateEvent(t *testing.T) {
	cancelledAt := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	event := testEvent(eventstore.VisibilityPrivate)
	event.CancelledAt = &cancelledAt
	router := &Router{events: &fakeEventRepository{detail: event}}
	response := httptest.NewRecorder()

	router.handleEventPath(response, httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body = %s", response.Code, response.Body.String())
	}
}

func TestCreatedEventsPagesTheCallersEvents(t *testing.T) {
	startsAt := time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC)
	cursor := pagecursor.Encode(startsAt, "22222222-2222-2222-2222-222222222222")
	page := eventstore.CreatedPage{Events: []eventstore.Event{testEvent(eventstore.VisibilityPublic)}, NextCursor: cursor}
	repository := &fakeEventRepository{createdPage: page}
	router := &Router{cfg: config.Config{SessionCookie: "session", SessionTTL: time.Hour}, events: repository}
	store := fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}}
	handler := auth.WithSession(store, auth.SessionCookieConfig{Name: "session", TTL: time.Hour})(http.HandlerFunc(router.handleCreatedEvents))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, authenticatedEventRequest(http.MethodGet, "/me/created-events?limit=10&after="+cursor, ""))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	wantAfter, err := pagecursor.Decode(cursor)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if repository.createdListUserID != testUserID || repository.createdListLimit != 10 ||
		repository.createdListAfter == nil || !reflect.DeepEqual(*repository.createdListAfter, wantAfter) {
		t.Fatalf("ListCreated(%q, %v, %d), want the caller, the cursor, and 10",
			repository.createdListUserID, repository.createdListAfter, repository.createdListLimit)
	}
	var got eventstore.CreatedPage
	if err := json.NewDecoder(response.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.NextCursor != cursor || len(got.Events) != 1 || got.Events[0].Slug != "campus-scrim-night" {
		t.Fatalf("page = %#v, want the repository's page", got)
	}

	signedOut := httptest.NewRecorder()
	handler.ServeHTTP(signedOut, httptest.NewRequest(http.MethodGet, "/me/created-events", nil))
	if signedOut.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out status = %d, want 401", signedOut.Code)
	}
}
