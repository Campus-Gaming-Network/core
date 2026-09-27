package safety

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryReplaysIdempotencyKeys(t *testing.T) {
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
	var schoolID string
	userIDs := make([]string, 3)
	keys := make([]string, 2)
	t.Cleanup(func() {
		cleanupContext := context.Background()
		_, _ = pool.Exec(cleanupContext, `DELETE FROM support_tickets WHERE idempotency_key::text = ANY($1)`, keys)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM reports WHERE reporter_user_id::text = ANY($1)`, userIDs)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id::text = ANY($1)`, userIDs)
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Idempotent Safety School', $1)
		RETURNING id::text
	`, "idempotent-safety-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	for index := range userIDs {
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1, 'hash', 'Idempotent Safety User', $2::uuid, NOW())
			RETURNING id::text
		`, fmt.Sprintf("idempotent-safety-%d-%s@example.test", index, suffix), schoolID).Scan(&userIDs[index]); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	for index := range keys {
		if err := pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&keys[index]); err != nil {
			t.Fatalf("generate key: %v", err)
		}
	}
	repository := NewPostgresRepository(pool)

	t.Run("anonymous support ticket", func(t *testing.T) {
		input := SupportTicketInput{
			ContactEmail:   "idempotent-" + suffix + "@example.test",
			Subject:        "Need help",
			Message:        "Please help with my account.",
			IdempotencyKey: keys[0],
		}
		created, err := repository.CreateSupportTicket(ctx, input)
		if err != nil {
			t.Fatalf("first CreateSupportTicket() error = %v", err)
		}
		replayed, err := repository.CreateSupportTicket(ctx, input)
		if err != nil {
			t.Fatalf("replayed CreateSupportTicket() error = %v", err)
		}
		if !reflect.DeepEqual(replayed, created) {
			t.Fatalf("replayed ticket = %#v, want %#v", replayed, created)
		}

		otherContact := input
		otherContact.ContactEmail = "someone-else-" + suffix + "@example.test"
		if _, err := repository.CreateSupportTicket(ctx, otherContact); !errors.Is(err, ErrIdempotencyKeyReused) {
			t.Fatalf("CreateSupportTicket() with another contact error = %v, want %v", err, ErrIdempotencyKeyReused)
		}
		var count int
		if err := pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM support_tickets WHERE idempotency_key = $1::uuid
		`, keys[0]).Scan(&count); err != nil {
			t.Fatalf("count support tickets: %v", err)
		}
		if count != 1 {
			t.Fatalf("support ticket rows = %d, want 1", count)
		}
	})

	t.Run("user report", func(t *testing.T) {
		reporterID, targetID, otherTargetID := userIDs[0], userIDs[1], userIDs[2]
		created, err := repository.ReportUser(ctx, reporterID, targetID, "Harassment", keys[1])
		if err != nil {
			t.Fatalf("first ReportUser() error = %v", err)
		}
		replayed, err := repository.ReportUser(ctx, reporterID, targetID, "Harassment", keys[1])
		if err != nil {
			t.Fatalf("replayed ReportUser() error = %v", err)
		}
		if !reflect.DeepEqual(replayed, created) {
			t.Fatalf("replayed report = %#v, want %#v", replayed, created)
		}

		if _, err := repository.ReportUser(ctx, reporterID, otherTargetID, "Harassment", keys[1]); !errors.Is(err, ErrIdempotencyKeyReused) {
			t.Fatalf("ReportUser() for another target error = %v, want %v", err, ErrIdempotencyKeyReused)
		}
		var count int
		if err := pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM reports WHERE reporter_user_id = $1::uuid
		`, reporterID).Scan(&count); err != nil {
			t.Fatalf("count reports: %v", err)
		}
		if count != 1 {
			t.Fatalf("report rows = %d, want 1", count)
		}
	})
}
