package emailoutbox

import (
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestBacklogCountsUndeliveredAndRecentlyFailedMessages(t *testing.T) {
	pool := dbtest.NewMigratedSchemaPool(t, "outbox_backlog")
	ctx := t.Context()
	// Delivered mail and a failure older than the window are left out.
	if _, err := pool.Exec(ctx, `
		INSERT INTO email_outbox (kind, recipient, payload, idempotency_key, attempts, created_at, delivered_at, failed_at)
		VALUES
			('password_reset', 'waiting@example.test', '{}', 'waiting', 0, '2026-01-02T00:00:00Z', NULL, NULL),
			('password_reset', 'retrying@example.test', '{}', 'retrying', 2, '2026-01-01T00:00:00Z', NULL, NULL),
			('password_reset', 'delivered@example.test', '{}', 'delivered', 1, '2025-12-01T00:00:00Z', NOW(), NULL),
			('password_reset', 'failed@example.test', '{}', 'failed', 5, '2025-12-01T00:00:00Z', NULL, NOW() - INTERVAL '1 day'),
			('password_reset', 'long-failed@example.test', '{}', 'long-failed', 5, '2025-12-01T00:00:00Z', NULL, NOW() - INTERVAL '8 days')
	`); err != nil {
		t.Fatalf("insert outbox rows: %v", err)
	}

	backlog, err := NewPostgresStore(pool).Backlog(ctx)
	if err != nil {
		t.Fatalf("Backlog() error = %v", err)
	}
	if backlog.OldestPendingAt != nil {
		oldest := backlog.OldestPendingAt.UTC()
		backlog.OldestPendingAt = &oldest
	}
	oldest := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	want := Backlog{Pending: 2, Retrying: 1, Failed: 1, OldestPendingAt: &oldest}
	if !reflect.DeepEqual(backlog, want) {
		t.Fatalf("Backlog() = %+v (oldest %v), want %+v (oldest %v)", backlog, backlog.OldestPendingAt, want, want.OldestPendingAt)
	}
}
