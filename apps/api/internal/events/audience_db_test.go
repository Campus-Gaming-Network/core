package events

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryStoresAndFiltersAudience(t *testing.T) {
	ctx := context.Background()
	pool := newSchemaPool(t)
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	const schoolSlug = "audience-school"
	var schoolID string
	var userID string
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Audience School', $1) RETURNING id::text
	`, schoolSlug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('audience@example.test', 'hash', 'Audience Organizer', $1::uuid, NOW())
		RETURNING id::text
	`, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Audience Game', 'audience-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	repository := NewPostgresRepository(pool)
	input := func(title string, audience string, day int) CreateInput {
		startsAt := time.Date(2031, time.May, day, 19, 0, 0, 0, location)
		return CreateInput{
			Title:         title,
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      audience,
			EventType:     EventTypeGameNight,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      location.String(),
		}
	}
	open, err := repository.Create(ctx, CreateParams{CreateInput: input("Audience Open", AudienceOpen, 1)})
	if err != nil {
		t.Fatalf("Create(open) error = %v", err)
	}
	campus, err := repository.Create(ctx, CreateParams{CreateInput: input("Audience Campus", AudienceCampus, 2)})
	if err != nil {
		t.Fatalf("Create(campus) error = %v", err)
	}
	// An event that predates the column has no audience.
	legacy, err := repository.Create(ctx, CreateParams{CreateInput: input("Audience Legacy", AudienceOpen, 3)})
	if err != nil {
		t.Fatalf("Create(legacy) error = %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET audience = NULL WHERE id = $1::uuid`, legacy.ID); err != nil {
		t.Fatalf("clear legacy audience: %v", err)
	}
	seriesInput := input("Audience Series", AudienceMembers, 4)
	seriesInput.RecurrenceRule = RecurrenceWeekly
	seriesInput.RecurrenceUntil = seriesInput.StartsAt.AddDate(0, 0, 15)
	series, err := repository.Create(ctx, CreateParams{CreateInput: seriesInput})
	if err != nil {
		t.Fatalf("Create(series) error = %v", err)
	}

	listed := func(audience string) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, ListParams{SchoolSlug: schoolSlug, Audience: audience})
		if err != nil {
			t.Fatalf("ListPublic(%q) error = %v", audience, err)
		}
		audiences := make([]string, 0, len(events))
		for _, event := range events {
			audiences = append(audiences, event.Title+"="+event.Audience)
		}
		return audiences
	}
	if got, want := listed(AudienceOpen), []string{"Audience Open=open"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListPublic(open) = %v, want %v", got, want)
	}
	wantAll := []string{
		"Audience Series=members", "Audience Series=members", "Audience Series=members",
		"Audience Legacy=", "Audience Campus=campus", "Audience Open=open",
	}
	if got := listed(""); !reflect.DeepEqual(got, wantAll) {
		t.Fatalf("ListPublic() = %v, want %v", got, wantAll)
	}

	updated, err := repository.Update(ctx, UpdateParams{UpdateInput: UpdateInput{
		Slug:         campus.Slug,
		EditorUserID: userID,
		Title:        campus.Title,
		HostSchoolID: schoolID,
		GameIDs:      []string{gameID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		Audience:     AudienceCollegiate,
		EventType:    EventTypeGameNight,
		StartsAt:     campus.StartsAt,
		EndsAt:       campus.EndsAt,
		Timezone:     campus.Timezone,
	}})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Audience != AudienceCollegiate {
		t.Fatalf("updated audience = %q, want %q", updated.Audience, AudienceCollegiate)
	}
	if open.Audience != AudienceOpen || series.Audience != AudienceMembers {
		t.Fatalf("created audiences = %q and %q, want open and members", open.Audience, series.Audience)
	}
}
