// Package notifications is a signed-in person's inbox: the notices other
// parts of the site leave for them, and whether they have read each one.
package notifications

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Notification types the site writes.
const (
	TypeEventCancelled       = "event.cancelled"
	TypeEventOrganizerJoined = "event.organizer_joined"
)

// Page sizes for the inbox.
const (
	DefaultLimit = 20
	MaximumLimit = 50
)

// ErrNotFound reports a notification that is missing or someone else's.
var ErrNotFound = apperror.New(apperror.KindNotFound, "notification_not_found", "notification not found")

// Notification is one inbox entry as its owner sees it. EventSlug links to the
// event the notice is about while that event is still listed.
type Notification struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	EventSlug string     `json:"event_slug,omitempty"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// Page is a run of notifications, newest first. NextCursor reads the older
// ones and is empty on the last page.
type Page struct {
	Notifications []Notification `json:"notifications"`
	NextCursor    string         `json:"next_cursor"`
}

// Input is a notification to leave for UserID about the event EventID, which
// may be empty.
type Input struct {
	UserID  string
	Type    string
	Title   string
	Body    string
	EventID string
}

// Executor runs a statement, so a caller's transaction can write
// notifications together with the change they announce.
type Executor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// Insert writes each notification through executor. Titles and bodies are
// cut to the table's limits rather than failing the change they describe.
func Insert(ctx context.Context, executor Executor, inputs ...Input) error {
	for _, input := range inputs {
		if _, err := executor.Exec(ctx, `
			INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
			VALUES ($1::uuid, $2, LEFT($3, 160), LEFT($4, 2000),
			        CASE WHEN $5 = '' THEN NULL ELSE 'event' END, NULLIF($5, '')::uuid)
		`, input.UserID, input.Type, input.Title, input.Body, input.EventID); err != nil {
			return fmt.Errorf("insert %s notification: %w", input.Type, err)
		}
	}
	return nil
}

// PostgresRepository reads and updates inboxes in Postgres.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const selectColumns = `
	SELECT n.id::text, n.type, n.title, n.body, COALESCE(e.slug, ''), n.read_at, n.created_at
	FROM notifications n
	LEFT JOIN events e ON n.entity_type = 'event' AND e.id = n.entity_id AND e.deleted_at IS NULL`

func scan(row pgx.Row) (Notification, error) {
	var notification Notification
	err := row.Scan(&notification.ID, &notification.Type, &notification.Title, &notification.Body,
		&notification.EventSlug, &notification.ReadAt, &notification.CreatedAt)
	return notification, err
}

// List returns userID's notifications, newest first, starting after the
// cursor when one is given.
func (r *PostgresRepository) List(ctx context.Context, userID string, after *pagecursor.Cursor, limit int) (Page, error) {
	if limit < 1 || limit > MaximumLimit {
		limit = DefaultLimit
	}
	var cursorTime, cursorID any
	if after != nil {
		cursorTime, cursorID = after.Timestamp, after.ID
	}
	rows, err := r.pool.Query(ctx, selectColumns+`
		WHERE n.user_id = $1::uuid
		  AND ($2::timestamptz IS NULL OR (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
		ORDER BY n.created_at DESC, n.id DESC
		LIMIT $4
	`, userID, cursorTime, cursorID, limit+1)
	if err != nil {
		return Page{}, fmt.Errorf("list notifications: %w", err)
	}
	found, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Notification, error) { return scan(row) })
	if err != nil {
		return Page{}, fmt.Errorf("scan notifications: %w", err)
	}
	page := Page{Notifications: found}
	if len(found) > limit {
		page.Notifications = found[:limit]
		last := page.Notifications[limit-1]
		page.NextCursor = pagecursor.Encode(last.CreatedAt, last.ID)
	}
	return page, nil
}

// UnreadCount counts userID's unread notifications.
func (r *PostgresRepository) UnreadCount(ctx context.Context, userID string) (int, error) {
	var count int
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL
	`, userID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count unread notifications: %w", err)
	}
	return count, nil
}

// MarkRead marks one of userID's notifications read. Marking it again keeps
// the first time.
func (r *PostgresRepository) MarkRead(ctx context.Context, userID string, notificationID string) (Notification, error) {
	notification, err := scan(r.pool.QueryRow(ctx, `
		WITH marked AS (
		    UPDATE notifications SET read_at = COALESCE(read_at, NOW())
		    WHERE id = $1::uuid AND user_id = $2::uuid
		    RETURNING *
		)
		SELECT n.id::text, n.type, n.title, n.body, COALESCE(e.slug, ''), n.read_at, n.created_at
		FROM marked n
		LEFT JOIN events e ON n.entity_type = 'event' AND e.id = n.entity_id AND e.deleted_at IS NULL
	`, notificationID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrNotFound
	}
	if err != nil {
		return Notification{}, fmt.Errorf("mark notification read: %w", err)
	}
	return notification, nil
}

// MarkAllRead marks every unread notification of userID read and returns how
// many it marked.
func (r *PostgresRepository) MarkAllRead(ctx context.Context, userID string) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE notifications SET read_at = NOW() WHERE user_id = $1::uuid AND read_at IS NULL
	`, userID)
	if err != nil {
		return 0, fmt.Errorf("mark notifications read: %w", err)
	}
	return tag.RowsAffected(), nil
}
