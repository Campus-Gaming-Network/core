package events

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryListPublicTournamentEntriesAndLifecycle(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "events")
	schoolID := dbtest.InsertSchool(t, pool, "Browse School", "browse-school")
	organizerID := dbtest.InsertUser(t, pool, schoolID, "browse-organizer@example.test", "Organizer", dbtest.VerifiedEmail())
	players := []string{
		dbtest.InsertUser(t, pool, schoolID, "browse-ada@example.test", "Ada", dbtest.VerifiedEmail()),
		dbtest.InsertUser(t, pool, schoolID, "browse-cy@example.test", "Cy", dbtest.VerifiedEmail()),
	}
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Browse Game', 'browse-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	repository := NewPostgresRepository(pool)
	startsAt := time.Date(2031, time.June, 1, 18, 0, 0, 0, time.UTC)
	create := func(title string, eventType string) string {
		t.Helper()
		event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
			Title: title, CreatorUserID: organizerID, HostSchoolID: schoolID, GameIDs: []string{gameID},
			Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceOpen, EventType: eventType,
			StartsAt: startsAt, EndsAt: startsAt.Add(4 * time.Hour), Timezone: "UTC",
		}})
		if err != nil {
			t.Fatalf("Create(%s) error = %v", title, err)
		}
		return event.Slug
	}
	tournament := func(title string, input TournamentInput, open bool) string {
		t.Helper()
		slug := create(title, EventTypeTournament)
		input.Slug, input.EditorUserID, input.GameID = slug, organizerID, gameID
		if _, _, err := repository.PutTournament(ctx, input); err != nil {
			t.Fatalf("PutTournament(%s) error = %v", title, err)
		}
		if open {
			if _, err := repository.SetTournamentStatus(ctx, slug, organizerID, TournamentRegistrationOpen); err != nil {
				t.Fatalf("open %s: %v", title, err)
			}
		}
		return slug
	}

	soloCap, fullCap, draftCap, teamSize := 8, 2, 4, 2
	create("Game Night", EventTypeMeeting)
	tournament("Draft Cup", TournamentInput{EntryType: EntrySolo, EntrantCap: &draftCap}, false)
	solo := tournament("Solo Cup", TournamentInput{EntryType: EntrySolo, EntrantCap: &soloCap}, true)
	full := tournament("Full Cup", TournamentInput{EntryType: EntrySolo, EntrantCap: &fullCap}, true)
	uncapped := tournament("Open Cup", TournamentInput{EntryType: EntrySolo}, true)
	tournament("Team Cup", TournamentInput{EntryType: EntryTeam, TeamSize: &teamSize}, true)
	approval := tournament("Approval Cup", TournamentInput{EntryType: EntrySolo, RegistrationMode: RegistrationApproval}, true)
	for _, slug := range []string{solo, full, uncapped} {
		for _, playerID := range players {
			if _, err := repository.Register(ctx, RegisterInput{Slug: slug, UserID: playerID}); err != nil {
				t.Fatalf("Register(%s) error = %v", slug, err)
			}
		}
	}
	// A pending request is not an entry yet.
	if _, err := repository.Register(ctx, RegisterInput{Slug: approval, UserID: players[0]}); err != nil {
		t.Fatalf("Register(approval) error = %v", err)
	}

	events, err := repository.ListPublic(ctx, ListParams{Limit: 10})
	if err != nil {
		t.Fatalf("ListPublic() error = %v", err)
	}
	type listing struct {
		Lifecycle string
		Entries   *TournamentEntries
	}
	got := map[string]listing{}
	for _, event := range events {
		got[event.Title] = listing{Lifecycle: event.Lifecycle, Entries: event.TournamentEntries}
	}
	// A tournament is full when its registered entries reach its entrant
	// cap; one without a cap never is.
	want := map[string]listing{
		"Game Night":   {Lifecycle: LifecycleUpcoming},
		"Draft Cup":    {Lifecycle: LifecycleUpcoming},
		"Solo Cup":     {Lifecycle: LifecycleUpcoming, Entries: &TournamentEntries{EntryType: EntrySolo, EntryCount: 2, EntrantCap: &soloCap}},
		"Full Cup":     {Lifecycle: LifecycleFull, Entries: &TournamentEntries{EntryType: EntrySolo, EntryCount: 2, EntrantCap: &fullCap}},
		"Open Cup":     {Lifecycle: LifecycleUpcoming, Entries: &TournamentEntries{EntryType: EntrySolo, EntryCount: 2}},
		"Team Cup":     {Lifecycle: LifecycleUpcoming, Entries: &TournamentEntries{EntryType: EntryTeam, EntryCount: 0}},
		"Approval Cup": {Lifecycle: LifecycleUpcoming, Entries: &TournamentEntries{EntryType: EntrySolo, EntryCount: 0}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("listings = %+v, want %+v", got, want)
	}
}
