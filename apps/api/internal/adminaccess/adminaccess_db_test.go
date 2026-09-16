package adminaccess

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type adminAccessFixture struct {
	pool       *pgxpool.Pool
	repository *PostgresRepository
	actorID    string
	otherID    string
}

func newAdminAccessFixture(t *testing.T) adminAccessFixture {
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

	suffix := fmt.Sprint(time.Now().UnixNano())
	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Admin Access Test School', $1)
		RETURNING id::text
	`, "admin-access-test-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}

	insertUser := func(label string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (
				email, password_hash, name, home_school_id,
				age_confirmed_at, email_verified_at
			)
			VALUES ($1, 'hash', $2, $3::uuid, NOW(), NOW())
			RETURNING id::text
		`, label+"-"+suffix+"@example.test", label, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert %s: %v", label, err)
		}
		return id
	}
	actorID := insertUser("site-admin-actor")
	otherID := insertUser("site-admin-other")

	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_sessions WHERE user_id IN ($1::uuid, $2::uuid)`, actorID, otherID)
		_, _ = pool.Exec(cleanupCtx, `
			DELETE FROM audit_logs
			WHERE entity_type = 'site_role_grant'
			  AND entity_id IN (
				SELECT id FROM site_role_grants
				WHERE user_id IN ($1::uuid, $2::uuid)
			  )
		`, actorID, otherID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM site_role_grants WHERE user_id IN ($1::uuid, $2::uuid)`, actorID, otherID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, actorID, otherID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	return adminAccessFixture{
		pool:       pool,
		repository: NewPostgresRepository(pool),
		actorID:    actorID,
		otherID:    otherID,
	}
}

