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
	verifiedEmail bool
}

// UserOption changes how InsertUser builds a user.
type UserOption func(*userFixture)

// VerifiedEmail marks the user's email address as verified now.
func VerifiedEmail() UserOption {
	return func(u *userFixture) { u.verifiedEmail = true }
}

// InsertUser inserts an active user with a confirmed age whose home school is
// schoolID, and returns the user's ID. The stored password hash is the
// placeholder "hash", which is not a valid credential. It fails the test when
// the insert fails.
func InsertUser(t *testing.T, pool *pgxpool.Pool, schoolID, email, name string, options ...UserOption) string {
	t.Helper()
	var fixture userFixture
	for _, option := range options {
		option(&fixture)
	}
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, email_verified_at)
		VALUES ($1, 'hash', $2, $3::uuid, NOW(), CASE WHEN $4 THEN NOW() END)
		RETURNING id::text
	`, email, name, schoolID, fixture.verifiedEmail).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	return id
}
