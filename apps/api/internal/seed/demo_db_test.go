package seed

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs only when API_DATABASE_URL points at a migrated database. Seeding twice
// must return the same result and leave the same rows, and a reset must remove
// every demo row.
func TestEnsureDemoDataIsIdempotentAndResettable(t *testing.T) {
	url := os.Getenv("API_DATABASE_URL")
	if url == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Demo Guard School', 'demo-guard-school')
		RETURNING id::text`).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_ = ResetDemoData(context.Background(), pool)
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	options := DemoOptions{
		Password: "Password12345!",
		Seed:     7,
		Users:    40,
		Events:   20,
		Teams:    6,
		Now:      time.Date(2026, time.September, 30, 12, 0, 0, 0, time.UTC),
	}
	countDemoRows := func() [4]int {
		var counts [4]int
		if err := pool.QueryRow(ctx, `
			SELECT
				(SELECT COUNT(*) FROM users WHERE email LIKE '%@' || $1),
				(SELECT COUNT(*) FROM events WHERE creator_user_id IN (SELECT id FROM users WHERE email LIKE '%@' || $1)),
				(SELECT COUNT(*) FROM teams WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@' || $1)),
				(SELECT COUNT(*) FROM support_tickets WHERE contact_email LIKE '%@' || $1)
		`, DemoEmailDomain).Scan(&counts[0], &counts[1], &counts[2], &counts[3]); err != nil {
			t.Fatalf("count demo rows: %v", err)
		}
		return counts
	}

	first, err := EnsureDemoData(ctx, pool, options)
	if err != nil {
		t.Fatalf("first EnsureDemoData() error = %v", err)
	}
	seeded := countDemoRows()
	second, err := EnsureDemoData(ctx, pool, options)
	if err != nil {
		t.Fatalf("second EnsureDemoData() error = %v", err)
	}
	if second != first {
		t.Fatalf("second result = %+v, want %+v", second, first)
	}
	if got := countDemoRows(); got != seeded {
		t.Fatalf("rows after rerun = %v, want %v", got, seeded)
	}

	if err := ResetDemoData(ctx, pool); err != nil {
		t.Fatalf("ResetDemoData() error = %v", err)
	}
	if got := countDemoRows(); got != [4]int{} {
		t.Fatalf("rows after reset = %v, want none", got)
	}
}
