package notifications

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

func TestInboxPagesMarksAndKeepsEachPersonToTheirOwn(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "notifications")
	var userID, otherID, liveEventID, cancelledEventID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('Home', 'home') RETURNING id),
		     member AS (INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		                SELECT 'me@example.test', 'hash', 'Me', id, NOW() FROM school RETURNING id),
		     other AS (INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		               SELECT 'other@example.test', 'hash', 'Other', id, NOW() FROM school RETURNING id),
		     live AS (INSERT INTO events (creator_user_id, host_school_id, title, slug, description, visibility, format, starts_at, ends_at, timezone)
		              SELECT member.id, school.id, 'Live', 'live-event', '', 'public', 'online', NOW(), NOW() + INTERVAL '1 hour', 'UTC'
		              FROM member, school RETURNING id),
		     gone AS (INSERT INTO events (creator_user_id, host_school_id, title, slug, description, visibility, format, starts_at, ends_at, timezone, deleted_at)
		              SELECT member.id, school.id, 'Gone', 'gone-event', '', 'public', 'online', NOW(), NOW() + INTERVAL '1 hour', 'UTC', NOW()
		              FROM member, school RETURNING id)
		SELECT member.id::text, other.id::text, live.id::text, gone.id::text FROM member, other, live, gone
	`).Scan(&userID, &otherID, &liveEventID, &cancelledEventID); err != nil {
		t.Fatalf("insert fixtures: %v", err)
	}
	if err := Insert(ctx, pool,
		Input{UserID: userID, Type: TypeEventCancelled, Title: "First", Body: "Oldest", EventID: cancelledEventID},
		Input{UserID: userID, Type: TypeEventOrganizerJoined, Title: "Second", Body: "Middle", EventID: liveEventID},
		Input{UserID: userID, Type: "notice", Title: "Third", Body: "Newest"},
		Input{UserID: otherID, Type: "notice", Title: "Not yours", Body: "Not yours"},
	); err != nil {
		t.Fatalf("Insert() error = %v", err)
	}
	// Give each a distinct time so the order is fixed.
	if _, err := pool.Exec(ctx, `
		UPDATE notifications SET created_at = TIMESTAMPTZ '2026-10-01T12:00:00Z' + (CASE title WHEN 'First' THEN 0 WHEN 'Second' THEN 1 ELSE 2 END) * INTERVAL '1 hour'
	`); err != nil {
		t.Fatalf("set notification times: %v", err)
	}
	repository := NewPostgresRepository(pool)

	first, err := repository.List(ctx, userID, nil, 2)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	cursor, err := pagecursor.Decode(first.NextCursor)
	if err != nil {
		t.Fatalf("decode next cursor %q: %v", first.NextCursor, err)
	}
	second, err := repository.List(ctx, userID, &cursor, 2)
	if err != nil {
		t.Fatalf("List() second page error = %v", err)
	}
	summary := func(page Page) []string {
		var out []string
		for _, notification := range page.Notifications {
			out = append(out, notification.Title+":"+notification.Type+":"+notification.EventSlug)
		}
		return out
	}
	if got, want := [][]string{summary(first), summary(second)}, [][]string{
		{"Third:notice:", "Second:event.organizer_joined:live-event"},
		{"First:event.cancelled:"},
	}; !reflect.DeepEqual(got, want) || second.NextCursor != "" {
		t.Fatalf("pages = %v (next %q), want %v and no next page", got, second.NextCursor, want)
	}

	unread := func(id string) int {
		t.Helper()
		count, err := repository.UnreadCount(ctx, id)
		if err != nil {
			t.Fatalf("UnreadCount() error = %v", err)
		}
		return count
	}
	if got := []int{unread(userID), unread(otherID)}; !reflect.DeepEqual(got, []int{3, 1}) {
		t.Fatalf("unread counts = %v, want [3 1]", got)
	}

	middle := first.Notifications[1]
	read, err := repository.MarkRead(ctx, userID, middle.ID)
	if err != nil || read.ReadAt == nil || read.EventSlug != "live-event" {
		t.Fatalf("MarkRead() = %+v, %v", read, err)
	}
	again, err := repository.MarkRead(ctx, userID, middle.ID)
	if err != nil || !again.ReadAt.Equal(*read.ReadAt) {
		t.Fatalf("MarkRead() again = %+v, %v; want the first read time %v", again, err, read.ReadAt)
	}
	if _, err := repository.MarkRead(ctx, otherID, middle.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("MarkRead() of someone else's notification error = %v, want %v", err, ErrNotFound)
	}
	if got := unread(userID); got != 2 {
		t.Fatalf("unread after one read = %d, want 2", got)
	}

	marked, err := repository.MarkAllRead(ctx, userID)
	if err != nil || marked != 2 {
		t.Fatalf("MarkAllRead() = %d, %v; want 2", marked, err)
	}
	if got := []int{unread(userID), unread(otherID)}; !reflect.DeepEqual(got, []int{0, 1}) {
		t.Fatalf("unread after marking all = %v, want [0 1]", got)
	}
	var stillFirst time.Time
	if err := pool.QueryRow(ctx, `SELECT read_at FROM notifications WHERE id = $1::uuid`, middle.ID).Scan(&stillFirst); err != nil || !stillFirst.Equal(*read.ReadAt) {
		t.Fatalf("read time after marking all = %v, %v; want %v", stillFirst, err, read.ReadAt)
	}
}
