package adminsecurity

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

type securityFixture struct {
	pool      *pgxpool.Pool
	userID    string
	sessionID string
}

func newSecurityFixture(t *testing.T) securityFixture {
	t.Helper()
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
	unlock, err := dbtest.LockSiteRoleGrantTests(ctx, pool)
	if err != nil {
		t.Fatalf("lock site-role grant tests: %v", err)
	}
	t.Cleanup(func() {
		if err := unlock(context.Background()); err != nil {
			t.Errorf("unlock site-role grant tests: %v", err)
		}
	})

	suffix := fmt.Sprint(time.Now().UnixNano())
	var schoolID, userID, grantID, sessionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Admin Security Test School', $1)
		RETURNING id::text
	`, "admin-security-test-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (
			email, password_hash, name, home_school_id,
			age_confirmed_at, email_verified_at
		)
		VALUES ($1, 'hash', 'Security Event Admin', $2::uuid, NOW(), NOW())
		RETURNING id::text
	`, "admin-security-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO site_role_grants (user_id, role, granted_by_user_id, grant_reason)
		VALUES ($1::uuid, 'site_admin', $1::uuid, 'Security event test')
		RETURNING id::text
	`, userID).Scan(&grantID); err != nil {
		t.Fatalf("insert grant: %v", err)
	}
	tokenHash := make([]byte, 32)
	csrfHash := make([]byte, 32)
	copy(tokenHash, suffix)
	copy(csrfHash, "csrf-"+suffix)
	if err := pool.QueryRow(ctx, `
		INSERT INTO admin_sessions (
			user_id, grant_id, token_hash, csrf_token_hash, authn_method,
			access_issuer, access_subject, access_email, authenticated_at,
			last_seen_at, idle_expires_at, absolute_expires_at
		)
		VALUES (
			$1::uuid, $2::uuid, $3, $4, 'cloudflare_access',
			'https://cgn.cloudflareaccess.com', $5, $6, NOW(), NOW(),
			NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '8 hours'
		)
		RETURNING id::text
	`, userID, grantID, tokenHash, csrfHash, "subject-"+suffix,
		"admin-security-"+suffix+"@example.test").Scan(&sessionID); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_security_events WHERE actor_user_id = $1::uuid`, userID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_sessions WHERE id = $1::uuid`, sessionID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM audit_logs WHERE entity_id = $1::uuid`, grantID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM site_role_grants WHERE id = $1::uuid`, grantID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1::uuid`, userID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	return securityFixture{pool: pool, userID: userID, sessionID: sessionID}
}

func TestPostgresStoreInsertAndList(t *testing.T) {
	fixture := newSecurityFixture(t)
	store := NewPostgresStore(fixture.pool)
	ctx := context.Background()
	status := 403

	inserted, err := store.Insert(ctx, WriteInput{
		Type: EventAuthorizationDenied, Outcome: OutcomeDenied,
		ActorUserID: fixture.userID, AdminSessionID: fixture.sessionID,
		RequestID: "security-test-request", NetworkIdentifierHash: make([]byte, 32),
		Metadata: Metadata{ReasonCode: "missing_capability", ResourceType: "school",
			Operation: "schools.manage", HTTPStatus: &status},
	})
	if err != nil {
		t.Fatalf("Insert() error = %v", err)
	}
	if inserted.ID == "" || inserted.ActorUserID != fixture.userID ||
		inserted.AdminSessionID != fixture.sessionID || inserted.Metadata.ReasonCode != "missing_capability" {
		t.Fatalf("Insert() = %#v", inserted)
	}

	events, err := store.List(ctx, ListParams{
		Type: EventAuthorizationDenied, ActorUserID: fixture.userID, Limit: 10,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(events) != 1 || events[0].ID != inserted.ID {
		t.Fatalf("List() = %#v, want inserted event", events)
	}

	older, err := store.List(ctx, ListParams{
		ActorUserID: fixture.userID, BeforeTime: &inserted.OccurredAt,
		BeforeID: inserted.ID, Limit: 10,
	})
	if err != nil {
		t.Fatalf("List(cursor) error = %v", err)
	}
	if len(older) != 0 {
		t.Fatalf("List(cursor) = %#v, want empty", older)
	}
}

func TestAdminSecurityEventDatabaseConstraintsRejectRawNetworkIdentifiers(t *testing.T) {
	fixture := newSecurityFixture(t)
	if _, err := fixture.pool.Exec(context.Background(), `
		INSERT INTO admin_security_events (
			event_type, outcome, actor_user_id, network_identifier_hash
		)
		VALUES ('admin.authorization.denied', 'denied', $1::uuid, $2)
	`, fixture.userID, []byte("192.0.2.1")); err == nil {
		t.Fatal("raw-sized network identifier insert succeeded, want database rejection")
	}
}
