package emailoutbox

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresOutboxCommitRollbackIdempotencyAndDelivery(t *testing.T) {
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	suffix := fmt.Sprint(time.Now().UnixNano())
	rolledBackKey := "outbox-rollback-" + suffix
	committedKey := "outbox-committed-" + suffix
	terminalKey := "outbox-terminal-" + suffix
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM email_outbox WHERE idempotency_key = ANY($1)`, []string{rolledBackKey, committedKey, terminalKey})
	})

	rolledBack, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin rollback transaction: %v", err)
	}
	if err := Enqueue(ctx, rolledBack, Intent{
		Kind: KindPasswordReset, Recipient: "rollback@example.test",
		Payload: map[string]string{"token": "secret"}, IdempotencyKey: rolledBackKey,
	}); err != nil {
		t.Fatalf("enqueue rollback intent: %v", err)
	}
	if err := rolledBack.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	assertOutboxCount(t, pool, rolledBackKey, 0)

	committed, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin commit transaction: %v", err)
	}
	intent := Intent{
		Kind: KindAccountVerification, Recipient: "commit@example.test",
		Payload: map[string]string{"token": "sensitive-token"}, IdempotencyKey: committedKey,
	}
	if err := Enqueue(ctx, committed, intent); err != nil {
		t.Fatalf("enqueue committed intent: %v", err)
	}
	if err := Enqueue(ctx, committed, intent); err != nil {
		t.Fatalf("enqueue idempotent duplicate: %v", err)
	}
	if err := committed.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	assertOutboxCount(t, pool, committedKey, 1)
	if _, err := pool.Exec(ctx, `UPDATE email_outbox SET next_attempt_at = '2000-01-01' WHERE idempotency_key = $1`, committedKey); err != nil {
		t.Fatalf("prioritize test message: %v", err)
	}

	store := NewPostgresStore(pool)
	messages, err := store.Claim(ctx, 1, time.Minute, "database-test-worker")
	if err != nil {
		t.Fatalf("Claim() error = %v", err)
	}
	if len(messages) != 1 || messages[0].IdempotencyKey != committedKey {
		t.Fatalf("Claim() messages = %#v, want committed test message", messages)
	}
	if err := store.MarkDelivered(ctx, messages[0], "provider-message-1"); err != nil {
		t.Fatalf("MarkDelivered() error = %v", err)
	}

	var attempts int
	var providerID string
	var payload string
	var delivered bool
	if err := pool.QueryRow(ctx, `
		SELECT attempts, provider_message_id, payload::text, delivered_at IS NOT NULL
		FROM email_outbox WHERE idempotency_key = $1
	`, committedKey).Scan(&attempts, &providerID, &payload, &delivered); err != nil {
		t.Fatalf("read delivered row: %v", err)
	}
	if attempts != 1 || providerID != "provider-message-1" || payload != "{}" || !delivered {
		t.Fatalf("delivered row = attempts %d provider %q payload %s delivered %v", attempts, providerID, payload, delivered)
	}

	if err := Enqueue(ctx, pool, Intent{
		Kind: KindPasswordReset, Recipient: "terminal@example.test",
		Payload: map[string]string{"token": "terminal-secret"}, IdempotencyKey: terminalKey,
	}); err != nil {
		t.Fatalf("enqueue terminal intent: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_outbox SET next_attempt_at = '1999-01-01' WHERE idempotency_key = $1`, terminalKey); err != nil {
		t.Fatalf("prioritize terminal test message: %v", err)
	}
	messages, err = store.Claim(ctx, 1, time.Minute, "terminal-test-worker")
	if err != nil {
		t.Fatalf("terminal Claim() error = %v", err)
	}
	if len(messages) != 1 || messages[0].IdempotencyKey != terminalKey {
		t.Fatalf("terminal Claim() messages = %#v, want terminal test message", messages)
	}
	if err := store.MarkFailed(ctx, messages[0], time.Now().Add(time.Minute), true, "permanent rejection"); err != nil {
		t.Fatalf("MarkFailed() error = %v", err)
	}
	var terminalPayload string
	var terminal bool
	if err := pool.QueryRow(ctx, `
		SELECT payload::text, failed_at IS NOT NULL FROM email_outbox WHERE idempotency_key = $1
	`, terminalKey).Scan(&terminalPayload, &terminal); err != nil {
		t.Fatalf("read terminal row: %v", err)
	}
	if terminalPayload != "{}" || !terminal {
		t.Fatalf("terminal row = payload %s terminal %v, want scrubbed terminal failure", terminalPayload, terminal)
	}
}

func assertOutboxCount(t *testing.T, pool *pgxpool.Pool, idempotencyKey string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM email_outbox WHERE idempotency_key = $1`, idempotencyKey).Scan(&got); err != nil {
		t.Fatalf("count outbox rows: %v", err)
	}
	if got != want {
		t.Fatalf("outbox rows = %d, want %d", got, want)
	}
}
