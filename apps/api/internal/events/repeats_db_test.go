package events

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryListPublicHidesRecurringSeries(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	const schoolSlug = "repeats-school"
	schoolID := dbtest.InsertSchool(t, pool, "Repeats School", schoolSlug)
	userID := dbtest.InsertUser(t, pool, schoolID, "repeats@example.test", "Repeats Organizer")
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Repeats Game', 'repeats-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	repository := NewPostgresRepository(pool)
	input := func(title string, day int) CreateInput {
		startsAt := time.Date(2031, time.May, day, 19, 0, 0, 0, location)
		return CreateInput{
			Title:         title,
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      AudienceOpen,
			EventType:     EventTypeGameNight,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      location.String(),
		}
	}
	seriesInput := input("Weekly Night", 1)
	seriesInput.RecurrenceRule = RecurrenceWeekly
	seriesInput.RecurrenceUntil = seriesInput.StartsAt.AddDate(0, 0, 8)
	if _, err := repository.Create(ctx, CreateParams{CreateInput: seriesInput}); err != nil {
		t.Fatalf("Create(series) error = %v", err)
	}
	if _, err := repository.Create(ctx, CreateParams{CreateInput: input("Spring LAN", 3)}); err != nil {
		t.Fatalf("Create(one-off) error = %v", err)
	}

	listed := func(hideRepeats bool) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, ListParams{SchoolSlug: schoolSlug, HideRepeats: hideRepeats})
		if err != nil {
			t.Fatalf("ListPublic(HideRepeats: %v) error = %v", hideRepeats, err)
		}
		titles := make([]string, 0, len(events))
		for _, event := range events {
			titles = append(titles, event.Title)
		}
		return titles
	}
	if got, want := listed(false), []string{"Weekly Night", "Spring LAN", "Weekly Night"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListPublic() = %v, want %v", got, want)
	}
	if got, want := listed(true), []string{"Spring LAN"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListPublic(HideRepeats) = %v, want %v", got, want)
	}
}
