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
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

const notificationTestID = "77777777-7777-4777-8777-777777777777"

type fakeInbox struct {
	calls []string
}

func (f *fakeInbox) List(_ context.Context, userID string, after *pagecursor.Cursor, limit int) (notifications.Page, error) {
	cursor := "none"
	if after != nil {
		cursor = after.ID
	}
	f.calls = append(f.calls, fmt.Sprintf("list %s after=%s limit=%d", userID, cursor, limit))
	return notifications.Page{Notifications: []notifications.Notification{{ID: notificationTestID, Type: "event.cancelled", Title: "Event cancelled", Body: "Gone", EventSlug: "chess"}}}, nil
}

func (f *fakeInbox) UnreadCount(_ context.Context, userID string) (int, error) {
	f.calls = append(f.calls, "count "+userID)
	return 3, nil
}

func (f *fakeInbox) MarkRead(_ context.Context, userID string, notificationID string) (notifications.Notification, error) {
	f.calls = append(f.calls, "read "+userID+" "+notificationID)
	if notificationID != notificationTestID {
		return notifications.Notification{}, notifications.ErrNotFound
	}
	return notifications.Notification{ID: notificationID, Type: "notice", Title: "T", Body: "B"}, nil
}

func (f *fakeInbox) MarkAllRead(_ context.Context, userID string) (int64, error) {
	f.calls = append(f.calls, "read-all "+userID)
	return 2, nil
}

func TestInboxRoutesServeOnlyTheSignedInPersonsNotifications(t *testing.T) {
	store := &fakeInbox{}
	router := &Router{cfg: config.Config{SessionCookie: "session", SessionTTL: time.Hour}, inbox: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/me/notifications", requireMethod(http.MethodGet, router.handleNotifications))
	mux.HandleFunc("/me/notifications/unread-count", requireMethod(http.MethodGet, router.handleUnreadNotificationCount))
	mux.HandleFunc("/me/notifications/read-all", requireMethod(http.MethodPost, router.handleReadAllNotifications))
	mux.HandleFunc("/me/notifications/{notificationID}/read", requireMethod(http.MethodPost, router.handleReadNotification))
	handler := auth.WithSession(
		fakeSessionStore{session: auth.Session{ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour)}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(mux)
	cursor := pagecursor.Encode(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), notificationTestID)

	type result struct {
		Status int
		Cache  string
		Body   string
	}
	var got []result
	for _, request := range []*http.Request{
		authenticatedEventRequest(http.MethodGet, "/me/notifications?limit=5&after="+cursor, ""),
		authenticatedEventRequest(http.MethodGet, "/me/notifications/unread-count", ""),
		authenticatedEventRequest(http.MethodPost, "/me/notifications/"+notificationTestID+"/read", ""),
		authenticatedEventRequest(http.MethodPost, "/me/notifications/66666666-6666-4666-8666-666666666666/read", ""),
		authenticatedEventRequest(http.MethodPost, "/me/notifications/read-all", ""),
		authenticatedEventRequest(http.MethodGet, "/me/notifications?limit=51", ""),
		authenticatedEventRequest(http.MethodGet, "/me/notifications?after=nonsense", ""),
		authenticatedEventRequest(http.MethodPost, "/me/notifications/not-an-id/read", ""),
		httptest.NewRequest(http.MethodGet, "/me/notifications/unread-count", nil),
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		got = append(got, result{response.Code, response.Header().Get("Cache-Control"), strings.TrimSpace(response.Body.String())})
	}

	private := "private, no-store"
	want := []result{
		{http.StatusOK, private, `{"notifications":[{"id":"` + notificationTestID + `","type":"event.cancelled","title":"Event cancelled","body":"Gone","event_slug":"chess","created_at":"0001-01-01T00:00:00Z"}],"next_cursor":""}`},
		{http.StatusOK, private, `{"unread":3}`},
		{http.StatusOK, private, `{"id":"` + notificationTestID + `","type":"notice","title":"T","body":"B","created_at":"0001-01-01T00:00:00Z"}`},
		{http.StatusNotFound, private, `{"error":"notification_not_found"}`},
		{http.StatusOK, private, `{"marked":2}`},
		{http.StatusBadRequest, private, `{"error":"invalid_limit"}`},
		{http.StatusBadRequest, private, `{"error":"invalid_cursor"}`},
		{http.StatusNotFound, private, `{"error":"notification_not_found"}`},
		{http.StatusUnauthorized, "", `{"error":"authentication_required"}`},
	}
	wantCalls := []string{
		"list " + testUserID + " after=" + notificationTestID + " limit=5",
		"count " + testUserID,
		"read " + testUserID + " " + notificationTestID,
		"read " + testUserID + " 66666666-6666-4666-8666-666666666666",
		"read-all " + testUserID,
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(store.calls, wantCalls) {
		t.Fatalf("results = %+v\ncalls = %q\nwant %+v\nand %q", got, store.calls, want, wantCalls)
	}
}
