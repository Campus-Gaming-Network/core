package dataexport

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestExportHoldsEveryPartOfOneAccountAndNoOneElses(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "data_export")
	at := "2026-10-01T12:00:00+00:00"

	var userID, otherID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('Home U', 'home-u') RETURNING id),
		     other_school AS (INSERT INTO schools (name, slug) VALUES ('Away U', 'away-u') RETURNING id),
		     member AS (
		       INSERT INTO users (email, password_hash, name, bio, timezone, home_school_id, age_confirmed_at,
		                          email_verified_at, created_at, updated_at)
		       SELECT 'me@example.test', 'secret-hash', 'Me', 'Hi', 'America/Chicago', id, $1, $1, $1, $1 FROM school
		       RETURNING id),
		     other AS (
		       INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		       SELECT 'other@example.test', 'hash', 'Other', id, $1 FROM other_school
		       RETURNING id)
		SELECT member.id::text, other.id::text FROM member, other
	`, at).Scan(&userID, &otherID); err != nil {
		t.Fatalf("insert users: %v", err)
	}

	for _, statement := range []string{
		`INSERT INTO user_social_links (user_id, kind, label, url, created_at) VALUES ($1::uuid, 'url', 'Site', 'https://me.example.test', $2)`,
		`INSERT INTO user_school_follows (user_id, school_id, created_at) SELECT $1::uuid, id, $2 FROM schools WHERE slug = 'away-u'`,
		`INSERT INTO school_admins (school_id, user_id, created_at) SELECT id, $1::uuid, $2 FROM schools WHERE slug = 'home-u'`,
		`INSERT INTO site_role_grants (user_id, role, grant_reason, granted_at) VALUES ($1::uuid, 'site_admin', 'Operator', $2)`,
		`WITH game AS (INSERT INTO games (name, slug) VALUES ('Chess', 'chess') RETURNING id)
		 INSERT INTO user_games (user_id, game_id, list, position, created_at) SELECT $1::uuid, id, 'favorite', 0, $2 FROM game`,
		`WITH team AS (INSERT INTO teams (owner_user_id, name, slug, password_hash) VALUES ($1::uuid, 'Knights', 'knights', 'hash') RETURNING id)
		 INSERT INTO team_members (team_id, user_id, role, created_at) SELECT id, $1::uuid, 'owner', $2 FROM team`,
		`WITH event AS (
		   INSERT INTO events (creator_user_id, host_school_id, title, slug, description, visibility, format, starts_at, ends_at, timezone)
		   SELECT $1::uuid, home_school_id, 'Chess Night', 'chess-night', '', 'public', 'online', $2, $2::timestamptz + INTERVAL '1 hour', 'UTC'
		   FROM users WHERE id = $1::uuid RETURNING id),
		 organizer AS (INSERT INTO event_organizers (event_id, user_id, role, created_at) SELECT id, $1::uuid, 'creator', $2 FROM event),
		 rsvp AS (INSERT INTO event_rsvps (event_id, user_id, response, created_at, updated_at) SELECT id, $1::uuid, 'yes', $2, $2 FROM event)
		 INSERT INTO event_interests (event_id, user_id, created_at) SELECT id, $1::uuid, $2 FROM event`,
		`INSERT INTO support_tickets (submitter_user_id, contact_email, name, subject, message, created_at) VALUES ($1::uuid, 'me@example.test', 'Me', 'Help', 'Please', $2)`,
		`INSERT INTO reports (reporter_user_id, target_type, target_id, reason, created_at) SELECT $1::uuid, 'user', id, 'Spam', $2 FROM users WHERE email = 'other@example.test'`,
		`INSERT INTO notifications (user_id, type, title, body, created_at) VALUES ($1::uuid, 'event.cancelled', 'Cancelled', 'Chess Night was cancelled', $2)`,
		`INSERT INTO user_policy_acceptances (user_id, policy_document_id, accepted_at, source) SELECT $1::uuid, id, $2, 'signup' FROM policy_documents WHERE document_type = 'terms'`,
		`INSERT INTO auth_sessions (user_id, token_hash, expires_at, last_seen_at, created_at) VALUES ($1::uuid, '\x01'::bytea, $2::timestamptz + INTERVAL '30 days', $2, $2)`,
	} {
		if _, err := pool.Exec(ctx, statement, userID, at); err != nil {
			t.Fatalf("insert fixture %q: %v", strings.Fields(statement)[2], err)
		}
	}
	// Someone else's rows in the same tables must stay out of the export.
	for _, statement := range []string{
		`INSERT INTO user_social_links (user_id, kind, label, url) VALUES ($1::uuid, 'url', 'Theirs', 'https://other.example.test')`,
		`INSERT INTO notifications (user_id, type, title, body) VALUES ($1::uuid, 'other', 'Not yours', 'Not yours')`,
		`INSERT INTO support_tickets (submitter_user_id, contact_email, subject, message) VALUES ($1::uuid, 'other@example.test', 'Theirs', 'Theirs')`,
	} {
		if _, err := pool.Exec(ctx, statement, otherID); err != nil {
			t.Fatalf("insert other account fixture: %v", err)
		}
	}

	repository := NewPostgresRepository(pool)
	repository.now = func() time.Time { return time.Date(2026, time.October, 17, 12, 0, 0, 0, time.UTC) }
	export, err := repository.Export(ctx, userID)
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	encoded, err := json.Marshal(export)
	if err != nil {
		t.Fatalf("encode export: %v", err)
	}
	if strings.Contains(string(encoded), "secret-hash") || strings.Contains(string(encoded), "token_hash") {
		t.Fatalf("export carries a secret: %s", encoded)
	}
	var got map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	var termsVersion string
	if err := pool.QueryRow(ctx, `SELECT version FROM policy_documents WHERE document_type = 'terms'`).Scan(&termsVersion); err != nil {
		t.Fatalf("read terms version: %v", err)
	}

	want := map[string]any{
		"format_version": float64(1),
		"exported_at":    "2026-10-17T12:00:00Z",
		"account": map[string]any{
			"id": userID, "email": "me@example.test", "name": "Me", "bio": "Hi",
			"timezone": "America/Chicago", "verification_level": "basic", "account_status": "active",
			"show_in_lists": true, "email_verified_at": at, "age_confirmed_at": at,
			"created_at": at, "updated_at": at,
			"home_school": map[string]any{"name": "Home U", "slug": "home-u"},
		},
		"social_links":       []any{map[string]any{"kind": "url", "label": "Site", "url": "https://me.example.test", "created_at": at}},
		"followed_schools":   []any{map[string]any{"name": "Away U", "slug": "away-u", "followed_at": at}},
		"school_admin_roles": []any{map[string]any{"school_name": "Home U", "school_slug": "home-u", "granted_at": at, "revoked_at": nil}},
		"site_roles":         []any{map[string]any{"role": "site_admin", "granted_at": at, "revoked_at": nil}},
		"game_lists":         []any{map[string]any{"list": "favorite", "position": float64(0), "game_name": "Chess", "game_slug": "chess", "added_at": at}},
		"teams":              []any{map[string]any{"name": "Knights", "slug": "knights", "role": "owner", "joined_at": at}},
		"events_organized": []any{map[string]any{
			"title": "Chess Night", "slug": "chess-night", "role": "creator", "visibility": "public",
			"starts_at": at, "ends_at": "2026-10-01T13:00:00+00:00", "organizer_since": at, "cancelled_at": nil,
		}},
		"rsvps":              []any{map[string]any{"event_title": "Chess Night", "event_slug": "chess-night", "response": "yes", "responded_at": at, "updated_at": at}},
		"interested_events":  []any{map[string]any{"event_title": "Chess Night", "event_slug": "chess-night", "marked_at": at}},
		"support_tickets":    []any{map[string]any{"subject": "Help", "message": "Please", "name": "Me", "contact_email": "me@example.test", "status": "open", "created_at": at}},
		"reports":            []any{map[string]any{"target_type": "user", "target_id": otherID, "reason": "Spam", "status": "open", "created_at": at}},
		"notifications":      []any{map[string]any{"type": "event.cancelled", "title": "Cancelled", "body": "Chess Night was cancelled", "read_at": nil, "created_at": at}},
		"policy_acceptances": []any{map[string]any{"document_type": "terms", "version": termsVersion, "accepted_at": at, "source": "signup"}},
		"sessions":           []any{map[string]any{"created_at": at, "last_seen_at": at, "expires_at": "2026-10-31T12:00:00+00:00", "revoked_at": nil}},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Fatalf("export =\n%s", gotJSON)
	}

	var audits int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM audit_logs WHERE actor_user_id = $1::uuid AND entity_id = $1::uuid AND action = 'user.data_exported'
	`, userID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("export audit rows = %d, %v; want 1", audits, err)
	}

	if _, err := pool.Exec(ctx, `UPDATE users SET account_status = 'deleted', deleted_at = NOW() WHERE id = $1::uuid`, otherID); err != nil {
		t.Fatalf("delete other account: %v", err)
	}
	if _, err := repository.Export(ctx, otherID); !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("Export() of a deleted account error = %v, want %v", err, ErrAccountNotFound)
	}
}
