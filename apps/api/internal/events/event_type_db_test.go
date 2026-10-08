package events

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryStoresAndFiltersEventType(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	const schoolSlug = "event-type-school"
	var schoolID string
	var userID string
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Event Type School', $1) RETURNING id::text
	`, schoolSlug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('event-type@example.test', 'hash', 'Event Type Organizer', $1::uuid, NOW())
		RETURNING id::text
	`, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Event Type Game', 'event-type-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	repository := NewPostgresRepository(pool)
	input := func(title string, eventType string, day int) CreateInput {
		startsAt := time.Date(2031, time.May, day, 19, 0, 0, 0, location)
		return CreateInput{
			Title:         title,
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      AudienceOpen,
			EventType:     eventType,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      location.String(),
		}
	}
	lan, err := repository.Create(ctx, CreateParams{CreateInput: input("Type LAN", EventTypeLAN, 1)})
	if err != nil {
		t.Fatalf("Create(lan) error = %v", err)
	}
	gameNight, err := repository.Create(ctx, CreateParams{CreateInput: input("Type Game Night", EventTypeGameNight, 2)})
	if err != nil {
		t.Fatalf("Create(game night) error = %v", err)
	}
	// An event that predates the column has no type.
	legacy, err := repository.Create(ctx, CreateParams{CreateInput: input("Type Legacy", EventTypeOther, 3)})
	if err != nil {
		t.Fatalf("Create(legacy) error = %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET event_type = NULL WHERE id = $1::uuid`, legacy.ID); err != nil {
		t.Fatalf("clear legacy event type: %v", err)
	}
	seriesInput := input("Type Series", EventTypeTryout, 4)
	seriesInput.RecurrenceRule = RecurrenceWeekly
	seriesInput.RecurrenceUntil = seriesInput.StartsAt.AddDate(0, 0, 15)
	series, err := repository.Create(ctx, CreateParams{CreateInput: seriesInput})
	if err != nil {
		t.Fatalf("Create(series) error = %v", err)
	}

	listed := func(eventType string) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, ListParams{SchoolSlug: schoolSlug, EventType: eventType})
		if err != nil {
			t.Fatalf("ListPublic(%q) error = %v", eventType, err)
		}
		types := make([]string, 0, len(events))
		for _, event := range events {
			types = append(types, event.Title+"="+event.EventType)
		}
		return types
	}
	if got, want := listed(EventTypeLAN), []string{"Type LAN=lan"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListPublic(lan) = %v, want %v", got, want)
	}
	wantAll := []string{
		"Type Series=tryout", "Type Series=tryout", "Type Series=tryout",
		"Type Legacy=", "Type Game Night=game_night", "Type LAN=lan",
	}
	if got := listed(""); !reflect.DeepEqual(got, wantAll) {
		t.Fatalf("ListPublic() = %v, want %v", got, wantAll)
	}

	updated, err := repository.Update(ctx, UpdateParams{UpdateInput: UpdateInput{
		Slug:         gameNight.Slug,
		EditorUserID: userID,
		Title:        gameNight.Title,
		HostSchoolID: schoolID,
		GameIDs:      []string{gameID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		Audience:     AudienceOpen,
		EventType:    EventTypeWatchParty,
		StartsAt:     gameNight.StartsAt,
		EndsAt:       gameNight.EndsAt,
		Timezone:     gameNight.Timezone,
	}})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.EventType != EventTypeWatchParty {
		t.Fatalf("updated event type = %q, want %q", updated.EventType, EventTypeWatchParty)
	}
	if lan.EventType != EventTypeLAN || series.EventType != EventTypeTryout {
		t.Fatalf("created event types = %q and %q, want lan and tryout", lan.EventType, series.EventType)
	}
}
