package users

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The service-level test locks the values passed to the repository. This test
// verifies the repository and migrated schema preserve both values when a test
// database is available.
func TestPostgresRepositoryCreateStoresSignupSchoolAndAgeConfirmation(t *testing.T) {
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

	var schoolID string
	slug := "signup-school-" + strings.ReplaceAll(strings.ToLower(t.Name()), "/", "-")
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Signup School', $1)
		RETURNING id::text`, slug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	confirmedAt := time.Date(2026, time.September, 3, 19, 30, 0, 0, time.UTC)
	email := "signup-persistence@example.test"
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email)
	})
	profile, err := NewPostgresRepository(pool).Create(ctx, CreateParams{
		Email:          email,
		PasswordHash:   "hash",
		Name:           "Signup Player",
		HomeSchoolID:   schoolID,
		AgeConfirmedAt: confirmedAt,
		Timezone:       "America/Los_Angeles",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var storedSchoolID string
	var storedConfirmedAt time.Time
	if err := pool.QueryRow(ctx, `
		SELECT home_school_id::text, age_confirmed_at
		FROM users
		WHERE id = $1::uuid`, profile.ID).Scan(&storedSchoolID, &storedConfirmedAt); err != nil {
		t.Fatalf("read signup fields: %v", err)
	}
	if storedSchoolID != schoolID {
		t.Fatalf("home_school_id = %q, want %q", storedSchoolID, schoolID)
	}
	if !storedConfirmedAt.Equal(confirmedAt) {
		t.Fatalf("age_confirmed_at = %v, want %v", storedConfirmedAt, confirmedAt)
	}
}
