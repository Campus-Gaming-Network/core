package events

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryGetBySlugPopulatesOrganizersAndHostScopedRoles(t *testing.T) {
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
	insertSchool := func(name string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO schools (name, slug)
			VALUES ($1, $2)
			RETURNING id::text
		`, name, "event-organizer-"+suffix+"-"+Slugify(name)).Scan(&id); err != nil {
			t.Fatalf("insert school %q: %v", name, err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, id)
		})
		return id
	}
	hostSchoolID := insertSchool("Host School")
	otherSchoolID := insertSchool("Other School")

	insertUser := func(label string, schoolID string, verificationLevel string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (
				email, password_hash, verification_level, name,
				home_school_id, age_confirmed_at
			)
			VALUES ($1, 'hash', $2, $3, $4::uuid, NOW())
			RETURNING id::text
		`, "event-organizer-"+suffix+"-"+Slugify(label)+"@example.test", verificationLevel, label, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert user %q: %v", label, err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, id)
		})
		return id
	}
	creatorID := insertUser("Creator", hostSchoolID, "staff_faculty")
	hostAdminID := insertUser("Host Admin", hostSchoolID, "basic")
	otherAdminID := insertUser("Other Admin", otherSchoolID, "basic")

	for _, grant := range []struct {
		schoolID string
		userID   string
	}{
		{schoolID: hostSchoolID, userID: hostAdminID},
		{schoolID: otherSchoolID, userID: otherAdminID},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO school_admins (school_id, user_id)
			VALUES ($1::uuid, $2::uuid)
		`, grant.schoolID, grant.userID); err != nil {
			t.Fatalf("insert school admin: %v", err)
		}
	}

	var eventID string
	slug := "organizer-population-" + suffix
	startsAt := time.Now().UTC().Add(time.Hour)
	if err := pool.QueryRow(ctx, `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, visibility,
			format, starts_at, ends_at, timezone
		)
		VALUES ($1::uuid, $2::uuid, 'Organizer Population', $3, 'public',
		        'online', $4, $5, 'UTC')
		RETURNING id::text
	`, creatorID, hostSchoolID, slug, startsAt, startsAt.Add(time.Hour)).Scan(&eventID); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM events WHERE id = $1::uuid`, eventID)
	})

	createdAt := time.Now().UTC().Add(-time.Hour)
	for index, organizer := range []struct {
		userID string
		role   string
	}{
		{userID: creatorID, role: "creator"},
		{userID: hostAdminID, role: "organizer"},
		{userID: otherAdminID, role: "organizer"},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO event_organizers (event_id, user_id, role, created_at)
			VALUES ($1::uuid, $2::uuid, $3, $4)
		`, eventID, organizer.userID, organizer.role, createdAt.Add(time.Duration(index)*time.Minute)); err != nil {
			t.Fatalf("insert event organizer: %v", err)
		}
	}

	event, err := NewPostgresRepository(pool).GetBySlug(ctx, slug)
	if err != nil {
		t.Fatalf("GetBySlug() error = %v", err)
	}
	if len(event.Organizers) != 3 {
		t.Fatalf("GetBySlug() organizers = %#v, want 3", event.Organizers)
	}

	want := []Organizer{
		{ID: creatorID, Name: "Creator", Role: "creator", RoleIndicators: []string{"staff_faculty"}},
		{ID: hostAdminID, Name: "Host Admin", Role: "organizer", RoleIndicators: []string{"school_admin"}},
		{ID: otherAdminID, Name: "Other Admin", Role: "organizer", RoleIndicators: []string{}},
	}
	if !reflect.DeepEqual(event.Organizers, want) {
		t.Fatalf("GetBySlug() organizers = %#v, want %#v", event.Organizers, want)
	}
}
