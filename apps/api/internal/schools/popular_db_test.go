package schools

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Popularity is a school's active member accounts plus the public events it
// hosts. The shared test database may hold other schools' activity, so the
// test checks the order of its own schools relative to one another.
func TestListPopularRanksByMembersPlusPublicEvents(t *testing.T) {
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

	school := func(label string, active bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO schools (name, slug, is_active) VALUES ($1, $2, $3) RETURNING id::text
		`, "Popularity "+label, "popularity-"+label+"-"+suffix, active).Scan(&id); err != nil {
			t.Fatalf("insert school %s: %v", label, err)
		}
		return id
	}
	// Each school's activity, in the order it should rank.
	events := school("events", true)      // 1 member + 3 public events = 4
	members := school("members", true)    // 3 members + 0 events = 3
	tied := school("a-tied", true)        // 1 member + 2 public events = 3, fewer members
	single := school("single", true)      // 1 member = 1
	idle := school("idle", true)          // nothing
	inactive := school("inactive", false) // busy but inactive
	counted := school("counted", true)    // only uncounted activity

	var creator string
	sequence := 0
	user := func(schoolID, status string, deleted bool) string {
		t.Helper()
		var id string
		sequence++
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, account_status, deleted_at)
			VALUES ($1, 'hash', 'Member', $2::uuid, NOW(), $3, CASE WHEN $4 THEN NOW() END)
			RETURNING id::text
		`, fmt.Sprintf("popularity-%s-%d@example.test", suffix, sequence), schoolID, status, deleted).Scan(&id); err != nil {
			t.Fatalf("insert user: %v", err)
		}
		return id
	}
	event := func(schoolID, visibility string, deleted bool) {
		t.Helper()
		sequence++
		slug := fmt.Sprintf("popularity-event-%s-%d", suffix, sequence)
		var password any
		if visibility == "private" {
			password = "hash"
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO events (creator_user_id, host_school_id, title, slug, visibility, format, starts_at, ends_at, private_password_hash, deleted_at)
			VALUES ($1::uuid, $2::uuid, 'Popularity event', $3, $4, 'online', NOW() + interval '1 day', NOW() + interval '2 days', $5, CASE WHEN $6 THEN NOW() END)
		`, creator, schoolID, slug, visibility, password, deleted); err != nil {
			t.Fatalf("insert event: %v", err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM events WHERE slug LIKE 'popularity-event-%'`)
		_, _ = pool.Exec(bg, `DELETE FROM users WHERE email LIKE 'popularity-%@example.test'`)
		_, _ = pool.Exec(bg, `DELETE FROM schools WHERE slug LIKE '%-'||$1`, suffix)
	})

	creator = user(events, "active", false)
	event(events, "public", false)
	event(events, "public", false)
	event(events, "public", false)
	for range 3 {
		user(members, "active", false)
	}
	user(tied, "active", false)
	event(tied, "public", false)
	event(tied, "public", false)
	user(single, "active", false)
	// None of this counts: suspended and deleted accounts, private, unlisted,
	// and cancelled events, and a school that is not active.
	user(counted, "suspended", false)
	user(counted, "active", true)
	event(counted, "private", false)
	event(counted, "unlisted", false)
	event(counted, "public", true)
	for range 5 {
		user(inactive, "active", false)
	}
	_ = idle

	ranked, err := NewPostgresRepository(pool).ListPopular(ctx, MaximumPopularLimit)
	if err != nil {
		t.Fatalf("ListPopular() error = %v", err)
	}

	var order []string
	for _, entry := range ranked {
		switch entry.ID {
		case events, members, tied, single, idle, inactive, counted:
			order = append(order, entry.Name)
		}
	}
	// "a-tied" sorts first by name, so only the member count puts "members" ahead.
	want := []string{"Popularity events", "Popularity members", "Popularity a-tied", "Popularity single"}
	if !slices.Equal(order, want) {
		t.Fatalf("order = %v, want %v (idle, inactive, and uncounted-only schools left out)", order, want)
	}
}
