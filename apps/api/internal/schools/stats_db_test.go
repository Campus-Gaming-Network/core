package schools

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryStatsCountsMembersTeamsAndUpcomingPublicEvents(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "school_stats")
	now := time.Date(2026, time.October, 17, 12, 0, 0, 0, time.UTC)

	insertSchool := func(slug string, active bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO schools (name, slug, is_active) VALUES ($1, $1, $2) RETURNING id::text`, slug, active).Scan(&id); err != nil {
			t.Fatalf("insert school %s: %v", slug, err)
		}
		return id
	}
	homeID := insertSchool("home-school", true)
	otherID := insertSchool("other-school", true)
	insertSchool("empty-school", true)
	inactiveID := insertSchool("inactive-school", false)

	insertUser := func(email, schoolID, status string, listed bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, account_status, show_in_lists, deleted_at)
			VALUES ($1, 'hash', 'Player', $2::uuid, NOW(), $3, $4, CASE WHEN $3 = 'deleted' THEN NOW() END)
			RETURNING id::text`, email, schoolID, status, listed).Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", email, err)
		}
		return id
	}
	hostID := insertUser("host@example.test", homeID, "active", true)
	// Someone who left member lists still counts in the total.
	insertUser("unlisted@example.test", homeID, "active", false)
	insertUser("suspended@example.test", homeID, "suspended", true)
	insertUser("deleted@example.test", homeID, "deleted", true)
	insertUser("away@example.test", otherID, "active", true)
	insertUser("inactive@example.test", inactiveID, "active", true)

	for _, team := range []struct {
		slug    string
		deleted bool
	}{{"home-one", false}, {"home-two", false}, {"home-gone", true}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash, deleted_at)
			VALUES ($1::uuid, $2::uuid, $3, $3, 'hash', CASE WHEN $4 THEN NOW() END)`,
			hostID, homeID, team.slug, team.deleted); err != nil {
			t.Fatalf("insert team %s: %v", team.slug, err)
		}
	}

	for _, event := range []struct {
		slug, schoolID, visibility string
		endsAt                     time.Time
		deleted                    bool
	}{
		{"upcoming", homeID, "public", now.Add(24 * time.Hour), false},
		// An event under way has not ended, so it still counts.
		{"under-way", homeID, "public", now.Add(30 * time.Minute), false},
		{"ended", homeID, "public", now.Add(-time.Hour), false},
		{"private", homeID, "private", now.Add(24 * time.Hour), false},
		{"cancelled", homeID, "public", now.Add(24 * time.Hour), true},
		{"away", otherID, "public", now.Add(24 * time.Hour), false},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO events (creator_user_id, host_school_id, title, slug, description,
				visibility, private_password_hash, format, starts_at, ends_at, timezone, deleted_at)
			VALUES ($1::uuid, $2::uuid, $3, $3, '', $4, CASE WHEN $4 = 'private' THEN 'hash' END,
				'online', $5::timestamptz - INTERVAL '1 hour', $5, 'UTC', CASE WHEN $6 THEN NOW() END)`,
			hostID, event.schoolID, event.slug, event.visibility, event.endsAt, event.deleted); err != nil {
			t.Fatalf("insert event %s: %v", event.slug, err)
		}
	}

	got, err := NewPostgresRepository(pool).Stats(ctx,
		[]string{"other-school", "home-school", "empty-school", "inactive-school", "unknown-school"}, now)
	if err != nil {
		t.Fatalf("Stats() error = %v", err)
	}
	want := []Stats{
		{Slug: "empty-school"},
		{Slug: "home-school", Members: 2, Teams: 2, UpcomingEvents: 2},
		{Slug: "other-school", Members: 1, UpcomingEvents: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Stats() = %+v, want %+v", got, want)
	}
}