func TestPostgresRepositoryGrantLookupRevokeAndAudit(t *testing.T) {
	fixture := newAdminAccessFixture(t)
	ctx := context.Background()

	first, err := fixture.repository.BootstrapSiteAdmin(ctx, BootstrapInput{
		UserID:           fixture.actorID,
		OperatorIdentity: " deployment-operator@example.test ",
		Reason:           " Initial administrator bootstrap ",
	})
	if err != nil {
		t.Fatalf("BootstrapSiteAdmin() error = %v", err)
	}
	if first.UserID != fixture.actorID || first.Role != RoleSiteAdmin || first.GrantReason != "Initial administrator bootstrap" {
		t.Fatalf("GrantRole(first) = %#v", first)
	}
	if first.GrantedByUserID != nil {
		t.Fatalf("BootstrapSiteAdmin().GrantedByUserID = %v, want nil", first.GrantedByUserID)
	}
	var bootstrapActor *string
	var bootstrapMetadata []byte
	if err := fixture.pool.QueryRow(ctx, `
		SELECT actor_user_id::text, metadata
		FROM audit_logs
		WHERE action = 'site_role_grant.bootstrapped' AND entity_id = $1::uuid
	`, first.ID).Scan(&bootstrapActor, &bootstrapMetadata); err != nil {
		t.Fatalf("query bootstrap audit: %v", err)
	}
	var bootstrapDetails grantAuditMetadata
	if err := json.Unmarshal(bootstrapMetadata, &bootstrapDetails); err != nil {
		t.Fatalf("decode bootstrap audit metadata: %v", err)
	}
	if bootstrapActor != nil || !bootstrapDetails.Bootstrap ||
		bootstrapDetails.OperatorIdentity != "deployment-operator@example.test" {
		t.Fatalf("bootstrap audit actor/metadata = %v/%#v", bootstrapActor, bootstrapDetails)
	}

	lookedUp, err := fixture.repository.ActiveGrant(ctx, fixture.actorID, RoleSiteAdmin)
	if err != nil {
		t.Fatalf("ActiveGrant() error = %v", err)
	}
	if lookedUp.ID != first.ID {
		t.Fatalf("ActiveGrant().ID = %q, want %q", lookedUp.ID, first.ID)
	}

	if _, err := fixture.repository.BootstrapSiteAdmin(ctx, BootstrapInput{
		UserID:           fixture.otherID,
		OperatorIdentity: "deployment-operator@example.test",
		Reason:           "Second bootstrap attempt",
	}); !errors.Is(err, ErrBootstrapUnavailable) {
		t.Fatalf("second BootstrapSiteAdmin() error = %v, want ErrBootstrapUnavailable", err)
	}

	if _, err := fixture.repository.GrantRole(ctx, GrantInput{
		UserID:      fixture.actorID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Duplicate grant attempt",
	}); !errors.Is(err, ErrGrantAlreadyActive) {
		t.Fatalf("duplicate GrantRole() error = %v, want ErrGrantAlreadyActive", err)
	}
	if _, err := fixture.pool.Exec(ctx, `
		INSERT INTO site_role_grants (
			user_id, role, granted_by_user_id, grant_reason
		)
		VALUES ($1::uuid, 'site_admin', $1::uuid, 'Direct duplicate attempt')
	`, fixture.actorID); err == nil {
		t.Fatal("direct duplicate active grant succeeded, want database uniqueness failure")
	} else {
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.ConstraintName != "site_role_grants_one_active_idx" {
			t.Fatalf("direct duplicate error = %v, want active-grant unique index", err)
		}
	}

	if _, err := fixture.repository.RevokeRole(ctx, RevokeInput{
		UserID:      fixture.actorID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Cannot remove the only administrator",
	}); !errors.Is(err, ErrLastActiveSiteAdmin) {
		t.Fatalf("last-admin RevokeRole() error = %v, want ErrLastActiveSiteAdmin", err)
	}

	second, err := fixture.repository.GrantRole(ctx, GrantInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Add a second administrator",
	})
	if err != nil {
		t.Fatalf("GrantRole(second) error = %v", err)
	}
	if second.UserID != fixture.otherID {
		t.Fatalf("GrantRole(second).UserID = %q, want %q", second.UserID, fixture.otherID)
	}
	if second.GrantedByUserID == nil || *second.GrantedByUserID != fixture.actorID {
		t.Fatalf("GrantRole(second).GrantedByUserID = %v, want %q", second.GrantedByUserID, fixture.actorID)
	}
	var adminSessionID string
	if err := fixture.pool.QueryRow(ctx, `
		INSERT INTO admin_sessions (
			user_id, grant_id, token_hash, csrf_token_hash, authn_method,
			access_issuer, access_subject, access_email, authenticated_at, last_seen_at,
			idle_expires_at, absolute_expires_at
		)
		VALUES (
			$1::uuid, $2::uuid, $3, $4, 'cloudflare_access',
			'https://access.example.test', 'operator-subject', 'operator@example.test', NOW(), NOW(),
			NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '8 hours'
		)
		RETURNING id::text
	`, fixture.otherID, second.ID,
		[]byte("12345678901234567890123456789012"),
		[]byte("abcdefghijklmnopqrstuvwxyzABCDEF")).Scan(&adminSessionID); err != nil {
		t.Fatalf("insert admin session: %v", err)
	}

	revoked, err := fixture.repository.RevokeRole(ctx, RevokeInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Access no longer required",
	})
	if err != nil {
		t.Fatalf("RevokeRole() error = %v", err)
	}
	if revoked.RevokedAt == nil || revoked.RevokedByUserID == nil || *revoked.RevokedByUserID != fixture.actorID ||
		revoked.RevokeReason == nil || *revoked.RevokeReason != "Access no longer required" {
		t.Fatalf("RevokeRole() = %#v, want revocation provenance", revoked)
	}
	if _, err := fixture.repository.ActiveGrant(ctx, fixture.otherID, RoleSiteAdmin); !errors.Is(err, ErrGrantNotFound) {
		t.Fatalf("ActiveGrant(revoked) error = %v, want ErrGrantNotFound", err)
	}
	var sessionRevokedAt *time.Time
	var sessionRevocationReason *string
	if err := fixture.pool.QueryRow(ctx, `
		SELECT revoked_at, revocation_reason
		FROM admin_sessions
		WHERE id = $1::uuid
	`, adminSessionID).Scan(&sessionRevokedAt, &sessionRevocationReason); err != nil {
		t.Fatalf("query revoked admin session: %v", err)
	}
	if sessionRevokedAt == nil || sessionRevocationReason == nil || *sessionRevocationReason != "site role grant revoked" {
		t.Fatalf("admin session revocation = %v/%v, want explicit grant revocation", sessionRevokedAt, sessionRevocationReason)
	}

	var actions []string
	rows, err := fixture.pool.Query(ctx, `
		SELECT action
		FROM audit_logs
		WHERE entity_type = 'site_role_grant' AND entity_id = $1::uuid
		ORDER BY created_at, id
	`, second.ID)
	if err != nil {
		t.Fatalf("query audit actions: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var action string
		if err := rows.Scan(&action); err != nil {
			t.Fatalf("scan audit action: %v", err)
		}
		actions = append(actions, action)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate audit actions: %v", err)
	}
	if len(actions) != 2 || actions[0] != "site_role_grant.granted" || actions[1] != "site_role_grant.revoked" {
		t.Fatalf("audit actions = %#v, want grant then revoke", actions)
	}

	var before, after []byte
	if err := fixture.pool.QueryRow(ctx, `
		SELECT before_json, after_json
		FROM audit_logs
		WHERE action = 'site_role_grant.revoked' AND entity_id = $1::uuid
	`, second.ID).Scan(&before, &after); err != nil {
		t.Fatalf("query revocation audit: %v", err)
	}
	var beforeGrant, afterGrant Grant
	if err := json.Unmarshal(before, &beforeGrant); err != nil {
		t.Fatalf("decode revocation audit before: %v", err)
	}
	if err := json.Unmarshal(after, &afterGrant); err != nil {
		t.Fatalf("decode revocation audit after: %v", err)
	}
	if beforeGrant.RevokedAt != nil || afterGrant.RevokedAt == nil {
		t.Fatalf("revocation audit transition = %#v -> %#v", beforeGrant, afterGrant)
	}
}

