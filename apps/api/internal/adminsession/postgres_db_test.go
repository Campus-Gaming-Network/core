package adminsession

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

type adminSessionFixture struct {
	pool    *pgxpool.Pool
	userID  string
	grantID string
	email   string
}

func newAdminSessionFixture(t *testing.T) adminSessionFixture {
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
	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Admin Session Test School', $1)
		RETURNING id::text
	`, "admin-session-test-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	email := "admin-session-" + suffix + "@example.test"
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (
			email, password_hash, email_verified_at, name,
			home_school_id, age_confirmed_at
		)
		VALUES ($1, 'hash', NOW(), 'Admin Session User', $2::uuid, NOW())
		RETURNING id::text
	`, email, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	var grantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO site_role_grants (
			user_id, role, granted_by_user_id, grant_reason
		)
		VALUES ($1::uuid, 'site_admin', $1::uuid, 'Admin session test')
		RETURNING id::text
	`, userID).Scan(&grantID); err != nil {
		t.Fatalf("insert site role grant: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_sessions WHERE user_id = $1::uuid`, userID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM audit_logs WHERE entity_type = 'site_role_grant' AND entity_id IN (SELECT id FROM site_role_grants WHERE user_id = $1::uuid)`, userID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM site_role_grants WHERE user_id = $1::uuid`, userID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1::uuid`, userID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	return adminSessionFixture{pool: pool, userID: userID, grantID: grantID, email: email}
}

func TestPostgresRepositorySessionLifecycleAndGrantBinding(t *testing.T) {
	fixture := newAdminSessionFixture(t)
	ctx := context.Background()
	repository := NewPostgresRepository(fixture.pool)
	service, err := NewService(repository, 30*time.Minute, 8*time.Hour)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	fixedNow := time.Now().UTC().Truncate(time.Millisecond)
	service.now = func() time.Time { return fixedNow }

	credential, err := service.Start(ctx, StartInput{
		UserID: fixture.userID, GrantID: fixture.grantID,
		AccessIssuer:  "https://cgn.cloudflareaccess.com",
		AccessSubject: "cloudflare-subject", AccessEmail: fixture.email,
	})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	principal, err := service.Authenticate(ctx, credential.Token)
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if principal.UserID != fixture.userID || principal.GrantID != fixture.grantID ||
		!VerifyCSRF(principal, credential.CSRFToken) {
		t.Fatalf("principal = %#v", principal)
	}

	var storedTokenHash, storedCSRFHash []byte
	if err := fixture.pool.QueryRow(ctx, `
		SELECT token_hash, csrf_token_hash
		FROM admin_sessions WHERE id = $1::uuid
	`, principal.SessionID).Scan(&storedTokenHash, &storedCSRFHash); err != nil {
		t.Fatalf("read stored hashes: %v", err)
	}
	if string(storedTokenHash) == credential.Token || string(storedCSRFHash) == credential.CSRFToken {
		t.Fatal("admin session persisted raw credential material")
	}

	if _, err := fixture.pool.Exec(ctx, `
		UPDATE site_role_grants
		SET revoked_at = NOW(), revoked_by_user_id = $2::uuid,
		    revoke_reason = 'Session revocation test'
		WHERE id = $1::uuid
	`, fixture.grantID, fixture.userID); err != nil {
		t.Fatalf("revoke grant: %v", err)
	}
	if _, err := service.Authenticate(ctx, credential.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("Authenticate(revoked grant) error = %v, want ErrUnauthenticated", err)
	}

	var replacementGrantID string
	if err := fixture.pool.QueryRow(ctx, `
		INSERT INTO site_role_grants (
			user_id, role, granted_by_user_id, grant_reason
		)
		VALUES ($1::uuid, 'site_admin', $1::uuid, 'Replacement grant test')
		RETURNING id::text
	`, fixture.userID).Scan(&replacementGrantID); err != nil {
		t.Fatalf("insert replacement grant: %v", err)
	}
	if replacementGrantID == fixture.grantID {
		t.Fatal("replacement grant reused the revoked grant id")
	}
	if _, err := service.Authenticate(ctx, credential.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("Authenticate(old token after re-grant) error = %v, want ErrUnauthenticated", err)
	}
}

func TestPostgresRepositoryRejectsIneligibleSessionExchange(t *testing.T) {
	fixture := newAdminSessionFixture(t)
	ctx := context.Background()
	service, _ := NewService(NewPostgresRepository(fixture.pool), 30*time.Minute, 8*time.Hour)

	for _, test := range []struct {
		name  string
		setup string
		email string
	}{
		{name: "email mismatch", email: "other@example.test"},
		{name: "unverified account", setup: `UPDATE users SET email_verified_at = NULL WHERE id = $1::uuid`, email: fixture.email},
		{name: "suspended account", setup: `UPDATE users SET account_status = 'suspended' WHERE id = $1::uuid`, email: fixture.email},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.setup != "" {
				if _, err := fixture.pool.Exec(ctx, test.setup, fixture.userID); err != nil {
					t.Fatalf("setup: %v", err)
				}
				t.Cleanup(func() {
					_, _ = fixture.pool.Exec(context.Background(), `
						UPDATE users SET email_verified_at = NOW(), account_status = 'active'
						WHERE id = $1::uuid
					`, fixture.userID)
				})
			}
			_, err := service.Start(ctx, StartInput{
				UserID: fixture.userID, GrantID: fixture.grantID,
				AccessIssuer:  "https://cgn.cloudflareaccess.com",
				AccessSubject: "cloudflare-subject", AccessEmail: test.email,
			})
			if !errors.Is(err, ErrUnauthenticated) {
				t.Fatalf("Start() error = %v, want ErrUnauthenticated", err)
			}
		})
	}
}
