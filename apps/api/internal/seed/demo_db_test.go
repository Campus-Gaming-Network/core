package seed

import (
	"context"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

// Runs only when API_DATABASE_URL points at a migrated database. Seeding twice
// must return the same result and leave the same rows, and a reset must remove
// every demo row.
func TestEnsureDemoDataIsIdempotentAndResettable(t *testing.T) {
	ctx := context.Background()
	// The seed picks schools and games from the whole catalog, so it runs in a
	// schema of its own where no other package can delete a row it picked.
	pool := dbtest.NewMigratedSchemaPool(t, "seed")

	if _, err := pool.Exec(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Demo Guard School', 'demo-guard-school')`); err != nil {
		t.Fatalf("insert school: %v", err)
	}

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
