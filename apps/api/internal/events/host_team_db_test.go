package events

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryHostTeam(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	var schoolID string
	schoolID = dbtest.InsertSchool(t, pool, "Host Team School", "host-team-school")
	user := func(email string) string {
		t.Helper()
		var id string
		id = dbtest.InsertUser(t, pool, schoolID, email, email)
		return id
	}
	ownerID := user("owner@example.test")
	captainID := user("captain@example.test")
	memberID := user("member@example.test")

	team := func(name string, slug string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
			VALUES ($1::uuid, $2::uuid, $3, $4, 'hash')
			RETURNING id::text
		`, ownerID, schoolID, name, slug).Scan(&id); err != nil {
			t.Fatalf("insert team %s: %v", name, err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO team_members (team_id, user_id, role)
			VALUES ($1::uuid, $2::uuid, 'owner'), ($1::uuid, $3::uuid, 'captain'), ($1::uuid, $4::uuid, 'member')
		`, id, ownerID, captainID, memberID); err != nil {
			t.Fatalf("insert team members %s: %v", name, err)
		}
		return id
	}
	redID := team("Red Team", "red-team")
	blueID := team("Blue Team", "blue-team")

	repository := NewPostgresRepository(pool)
	startsAt := time.Date(2031, time.June, 1, 19, 0, 0, 0, time.UTC)
	input := func(title string, creatorID string, teamID string) CreateInput {
		return CreateInput{
			Title:         title,
			CreatorUserID: creatorID,
			HostSchoolID:  schoolID,
			HostTeamID:    teamID,
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      AudienceMembers,
			EventType:     EventTypeGameNight,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      "UTC",
		}
	}

	captainEvent, err := repository.Create(ctx, CreateParams{CreateInput: input("Red Scrim", captainID, redID)})
	if err != nil {
		t.Fatalf("Create(captain) error = %v", err)
	}
	wantRed := &TeamSummary{ID: redID, Name: "Red Team", Slug: "red-team"}
	if !reflect.DeepEqual(captainEvent.HostTeam, wantRed) {
		t.Fatalf("captain event host team = %+v, want %+v", captainEvent.HostTeam, wantRed)
	}
	// The series starts a day later so the list order does not fall to IDs.
	seriesInput := input("Red Weekly", ownerID, redID)
	seriesInput.StartsAt = startsAt.AddDate(0, 0, 1)
	seriesInput.EndsAt = seriesInput.StartsAt.Add(time.Hour)
	seriesInput.RecurrenceRule = RecurrenceWeekly
	seriesInput.RecurrenceUntil = startsAt.AddDate(0, 0, 8)
	if _, err := repository.Create(ctx, CreateParams{CreateInput: seriesInput}); err != nil {
		t.Fatalf("Create(series) error = %v", err)
	}
	if _, err := repository.Create(ctx, CreateParams{CreateInput: input("Solo Night", memberID, "")}); err != nil {
		t.Fatalf("Create(no team) error = %v", err)
	}

	// A plain member cannot host as the team, and neither can anyone name a
	// team that does not exist.
	for name, teamID := range map[string]string{"member": redID, "unknown": "not-a-team"} {
		_, err := repository.Create(ctx, CreateParams{CreateInput: input("Rejected "+name, memberID, teamID)})
		if !errors.Is(err, ErrHostTeamNotAllowed) {
			t.Fatalf("Create(%s) error = %v, want ErrHostTeamNotAllowed", name, err)
		}
	}

	listed := func(teamSlug string) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, ListParams{TeamSlug: teamSlug})
		if err != nil {
			t.Fatalf("ListPublic(%q) error = %v", teamSlug, err)
		}
		titles := make([]string, 0, len(events))
		for _, event := range events {
			titles = append(titles, event.Title)
		}
		return titles
	}
	if got, want := listed("red-team"), []string{"Red Scrim", "Red Weekly", "Red Weekly"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListPublic(red-team) = %v, want %v", got, want)
	}
	if got := listed("blue-team"); len(got) != 0 {
		t.Fatalf("ListPublic(blue-team) = %v, want none", got)
	}

	// The captain steps down. The event keeps Red Team through an edit, but
	// moving it to Blue Team needs a role there.
	if _, err := pool.Exec(ctx, `
		UPDATE team_members SET role = 'member' WHERE user_id = $1::uuid
	`, captainID); err != nil {
		t.Fatalf("demote captain: %v", err)
	}
	update := func(teamID string) (Event, error) {
		return repository.Update(ctx, UpdateParams{UpdateInput: UpdateInput{
			Slug:         captainEvent.Slug,
			EditorUserID: captainID,
			Title:        "Red Scrim Renamed",
			HostSchoolID: schoolID,
			HostTeamID:   teamID,
			Visibility:   VisibilityPublic,
			Format:       FormatOnline,
			Audience:     AudienceMembers,
			EventType:    EventTypeGameNight,
			StartsAt:     captainEvent.StartsAt,
			EndsAt:       captainEvent.EndsAt,
			Timezone:     captainEvent.Timezone,
		}})
	}
	kept, err := update(redID)
	if err != nil {
		t.Fatalf("Update(keep team) error = %v", err)
	}
	if !reflect.DeepEqual(kept.HostTeam, wantRed) {
		t.Fatalf("kept host team = %+v, want %+v", kept.HostTeam, wantRed)
	}
	if _, err := update(blueID); !errors.Is(err, ErrHostTeamNotAllowed) {
		t.Fatalf("Update(other team) error = %v, want ErrHostTeamNotAllowed", err)
	}
	cleared, err := update("")
	if err != nil {
		t.Fatalf("Update(no team) error = %v", err)
	}
	if cleared.HostTeam != nil {
		t.Fatalf("cleared host team = %+v, want nil", cleared.HostTeam)
	}
}
