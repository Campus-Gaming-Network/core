package events

import (
	"context"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresEventMutationsCommitDurableEmailIntent(t *testing.T) {
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
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Event Outbox School', $1)
		RETURNING id::text
	`, "event-outbox-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	insertUser := func(label string) (string, string) {
		t.Helper()
		email := "event-outbox-" + label + "-" + suffix + "@example.test"
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1, 'hash', $2, $3::uuid, NOW())
			RETURNING id::text
		`, email, label, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", label, err)
		}
		return id, email
	}
	creatorID, creatorEmail := insertUser("creator")
	yesUserID, yesEmail := insertUser("yes")
	maybeUserID, maybeEmail := insertUser("maybe")
	suspendedUserID, suspendedEmail := insertUser("suspended")
	if _, err := pool.Exec(ctx, `UPDATE users SET account_status = 'suspended' WHERE id = $1::uuid`, suspendedUserID); err != nil {
		t.Fatalf("suspend user: %v", err)
	}

	slug := "event-outbox-" + suffix
	var eventID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, visibility,
			format, starts_at, ends_at, timezone
		)
		VALUES ($1::uuid, $2::uuid, 'Outbox Event', $3, 'public',
		        'online', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'UTC')
		RETURNING id::text
	`, creatorID, schoolID, slug).Scan(&eventID); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO event_organizers (event_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'creator')
	`, eventID, creatorID); err != nil {
		t.Fatalf("insert event organizer: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM email_outbox WHERE recipient = ANY($1)`, []string{creatorEmail, yesEmail, maybeEmail, suspendedEmail})
		_, _ = pool.Exec(context.Background(), `DELETE FROM events WHERE id = $1::uuid`, eventID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{creatorID, yesUserID, maybeUserID, suspendedUserID})
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	repository := NewPostgresRepository(pool)
	if _, err := repository.SetRSVP(ctx, RSVPInput{Slug: slug, UserID: yesUserID, Response: RSVPYes}); err != nil {
		t.Fatalf("first yes SetRSVP() error = %v", err)
	}
	assertEventOutboxCount(t, pool, eventID, emailoutbox.KindRSVPConfirmation, 1)
	if _, err := repository.SetRSVP(ctx, RSVPInput{Slug: slug, UserID: yesUserID, Response: RSVPYes}); err != nil {
		t.Fatalf("unchanged yes SetRSVP() error = %v", err)
	}
	assertEventOutboxCount(t, pool, eventID, emailoutbox.KindRSVPConfirmation, 1)

	if _, err := repository.SetRSVP(ctx, RSVPInput{Slug: slug, UserID: maybeUserID, Response: RSVPMaybe}); err != nil {
		t.Fatalf("maybe SetRSVP() error = %v", err)
	}
	if _, err := repository.SetRSVP(ctx, RSVPInput{Slug: slug, UserID: suspendedUserID, Response: RSVPYes}); err == nil {
		t.Fatal("suspended-user SetRSVP() error = nil, want recipient lookup failure")
	}
	var suspendedRSVPs int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM event_rsvps WHERE event_id = $1::uuid AND user_id = $2::uuid`, eventID, suspendedUserID).Scan(&suspendedRSVPs); err != nil {
		t.Fatalf("count suspended RSVP rows: %v", err)
	}
	if suspendedRSVPs != 0 {
		t.Fatalf("suspended RSVP rows = %d, want transaction rollback", suspendedRSVPs)
	}

	if err := repository.Delete(ctx, slug, creatorID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	assertEventOutboxCount(t, pool, eventID, emailoutbox.KindEventCancellation, 2)
	rows, err := pool.Query(ctx, `
		SELECT recipient FROM email_outbox
		WHERE kind = $1 AND payload -> 'event' ->> 'id' = $2
		ORDER BY recipient
	`, emailoutbox.KindEventCancellation, eventID)
	if err != nil {
		t.Fatalf("list cancellation recipients: %v", err)
	}
	defer rows.Close()
	var recipients []string
	for rows.Next() {
		var recipient string
		if err := rows.Scan(&recipient); err != nil {
			t.Fatalf("scan cancellation recipient: %v", err)
		}
		recipients = append(recipients, recipient)
	}
	sort.Strings(recipients)
	wantRecipients := []string{maybeEmail, yesEmail}
	sort.Strings(wantRecipients)
	if fmt.Sprint(recipients) != fmt.Sprint(wantRecipients) {
		t.Fatalf("cancellation recipients = %v, want %v", recipients, wantRecipients)
	}
}

func assertEventOutboxCount(t *testing.T, pool *pgxpool.Pool, eventID, kind string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM email_outbox
		WHERE kind = $1 AND payload -> 'event' ->> 'id' = $2
	`, kind, eventID).Scan(&got); err != nil {
		t.Fatalf("count event outbox rows: %v", err)
	}
	if got != want {
		t.Fatalf("%s outbox rows = %d, want %d", kind, got, want)
	}
}
