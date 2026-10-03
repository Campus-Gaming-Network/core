package users

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs only when API_DATABASE_URL points at a migrated database.
func TestPostgresRepositoryShowInListsDefaultsToTrueAndPersistsUpdates(t *testing.T) {
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
		INSERT INTO schools (name, slug) VALUES ('List Setting School', $1)
		RETURNING id::text
	`, "list-setting-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	repository := NewPostgresRepository(pool)
	created, err := repository.Create(ctx, CreateParams{
		Email:          "list-setting-" + suffix + "@example.test",
		PasswordHash:   "hash",
		Name:           "List Setting Player",
		HomeSchoolID:   schoolID,
		AgeConfirmedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, created.ID)
	})
	if !created.ShowInLists {
		t.Fatal("Create() ShowInLists = false, want a new account listed by default")
	}

	update := ProfileUpdate{Name: created.Name, Bio: created.Bio, Timezone: created.Timezone, ShowInLists: false}
	updated, err := repository.UpdateProfileWithSocialLinks(ctx, created.ID, update, nil)
	if err != nil {
		t.Fatalf("UpdateProfileWithSocialLinks() error = %v", err)
	}
	if updated.ShowInLists {
		t.Fatal("UpdateProfileWithSocialLinks() ShowInLists = true, want the opt-out stored")
	}
	found, err := repository.FindByID(ctx, created.ID)
	if err != nil || found.ShowInLists {
		t.Fatalf("FindByID() = %#v, %v; want the opt-out persisted", found, err)
	}

	update.ShowInLists = true
	updated, err = repository.UpdateProfile(ctx, created.ID, update)
	if err != nil || !updated.ShowInLists {
		t.Fatalf("UpdateProfile() = %#v, %v; want the account listed again", updated, err)
	}
}
