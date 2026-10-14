package maintenance

import (
	"bytes"
	"context"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Fixed-clock coverage for the admin session and email outbox purges, checked
// at the exact cutoffs and including the rows that must survive.
func TestSweeperPurgesAdminSessionsAndEmailOutbox(t *testing.T) {
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

	now := time.Date(2030, 1, 15, 12, 0, 0, 0, time.UTC)
	var schoolID, userID, grantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Purge School', 'purge-school')
		RETURNING id::text`).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('purge@example.test', 'x', 'Purge', $1::uuid, NOW())
		RETURNING id::text`, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO site_role_grants (user_id, role, grant_reason)
		VALUES ($1::uuid, 'site_admin', 'purge test')
		RETURNING id::text`, userID).Scan(&grantID); err != nil {
		t.Fatalf("insert grant: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM admin_security_events WHERE actor_user_id = $1::uuid`, userID)
		_, _ = pool.Exec(c, `DELETE FROM admin_sessions WHERE user_id = $1::uuid`, userID)
		_, _ = pool.Exec(c, `DELETE FROM email_outbox WHERE idempotency_key LIKE 'purge-test-%'`)
		_, _ = pool.Exec(c, `DELETE FROM site_role_grants WHERE id = $1::uuid`, grantID)
		_, _ = pool.Exec(c, `DELETE FROM users WHERE id = $1::uuid`, userID)
		_, _ = pool.Exec(c, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	hour := time.Hour
	sessions := []struct {
		name     string
		idle     time.Duration // idle expiry relative to now
		revoked  *time.Duration
		audited  bool
		wantKept bool
	}{
		{name: "expired", idle: -24*hour - time.Second},
		{name: "expired-within-grace", idle: -23 * hour, wantKept: true},
		{name: "live", idle: hour, wantKept: true},
		{name: "revoked-long-ago", idle: hour, revoked: durationPtr(-48 * hour)},
		{name: "expired-but-audited", idle: -48 * hour, audited: true, wantKept: true},
	}
	wantSessions := map[string]bool{}
	for i, s := range sessions {
		var revokedAt *time.Time
		var reason *string
		if s.revoked != nil {
			r := now.Add(*s.revoked)
			revokedAt = &r
			text := "test"
			reason = &text
		}
		lastSeen := now.Add(s.idle - time.Minute)
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO admin_sessions (
				user_id, grant_id, token_hash, csrf_token_hash, authn_method,
				access_issuer, access_subject, access_email, authenticated_at,
				last_seen_at, idle_expires_at, absolute_expires_at, revoked_at,
				revocation_reason, created_at)
			VALUES ($1::uuid, $2::uuid, $3, $4, 'cloudflare_access', 'issuer', $5,
				'purge@example.test', $6, $6, $7, $8, $9, $10, $11)
			RETURNING id::text`,
			userID, grantID, bytes.Repeat([]byte{byte(i + 1)}, 32), bytes.Repeat([]byte{byte(i + 101)}, 32), s.name,
			lastSeen, now.Add(s.idle), now.Add(s.idle).Add(hour), revokedAt, reason, now.Add(-100*24*hour),
		).Scan(&id); err != nil {
			t.Fatalf("insert admin session %s: %v", s.name, err)
		}
		if s.audited {
			if _, err := pool.Exec(ctx, `
				INSERT INTO admin_security_events (event_type, outcome, actor_user_id, admin_session_id)
				VALUES ('session.test', 'succeeded', $1::uuid, $2::uuid)`, userID, id); err != nil {
				t.Fatalf("insert security event: %v", err)
			}
		}
		if s.wantKept {
			wantSessions[s.name] = true
		}
	}

	outbox := []struct {
		key       string
		delivered *time.Duration
		failed    *time.Duration
	}{
		{key: "delivered-old", delivered: durationPtr(-30*24*hour - time.Second)},
		{key: "delivered-recent", delivered: durationPtr(-29 * 24 * hour)},
		{key: "failed-old", failed: durationPtr(-31 * 24 * hour)},
		{key: "pending-old"},
	}
	for _, o := range outbox {
		var delivered, failed *time.Time
		if o.delivered != nil {
			d := now.Add(*o.delivered)
			delivered = &d
		}
		if o.failed != nil {
			f := now.Add(*o.failed)
			failed = &f
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO email_outbox (kind, recipient, payload, idempotency_key, delivered_at, failed_at, created_at)
			VALUES ('password_reset', 'purge@example.test', '{}', $1, $2, $3, $4)`,
			"purge-test-"+o.key, delivered, failed, now.Add(-90*24*hour)); err != nil {
			t.Fatalf("insert outbox %s: %v", o.key, err)
		}
	}

	sweeper := NewSweeper(pool, nil)
	sweeper.now = func() time.Time { return now }
	result, err := sweeper.Run(ctx)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if result.AdminSessions != 2 || result.EmailOutbox != 2 {
		t.Fatalf("deleted admin_sessions=%d email_outbox=%d, want 2 and 2", result.AdminSessions, result.EmailOutbox)
	}

	gotSessions := map[string]bool{}
	rows, err := pool.Query(ctx, `SELECT access_subject FROM admin_sessions WHERE user_id = $1::uuid`, userID)
	if err != nil {
		t.Fatalf("query sessions: %v", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		gotSessions[name] = true
	}
	rows.Close()
	if !reflect.DeepEqual(gotSessions, wantSessions) {
		t.Fatalf("surviving admin sessions = %v, want %v", gotSessions, wantSessions)
	}

	var gotKeys []string
	keys, err := pool.Query(ctx, `SELECT idempotency_key FROM email_outbox WHERE idempotency_key LIKE 'purge-test-%' ORDER BY 1`)
	if err != nil {
		t.Fatalf("query outbox: %v", err)
	}
	for keys.Next() {
		var key string
		if err := keys.Scan(&key); err != nil {
			t.Fatalf("scan: %v", err)
		}
		gotKeys = append(gotKeys, key)
	}
	keys.Close()
	if want := []string{"purge-test-delivered-recent", "purge-test-pending-old"}; !reflect.DeepEqual(gotKeys, want) {
		t.Fatalf("surviving outbox keys = %v, want %v", gotKeys, want)
	}

	again, err := sweeper.Run(ctx)
	if err != nil {
		t.Fatalf("second Run() error = %v", err)
	}
	if again.AdminSessions != 0 || again.EmailOutbox != 0 {
		t.Fatalf("second pass = %+v, want nothing deleted", again)
	}
}

func durationPtr(d time.Duration) *time.Duration { return &d }
