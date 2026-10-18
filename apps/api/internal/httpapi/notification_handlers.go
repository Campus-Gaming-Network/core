package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

// inbox is the signed-in person's notifications.
type inbox interface {
	List(ctx context.Context, userID string, after *pagecursor.Cursor, limit int) (notifications.Page, error)
	UnreadCount(ctx context.Context, userID string) (int, error)
	MarkRead(ctx context.Context, userID string, notificationID string) (notifications.Notification, error)
	MarkAllRead(ctx context.Context, userID string) (int64, error)
}

// inboxUser starts an inbox request: the store is wired and someone is
// signed in. Inbox answers are private to that person.
func (r *Router) inboxUser(w http.ResponseWriter, req *http.Request) (string, bool) {
	if r.inbox == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return "", false
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return "", false
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return userID, true
}

// handleNotifications answers GET /me/notifications: a page of the inbox,
// newest first. `limit` is 1–50 (default 20) and `after` is the previous
// page's next_cursor.
func (r *Router) handleNotifications(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.inboxUser(w, req)
	if !ok {
		return
	}
	query := req.URL.Query()
	limit := notifications.DefaultLimit
	if query.Has("limit") {
		parsed, err := strconv.Atoi(query.Get("limit"))
		if err != nil || parsed < 1 || parsed > notifications.MaximumLimit {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = parsed
	}
	var after *pagecursor.Cursor
	if query.Has("after") {
		cursor, err := pagecursor.Decode(query.Get("after"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_cursor")
			return
		}
		after = &cursor
	}
	page, err := r.inbox.List(req.Context(), userID, after, limit)
	if err != nil {
		writeApplicationError(w, err, "notifications_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// handleUnreadNotificationCount answers GET /me/notifications/unread-count.
func (r *Router) handleUnreadNotificationCount(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.inboxUser(w, req)
	if !ok {
		return
	}
	count, err := r.inbox.UnreadCount(req.Context(), userID)
	if err != nil {
		writeApplicationError(w, err, "notifications_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"unread": count})
}

// handleReadNotification answers POST /me/notifications/{id}/read.
func (r *Router) handleReadNotification(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.inboxUser(w, req)
	if !ok {
		return
	}
	notificationID := req.PathValue("notificationID")
	if !looksLikeUUID(notificationID) {
		writeError(w, http.StatusNotFound, "notification_not_found")
		return
	}
	notification, err := r.inbox.MarkRead(req.Context(), userID, notificationID)
	if err != nil {
		writeApplicationError(w, err, "notification_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, notification)
}

// handleReadAllNotifications answers POST /me/notifications/read-all.
func (r *Router) handleReadAllNotifications(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.inboxUser(w, req)
	if !ok {
		return
	}
	marked, err := r.inbox.MarkAllRead(req.Context(), userID)
	if err != nil {
		writeApplicationError(w, err, "notification_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"marked": marked})
}
