package users

import (
	"context"
	"fmt"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs only when API_DATABASE_URL points at a migrated database.
func TestPostgresRepositoryGivesEachUserAPermanentPublicID(t *testing.T) {
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
	schoolID = dbtest.InsertSchool(t, pool, "Public ID School", "public-id-school-"+suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	repository := NewPostgresRepository(pool)
	created, err := repository.Create(ctx, CreateParams{
		Email:          "public-id-" + suffix + "@example.test",
		PasswordHash:   "hash",
		Name:           "Public ID Player",
		HomeSchoolID:   schoolID,
		AgeConfirmedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, created.ID)
	})
	if !IsPublicID(created.PublicID) {
		t.Fatalf("Create() PublicID = %q, want ten base58 characters", created.PublicID)
	}

	found, err := repository.FindByPublicID(ctx, created.PublicID)
	if err != nil {
		t.Fatalf("FindByPublicID() error = %v", err)
	}
	if !reflect.DeepEqual(found, created) {
		t.Fatalf("FindByPublicID() = %#v, want %#v", found, created)
	}
	// Login answers with this profile, so it must be the same one.
	credentials, err := repository.FindCredentialsByEmail(ctx, created.Email)
	if err != nil {
		t.Fatalf("FindCredentialsByEmail() error = %v", err)
	}
	if !reflect.DeepEqual(credentials.Profile, created) {
		t.Fatalf("FindCredentialsByEmail() profile = %#v, want %#v", credentials.Profile, created)
	}

	if _, err := pool.Exec(ctx, `UPDATE users SET public_id = 'Zx9yWv8uTs' WHERE id = $1::uuid`, created.ID); err == nil {
		t.Fatal("changing public_id succeeded, want the trigger to refuse it")
	}
}
