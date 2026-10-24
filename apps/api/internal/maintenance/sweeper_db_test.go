package maintenance

import (
	"context"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

// Runs only when API_DATABASE_URL points at a migrated database. The sweeper is
// pure SQL, so unit tests with fakes would assert nothing about the statements.
func TestSweeperDeletesOnlyAgedRows(t *testing.T) {
	pool := dbtest.NewMigratedSchemaPool(t, "sweeper")
	ctx := context.Background()

	var schoolID, userID string
	schoolID = dbtest.InsertSchool(t, pool, "Sweeper School", "sweeper-school")
	userID = dbtest.InsertUser(t, pool, schoolID, "sweeper@example.test", "Sweeper")

	// One session expired well past the grace window, one still valid.
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES
			($1::uuid, '\x01'::bytea, NOW() - INTERVAL '10 days'),
			($1::uuid, '\x02'::bytea, NOW() + INTERVAL '10 days')`, userID); err != nil {
		t.Fatalf("insert sessions: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES
			($1::uuid, '\x03'::bytea, NOW() - INTERVAL '10 days'),
			($1::uuid, '\x04'::bytea, NOW() + INTERVAL '10 days')`, userID); err != nil {
		t.Fatalf("insert tokens: %v", err)
	}

	var eventID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO events (creator_user_id, host_school_id, title, slug, description,
			visibility, format, starts_at, ends_at, timezone)
		VALUES ($1::uuid, $2::uuid, 'Sweep', 'sweep', '', 'public', 'online', NOW(), NOW() + INTERVAL '1 hour', 'UTC')
		RETURNING id::text`, userID, schoolID).Scan(&eventID); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	// Expired, accepted, and revoked past the grace window go; a pending invite
	// and one accepted within the window stay.
	if _, err := pool.Exec(ctx, `
		INSERT INTO event_organizer_invites (event_id, email, token_hash, expires_at, accepted_at, revoked_at) VALUES
			($1::uuid, 'a@example.test', '\x05'::bytea, NOW() - INTERVAL '10 days', NULL, NULL),
			($1::uuid, 'b@example.test', '\x06'::bytea, NOW() + INTERVAL '1 day', NOW() - INTERVAL '10 days', NULL),
			($1::uuid, 'c@example.test', '\x07'::bytea, NOW() + INTERVAL '1 day', NULL, NOW() - INTERVAL '10 days'),
			($1::uuid, 'd@example.test', '\x08'::bytea, NOW() + INTERVAL '1 day', NULL, NULL),
			($1::uuid, 'e@example.test', '\x09'::bytea, NOW() + INTERVAL '1 day', NOW(), NULL)`, eventID); err != nil {
		t.Fatalf("insert organizer invites: %v", err)
	}

	result, err := NewSweeper(pool, nil).Run(ctx)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if result.Sessions != 1 {
		t.Fatalf("deleted %d sessions, want 1", result.Sessions)
	}
	if result.VerificationTokens != 1 {
		t.Fatalf("deleted %d verification tokens, want 1", result.VerificationTokens)
	}
	if result.OrganizerInvites != 3 {
		t.Fatalf("deleted %d organizer invites, want 3", result.OrganizerInvites)
	}

	var sessions, tokens int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM auth_sessions WHERE user_id = $1::uuid`, userID).Scan(&sessions); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM email_verification_tokens WHERE user_id = $1::uuid`, userID).Scan(&tokens); err != nil {
		t.Fatalf("count tokens: %v", err)
	}
	if sessions != 1 || tokens != 1 {
		t.Fatalf("survivors: sessions=%d tokens=%d, want 1 and 1", sessions, tokens)
	}

	// A second pass must be a no-op rather than deleting live rows.
	again, err := NewSweeper(pool, nil).Run(ctx)
	if err != nil {
		t.Fatalf("second Run() error = %v", err)
	}
	if again.Total() != 0 {
		t.Fatalf("second pass deleted %d rows, want 0", again.Total())
	}
}
