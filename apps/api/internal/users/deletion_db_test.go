package users

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DeleteAccount is a single multi-table transaction, so fakes would assert
// nothing about it. Runs only when API_DATABASE_URL points at a migrated
// database; skipped in CI.
func newDeletionFixture(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("API_DATABASE_URL")
	if url == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	var schoolID string
	slug := "deletion-school-" + strings.ReplaceAll(t.Name(), "/", "-")
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO schools (name, slug) VALUES ('Deletion School', $1)
		RETURNING id::text`, slug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})
	return pool, schoolID
}

func insertUser(t *testing.T, pool *pgxpool.Pool, schoolID, email string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Player', $2::uuid, NOW())
		RETURNING id::text`, email, schoolID).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, id)
	})
	return id
}

func insertTeam(t *testing.T, pool *pgxpool.Pool, ownerID, slug string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO teams (owner_user_id, name, slug, password_hash)
		VALUES ($1::uuid, 'Team', $2, 'hash')
		RETURNING id::text`, ownerID, slug).Scan(&id); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM teams WHERE id = $1::uuid`, id)
	})
	return id
}

func addMember(t *testing.T, pool *pgxpool.Pool, teamID, userID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
		teamID, userID, role); err != nil {
		t.Fatalf("insert member: %v", err)
	}
}

func TestDeleteAccountScrubsIdentifyingData(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	userID := insertUser(t, pool, schoolID, "scrub@example.test")

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_social_links (user_id, label, url) VALUES ($1::uuid, 'Discord', 'https://example.test')`,
		userID); err != nil {
		t.Fatalf("insert social link: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_school_follows (user_id, school_id) VALUES ($1::uuid, $2::uuid)`,
		userID, schoolID); err != nil {
		t.Fatalf("insert follow: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth_sessions (user_id, token_hash, expires_at)
		VALUES ($1::uuid, '\xfe'::bytea, NOW() + INTERVAL '10 days')`, userID); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, userID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var email, name, status string
	var bio *string
	if err := pool.QueryRow(ctx, `
		SELECT email::text, name, account_status, bio FROM users WHERE id = $1::uuid`,
		userID).Scan(&email, &name, &status, &bio); err != nil {
		t.Fatalf("read scrubbed user: %v", err)
	}
	if email == "scrub@example.test" {
		t.Fatal("email was not scrubbed")
	}
	if !strings.HasSuffix(email, "@deleted.invalid") {
		t.Fatalf("email = %q, want a deleted placeholder", email)
	}
	if name != DeletedNamePlaceholder {
		t.Fatalf("name = %q, want %q", name, DeletedNamePlaceholder)
	}
	if status != "deleted" {
		t.Fatalf("account_status = %q, want deleted", status)
	}
	if bio != nil {
		t.Fatalf("bio = %q, want NULL", *bio)
	}

	for _, check := range []struct {
		label string
		query string
	}{
		{"social links", `SELECT COUNT(*) FROM user_social_links WHERE user_id = $1::uuid`},
		{"school follows", `SELECT COUNT(*) FROM user_school_follows WHERE user_id = $1::uuid`},
		{"live sessions", `SELECT COUNT(*) FROM auth_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL`},
	} {
		var count int
		if err := pool.QueryRow(ctx, check.query, userID).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", check.label, err)
		}
		if count != 0 {
			t.Fatalf("%s remaining = %d, want 0", check.label, count)
		}
	}

	// The scrubbed address must free the original for re-registration.
	reused := insertUser(t, pool, schoolID, "scrub@example.test")
	if reused == "" {
		t.Fatal("could not re-register the released email")
	}
}

func TestDeleteAccountPromotesCaptainOverMember(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	owner := insertUser(t, pool, schoolID, "owner-captain@example.test")
	member := insertUser(t, pool, schoolID, "member@example.test")
	captain := insertUser(t, pool, schoolID, "captain@example.test")
	teamID := insertTeam(t, pool, owner, "deletion-team-captain")

	addMember(t, pool, teamID, owner, "owner")
	addMember(t, pool, teamID, member, "member") // joins first
	addMember(t, pool, teamID, captain, "captain")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, owner); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var newOwner string
	var deletedAt *string
	if err := pool.QueryRow(ctx, `
		SELECT owner_user_id::text, deleted_at::text FROM teams WHERE id = $1::uuid`,
		teamID).Scan(&newOwner, &deletedAt); err != nil {
		t.Fatalf("read team: %v", err)
	}
	if deletedAt != nil {
		t.Fatal("team was soft deleted despite having members")
	}
	if newOwner != captain {
		t.Fatalf("owner = %s, want the captain %s (member was %s)", newOwner, captain, member)
	}

	var role string
	if err := pool.QueryRow(ctx, `
		SELECT role FROM team_members WHERE team_id = $1::uuid AND user_id = $2::uuid`,
		teamID, captain).Scan(&role); err != nil {
		t.Fatalf("read new owner role: %v", err)
	}
	if role != "owner" {
		t.Fatalf("new owner role = %q, want owner", role)
	}
}

func TestDeleteAccountPromotesMemberWhenNoCaptain(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	owner := insertUser(t, pool, schoolID, "owner-member@example.test")
	member := insertUser(t, pool, schoolID, "sole-member@example.test")
	teamID := insertTeam(t, pool, owner, "deletion-team-member")

	addMember(t, pool, teamID, owner, "owner")
	addMember(t, pool, teamID, member, "member")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, owner); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var newOwner string
	if err := pool.QueryRow(ctx, `
		SELECT owner_user_id::text FROM teams WHERE id = $1::uuid`, teamID).Scan(&newOwner); err != nil {
		t.Fatalf("read team: %v", err)
	}
	if newOwner != member {
		t.Fatalf("owner = %s, want the remaining member %s", newOwner, member)
	}
}

func TestDeleteAccountSoftDeletesSoleMemberTeam(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	owner := insertUser(t, pool, schoolID, "owner-alone@example.test")
	teamID := insertTeam(t, pool, owner, "deletion-team-alone")
	addMember(t, pool, teamID, owner, "owner")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, owner); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var deletedAt *string
	if err := pool.QueryRow(ctx, `
		SELECT deleted_at::text FROM teams WHERE id = $1::uuid`, teamID).Scan(&deletedAt); err != nil {
		t.Fatalf("read team: %v", err)
	}
	if deletedAt == nil {
		t.Fatal("team with no other members was not soft deleted")
	}
}
