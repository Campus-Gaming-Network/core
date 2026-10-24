package sitemap

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryEntriesListsOnlyPublicOpenRecords(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "sitemap")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	var schoolID, userID string
	schoolID = dbtest.InsertSchool(t, pool, "Sitemap School", "sitemap-school")
	if _, err := pool.Exec(ctx, `
		INSERT INTO schools (name, slug, is_active) VALUES ('Inactive School', 'inactive-school', FALSE)
	`); err != nil {
		t.Fatalf("insert inactive school: %v", err)
	}
	userID = dbtest.InsertUser(t, pool, schoolID, "sitemap@example.test", "Sitemap Organizer")

	now := time.Date(2031, time.May, 10, 12, 0, 0, 0, time.UTC)
	insertEvent := func(slug, visibility string, audience *string, endsAt time.Time, deletedAt *time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO events (creator_user_id, host_school_id, title, slug, description,
				visibility, private_password_hash, audience, format, starts_at, ends_at, timezone, deleted_at)
			VALUES ($1::uuid, $2::uuid, $3, $3, '', $4, CASE WHEN $4 = 'private' THEN 'hash' END, $5, 'online', $6::timestamptz - INTERVAL '1 hour', $6, 'UTC', $7)
		`, userID, schoolID, slug, visibility, audience, endsAt, deletedAt); err != nil {
			t.Fatalf("insert event %s: %v", slug, err)
		}
	}
	audience := func(value string) *string { return &value }
	future := now.Add(24 * time.Hour)
	insertEvent("public-open", "public", audience("open"), future, nil)
	insertEvent("public-collegiate", "public", audience("collegiate"), future, nil)
	insertEvent("public-legacy", "public", nil, future, nil)
	insertEvent("public-campus", "public", audience("campus"), future, nil)
	insertEvent("public-members", "public", audience("members"), future, nil)
	insertEvent("unlisted-open", "unlisted", audience("open"), future, nil)
	insertEvent("private-open", "private", audience("open"), future, nil)
	insertEvent("public-deleted", "public", audience("open"), future, &now)
	insertEvent("public-long-ago", "public", audience("open"), now.Add(-200*24*time.Hour), nil)

	if _, err := pool.Exec(ctx, `
		INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
		VALUES ($1::uuid, $2::uuid, 'Live Team', 'live-team', 'hash')
	`, userID, schoolID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash, deleted_at)
		VALUES ($1::uuid, $2::uuid, 'Gone Team', 'gone-team', 'hash', NOW())
	`, userID, schoolID); err != nil {
		t.Fatalf("insert deleted team: %v", err)
	}

	repository := &PostgresRepository{pool: pool, now: func() time.Time { return now }}
	entries, err := repository.Entries(ctx)
	if err != nil {
		t.Fatalf("Entries() error = %v", err)
	}

	slugs := func(list []Entry) []string {
		result := []string{}
		for _, entry := range list {
			result = append(result, entry.Slug)
		}
		return result
	}
	got := map[string][]string{
		"events":  slugs(entries.Events),
		"schools": slugs(entries.Schools),
		"teams":   slugs(entries.Teams),
	}
	want := map[string][]string{
		"events":  {"public-collegiate", "public-legacy", "public-open"},
		"schools": {"sitemap-school"},
		"teams":   {"live-team"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("entries = %v, want %v", got, want)
	}
}
