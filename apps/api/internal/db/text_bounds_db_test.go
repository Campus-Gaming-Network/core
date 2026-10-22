package db

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

// Runs only when API_DATABASE_URL points at a database. Each case writes one
// value that the API validators refuse and expects the named CHECK constraint
// to refuse it too. Postgres evaluates CHECK constraints before foreign keys,
// so rows may reference ids that do not exist, except where a BEFORE trigger
// needs a real school.
func TestTextBoundConstraints(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "textbounds")
	if _, err := pool.Exec(ctx, `INSERT INTO schools (name, slug) VALUES ('Fixture University', 'fixture-university')`); err != nil {
		t.Fatalf("insert school: %v", err)
	}

	const eventInsert = `
		INSERT INTO events (creator_user_id, host_school_id, slug, visibility, format,
		                    starts_at, ends_at, title, description, location_name,
		                    address, online_url, payment_note)
		VALUES (gen_random_uuid(), (SELECT id FROM schools), 'bad', 'public', 'online',
		        now(), now() + interval '1 hour', 'Title', '', NULL, NULL, NULL, NULL)`
	const userInsert = `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('bad@example.test', 'x', 'Name', (SELECT id FROM schools), now())`

	tests := []struct {
		constraint string
		query      string
	}{
		{"events_title_length", strings.Replace(eventInsert, "'Title'", "'   '", 1)},
		{"events_description_length", strings.Replace(eventInsert, "'Title', ''", "'Title', '"+strings.Repeat("a", 5001)+"'", 1)},
		{"events_location_name_length", strings.Replace(eventInsert, "'', NULL, NULL", "'', '"+strings.Repeat("a", 201)+"', NULL", 1)},
		{"events_address_length", strings.Replace(eventInsert, "NULL, NULL, NULL, NULL)", "NULL, '"+strings.Repeat("a", 1001)+"', NULL, NULL)", 1)},
		{"events_online_url_length", strings.Replace(eventInsert, "NULL, NULL, NULL, NULL)", "NULL, NULL, '"+strings.Repeat("a", 501)+"', NULL)", 1)},
		{"events_payment_note_length", strings.Replace(eventInsert, "NULL, NULL, NULL, NULL)", "NULL, NULL, NULL, '"+strings.Repeat("a", 1001)+"')", 1)},
		{"teams_name_length", `INSERT INTO teams (owner_user_id, name, slug, password_hash)
			VALUES (gen_random_uuid(), '  ', 'bad', 'x')`},
		{"teams_description_length", `INSERT INTO teams (owner_user_id, name, slug, password_hash, description)
			VALUES (gen_random_uuid(), 'Name', 'bad', 'x', repeat('a', 5001))`},
		{"users_name_length", strings.Replace(userInsert, "'Name'", "''", 1)},
		{"users_bio_length", `INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, bio)
			VALUES ('bad@example.test', 'x', 'Name', (SELECT id FROM schools), now(), repeat('a', 2001))`},
		{"user_social_links_label_length", `INSERT INTO user_social_links (user_id, label, kind, url)
			VALUES (gen_random_uuid(), repeat('a', 41), 'url', 'https://example.test')`},
		{"user_social_links_url_length", `INSERT INTO user_social_links (user_id, label, kind, url)
			VALUES (gen_random_uuid(), 'Label', 'url', 'https://example.test/' || repeat('a', 500))`},
		{"reports_reason_length", `INSERT INTO reports (reporter_user_id, target_type, target_id, reason)
			VALUES (gen_random_uuid(), 'event', gen_random_uuid(), repeat('a', 2001))`},
		{"support_tickets_name_length", `INSERT INTO support_tickets (contact_email, name, subject, message)
			VALUES ('a@example.test', repeat('a', 121), 'Subject', 'Message')`},
		{"support_tickets_subject_length", `INSERT INTO support_tickets (contact_email, name, subject, message)
			VALUES ('a@example.test', '', repeat('a', 161), 'Message')`},
		{"support_tickets_message_length", `INSERT INTO support_tickets (contact_email, name, subject, message)
			VALUES ('a@example.test', '', 'Subject', repeat('a', 5001))`},
	}
	for _, test := range tests {
		_, err := pool.Exec(ctx, test.query)
		var pgError *pgconn.PgError
		if !errors.As(err, &pgError) || pgError.ConstraintName != test.constraint {
			t.Errorf("%s: insert error = %v, want constraint %s", test.constraint, err, test.constraint)
		}
	}

	unvalidated := queryStrings(ctx, t, pool, `
		SELECT conrelid::regclass::text || ' (' || conname || ')'
		FROM pg_constraint
		WHERE contype = 'c'
		  AND connamespace = current_schema()::regnamespace
		  AND NOT convalidated
		ORDER BY 1`)
	if len(unvalidated) != 0 {
		t.Errorf("unvalidated check constraints = %v, want none", unvalidated)
	}
}
