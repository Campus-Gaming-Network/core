package dbtest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertSchool inserts an active school and returns its ID. It fails the test
// when the insert fails.
func InsertSchool(t *testing.T, pool *pgxpool.Pool, name, slug string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO schools (name, slug) VALUES ($1, $2)
		RETURNING id::text
	`, name, slug).Scan(&id); err != nil {
		t.Fatalf("insert school %s: %v", slug, err)
	}
	return id
}

type userFixture struct {
	passwordHash  string
	verifiedEmail bool
}

// UserOption changes how InsertUser builds a user.
type UserOption func(*userFixture)

// VerifiedEmail marks the user's email address as verified now.
func VerifiedEmail() UserOption {
	return func(u *userFixture) { u.verifiedEmail = true }
}

// PasswordHash sets the stored password hash. Without it the hash is the
// placeholder "hash", which is not a valid credential.
func PasswordHash(hash string) UserOption {
	return func(u *userFixture) { u.passwordHash = hash }
}

// InsertUser inserts an active user with a confirmed age whose home school is
// schoolID, and returns the user's ID. It fails the test when the insert
// fails.
func InsertUser(t *testing.T, pool *pgxpool.Pool, schoolID, email, name string, options ...UserOption) string {
	t.Helper()
	fixture := userFixture{passwordHash: "hash"}
	for _, option := range options {
		option(&fixture)
	}
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, email_verified_at)
		VALUES ($1, $2, $3, $4::uuid, NOW(), CASE WHEN $5 THEN NOW() END)
		RETURNING id::text
	`, email, fixture.passwordHash, name, schoolID, fixture.verifiedEmail).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	return id
}