func TestPostgresRepositoryRejectsIneligibleUsersAndPreservesGrantHistory(t *testing.T) {
	fixture := newAdminAccessFixture(t)
	ctx := context.Background()
	if _, err := fixture.repository.BootstrapSiteAdmin(ctx, BootstrapInput{
		UserID:           fixture.actorID,
		OperatorIdentity: "deployment-operator@example.test",
		Reason:           "Initial administrator bootstrap",
	}); err != nil {
		t.Fatalf("BootstrapSiteAdmin() error = %v", err)
	}

	if _, err := fixture.pool.Exec(ctx, `
		UPDATE users SET account_status = 'suspended' WHERE id = $1::uuid
	`, fixture.otherID); err != nil {
		t.Fatalf("suspend other user: %v", err)
	}
	if _, err := fixture.repository.GrantRole(ctx, GrantInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Should be rejected",
	}); !errors.Is(err, ErrUserNotEligible) {
		t.Fatalf("GrantRole(suspended user) error = %v, want ErrUserNotEligible", err)
	}

	if _, err := fixture.pool.Exec(ctx, `
		UPDATE users SET account_status = 'active' WHERE id = $1::uuid
	`, fixture.otherID); err != nil {
		t.Fatalf("reactivate other user: %v", err)
	}
	grant, err := fixture.repository.GrantRole(ctx, GrantInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "History preservation test",
	})
	if err != nil {
		t.Fatalf("GrantRole() error = %v", err)
	}

	if _, err := fixture.pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, fixture.otherID); err == nil {
		t.Fatal("deleting a user with grant history succeeded, want restrictive foreign key")
	}
	if _, err := fixture.repository.ActiveGrant(ctx, fixture.otherID, RoleSiteAdmin); err != nil {
		t.Fatalf("ActiveGrant() after blocked user delete error = %v", err)
	}

	var grantCount int
	if err := fixture.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM site_role_grants WHERE id = $1::uuid
	`, grant.ID).Scan(&grantCount); err != nil {
		t.Fatalf("count preserved grant: %v", err)
	}
	if grantCount != 1 {
		t.Fatalf("preserved grant count = %d, want 1", grantCount)
	}
}

func TestPostgresRepositoryRequiresSiteAdminActorForGrantMutations(t *testing.T) {
	fixture := newAdminAccessFixture(t)
	ctx := context.Background()

	if _, err := fixture.repository.GrantRole(ctx, GrantInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Unauthorized grant attempt",
	}); !errors.Is(err, ErrSiteAdminRequired) {
		t.Fatalf("GrantRole(non-admin actor) error = %v, want ErrSiteAdminRequired", err)
	}

	if _, err := fixture.repository.BootstrapSiteAdmin(ctx, BootstrapInput{
		UserID:           fixture.actorID,
		OperatorIdentity: "deployment-operator@example.test",
		Reason:           "Initial administrator bootstrap",
	}); err != nil {
		t.Fatalf("BootstrapSiteAdmin() error = %v", err)
	}
	if _, err := fixture.repository.GrantRole(ctx, GrantInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Authorized grant",
	}); err != nil {
		t.Fatalf("GrantRole(admin actor) error = %v", err)
	}
	if _, err := fixture.pool.Exec(ctx, `
		UPDATE users SET account_status = 'suspended' WHERE id = $1::uuid
	`, fixture.actorID); err != nil {
		t.Fatalf("suspend actor: %v", err)
	}
	if _, err := fixture.repository.RevokeRole(ctx, RevokeInput{
		UserID:      fixture.otherID,
		Role:        RoleSiteAdmin,
		ActorUserID: fixture.actorID,
		Reason:      "Suspended actor attempt",
	}); !errors.Is(err, ErrSiteAdminRequired) {
		t.Fatalf("RevokeRole(suspended actor) error = %v, want ErrSiteAdminRequired", err)
	}
}
