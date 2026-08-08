package maintenance

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs only when API_DATABASE_URL points at a migrated database. The sweeper is
// pure SQL, so unit tests with fakes would assert nothing about the statements.
func TestSweeperDeletesOnlyAgedRows(t *testing.T) {
	url := os.Getenv("API_DATABASE_URL")
	if url == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	var schoolID, userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Sweeper School', 'sweeper-school')
		RETURNING id::text`).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('sweeper@example.test', 'x', 'Sweeper', $1::uuid, NOW())
		RETURNING id::text`, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

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

	pool.Exec(ctx, `DELETE FROM auth_sessions WHERE user_id = $1::uuid`, userID)
	pool.Exec(ctx, `DELETE FROM email_verification_tokens WHERE user_id = $1::uuid`, userID)
	pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID)
	pool.Exec(ctx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
}
