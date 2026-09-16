package admincommand

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceGrantListRevokeSessionsAndRevokeGrant(t *testing.T) {
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
	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Admin Command Test School', $1)
		RETURNING id::text
	`, "admin-command-test-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	insertUser := func(label string) (string, string) {
		t.Helper()
		email := label + "-" + suffix + "@example.test"
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (
				email, password_hash, name, home_school_id,
				age_confirmed_at, email_verified_at
			)
			VALUES ($1, 'hash', $2, $3::uuid, NOW(), NOW())
			RETURNING id::text
		`, email, label, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert %s: %v", label, err)
		}
		return id, email
	}
	actorID, actorEmail := insertUser("command-actor")
	targetID, targetEmail := insertUser("command-target")
	var actorGrantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO site_role_grants (user_id, role, granted_by_user_id, grant_reason)
		VALUES ($1::uuid, 'site_admin', $1::uuid, 'Command test actor')
		RETURNING id::text
	`, actorID).Scan(&actorGrantID); err != nil {
		t.Fatalf("insert actor grant: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_security_events WHERE actor_user_id IN ($1::uuid, $2::uuid) OR metadata ->> 'target_user_id' IN ($1, $2)`, actorID, targetID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_sessions WHERE user_id IN ($1::uuid, $2::uuid)`, actorID, targetID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM site_role_grants WHERE user_id IN ($1::uuid, $2::uuid))`, actorID, targetID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM site_role_grants WHERE user_id IN ($1::uuid, $2::uuid)`, actorID, targetID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, actorID, targetID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	service := NewService(pool)
	grant, err := service.GrantSiteAdmin(ctx, GrantInput{
		TargetEmail: targetEmail, ActorEmail: actorEmail, Reason: "On-call coverage",
	})
	if err != nil {
		t.Fatalf("GrantSiteAdmin() error = %v", err)
	}
	admins, err := service.ListSiteAdmins(ctx)
	if err != nil {
		t.Fatalf("ListSiteAdmins() error = %v", err)
	}
	if !containsAdmin(admins, actorID, actorGrantID) || !containsAdmin(admins, targetID, grant.ID) {
		t.Fatalf("ListSiteAdmins() = %#v", admins)
	}

	tokenHash := make([]byte, 32)
	csrfHash := make([]byte, 32)
	copy(tokenHash, "token-"+suffix)
	copy(csrfHash, "csrf-"+suffix)
	if _, err := pool.Exec(ctx, `
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
	`, targetID, grant.ID, tokenHash, csrfHash, "command-subject-"+suffix, targetEmail); err != nil {
		t.Fatalf("insert target session: %v", err)
	}

	count, err := service.RevokeSessions(ctx, RevokeInput{
		TargetEmail: targetEmail, ActorEmail: actorEmail, Reason: "Recovery drill",
	})
	if err != nil || count != 1 {
		t.Fatalf("RevokeSessions() = %d, %v", count, err)
	}
	var eventCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM admin_security_events
		WHERE event_type = 'admin.session.revoked'
		  AND actor_user_id = $1::uuid
		  AND metadata ->> 'target_user_id' = $2
	`, actorID, targetID).Scan(&eventCount); err != nil || eventCount != 1 {
		t.Fatalf("session revocation security events = %d, %v", eventCount, err)
	}

	revoked, err := service.RevokeSiteAdmin(ctx, RevokeInput{
		TargetEmail: targetEmail, ActorEmail: actorEmail, Reason: "Coverage ended",
	})
	if err != nil || revoked.RevokedAt == nil {
		t.Fatalf("RevokeSiteAdmin() = %#v, %v", revoked, err)
	}
}

func containsAdmin(admins []SiteAdmin, userID, grantID string) bool {
	for _, admin := range admins {
		if admin.UserID == userID && admin.GrantID == grantID {
			return true
		}
	}
	return false
}
