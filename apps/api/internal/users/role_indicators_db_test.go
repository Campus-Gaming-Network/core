package users

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryFindByIDPopulatesActiveRoleIndicators(t *testing.T) {
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
		VALUES ('Role Indicator School', $1)
		RETURNING id::text
	`, "role-indicator-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (
			email, password_hash, verification_level, name,
			home_school_id, age_confirmed_at
		)
		VALUES ($1, 'hash', 'staff_faculty', 'Role Indicator User', $2::uuid, NOW())
		RETURNING id::text
	`, "role-indicator-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, userID)
	})

	if _, err := pool.Exec(ctx, `
		INSERT INTO school_admins (school_id, user_id)
		VALUES ($1::uuid, $2::uuid)
	`, schoolID, userID); err != nil {
		t.Fatalf("insert school admin: %v", err)
	}

	repository := NewPostgresRepository(pool)
	profile, err := repository.FindByID(ctx, userID)
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	wantActive := []string{"school_admin", "staff_faculty"}
	if !reflect.DeepEqual(profile.RoleIndicators, wantActive) {
		t.Fatalf("FindByID() RoleIndicators = %#v, want %#v", profile.RoleIndicators, wantActive)
	}
	if got := profile.Public().RoleIndicators; !reflect.DeepEqual(got, wantActive) {
		t.Fatalf("Public() RoleIndicators = %#v, want %#v", got, wantActive)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE school_admins
		SET deleted_at = NOW()
		WHERE school_id = $1::uuid AND user_id = $2::uuid
	`, schoolID, userID); err != nil {
		t.Fatalf("revoke school admin: %v", err)
	}

	profile, err = repository.FindByID(ctx, userID)
	if err != nil {
		t.Fatalf("FindByID() after revoke error = %v", err)
	}
	wantRevoked := []string{"staff_faculty"}
	if !reflect.DeepEqual(profile.RoleIndicators, wantRevoked) {
		t.Fatalf("FindByID() RoleIndicators after revoke = %#v, want %#v", profile.RoleIndicators, wantRevoked)
	}
}
