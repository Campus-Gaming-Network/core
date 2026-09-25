package events

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryListPublicPagesNewestFirst(t *testing.T) {
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
	schoolSlug := "newest-first-school-" + suffix
	var schoolID string
	var userID string
	var gameID string
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if userID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM events WHERE creator_user_id = $1::uuid`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id = $1::uuid`, userID)
		}
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
		if gameID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM games WHERE id = $1::uuid`, gameID)
		}
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Newest First School', $1) RETURNING id::text
	`, schoolSlug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Newest First Organizer', $2::uuid, NOW())
		RETURNING id::text
	`, "newest-first-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Newest First Game', $1) RETURNING id::text
	`, "newest-first-game-"+suffix).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	repository := NewPostgresRepository(pool)
	created := make([]Event, 3)
	for index, month := range []time.Month{time.January, time.February, time.March} {
		startsAt := time.Date(2031, month, 10, 19, 0, 0, 0, location)
		created[index], err = repository.Create(ctx, CreateParams{CreateInput: CreateInput{
			Title:         fmt.Sprintf("Newest First %s", month),
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      location.String(),
		}})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
	}
	january, february, march := created[0], created[1], created[2]
	cursor := func(event Event) *pagecursor.Cursor {
		return &pagecursor.Cursor{Timestamp: event.StartsAt, ID: event.ID}
	}

	for _, test := range []struct {
		name   string
		params ListParams
		want   []string
	}{
		{name: "first page", params: ListParams{Limit: 2}, want: []string{march.ID, february.ID}},
		{name: "next page", params: ListParams{Limit: 2, After: cursor(february)}, want: []string{january.ID}},
		{name: "previous page", params: ListParams{Limit: 2, Before: cursor(january)}, want: []string{march.ID, february.ID}},
	} {
		test.params.SchoolSlug = schoolSlug
		events, err := repository.ListPublic(ctx, test.params)
		if err != nil {
			t.Fatalf("%s: ListPublic() error = %v", test.name, err)
		}
		got := make([]string, 0, len(events))
		for _, event := range events {
			got = append(got, event.ID)
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Fatalf("%s: ListPublic() IDs = %v, want %v", test.name, got, test.want)
		}
	}
}
