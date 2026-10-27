package events

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryTournamentBracket(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "events")
	schoolID := dbtest.InsertSchool(t, pool, "Bracket School", "bracket-school")
	organizerID := dbtest.InsertUser(t, pool, schoolID, "bracket-organizer@example.test", "Organizer")
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Bracket Game', 'bracket-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	repository := NewPostgresRepository(pool)
	startsAt := time.Date(2031, time.June, 1, 18, 0, 0, 0, time.UTC)
	event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
		Title: "Bracket Cup", CreatorUserID: organizerID, HostSchoolID: schoolID, GameIDs: []string{gameID},
		Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceOpen, EventType: EventTypeTournament,
		StartsAt: startsAt, EndsAt: startsAt.Add(4 * time.Hour), Timezone: "UTC",
	}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	slug := event.Slug
	if _, _, err := repository.PutTournament(ctx, TournamentInput{Slug: slug, EditorUserID: organizerID, GameID: gameID, EntryType: EntrySolo}); err != nil {
		t.Fatalf("PutTournament() error = %v", err)
	}
	if _, err := repository.SetTournamentStatus(ctx, slug, organizerID, TournamentRegistrationOpen); err != nil {
		t.Fatalf("open: %v", err)
	}
	// Five players register in name order: Ana, Ben, Cal, Dee, Eli.
	names := []string{"Ana", "Ben", "Cal", "Dee", "Eli"}
	entryIDs := map[string]string{}
	var players []string
	for _, name := range names {
		userID := dbtest.InsertUser(t, pool, schoolID, "bracket-"+name+"@example.test", name, dbtest.VerifiedEmail())
		players = append(players, userID)
		entry, err := repository.Register(ctx, RegisterInput{Slug: slug, UserID: userID})
		if err != nil {
			t.Fatalf("Register(%s) error = %v", name, err)
		}
		entryIDs[name] = entry.ID
	}

	// Organizers seed every registered entry once: Eli first, Ana last.
	_, outsiderErr := repository.SetSeeds(ctx, slug, players[0], []string{entryIDs["Eli"]})
	_, missingErr := repository.SetSeeds(ctx, slug, organizerID, []string{entryIDs["Eli"], entryIDs["Dee"]})
	_, earlyErr := repository.GenerateBracket(ctx, slug, organizerID)
	seeded, err := repository.SetSeeds(ctx, slug, organizerID, []string{
		entryIDs["Eli"], entryIDs["Dee"], entryIDs["Cal"], entryIDs["Ben"], entryIDs["Ana"],
	})
	if err != nil {
		t.Fatalf("SetSeeds() error = %v", err)
	}
	var order []string
	for _, entry := range seeded {
		order = append(order, fmt.Sprintf("%d %s", entry.Seed, entry.Player.Name))
	}
	if _, err := repository.SetTournamentStatus(ctx, slug, organizerID, TournamentInProgress); err != nil {
		t.Fatalf("start: %v", err)
	}
	_, outsiderBracketErr := repository.GenerateBracket(ctx, slug, players[0])
	if got, want := []any{outsiderErr, missingErr, earlyErr, outsiderBracketErr, order}, []any{
		ErrOrganizerRequired, ErrSeedOrder, ErrTournamentNotStarted, ErrOrganizerRequired,
		[]string{"1 Eli", "2 Dee", "3 Cal", "4 Ben", "5 Ana"},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("seeding = %v, want %v", got, want)
	}

	// Five entrants fill an eight-slot bracket: seeds 1 to 3 have byes, and
	// 4 plays 5 for a place against seed 1.
	describe := func(matches []TournamentMatch) []string {
		place := map[string]string{}
		for _, match := range matches {
			place[match.ID] = fmt.Sprintf("r%dp%d", match.Round, match.Position)
		}
		var described []string
		for _, match := range matches {
			slots := [2]string{"-", "-"}
			for index, entrant := range match.Entrants {
				if entrant != nil {
					slots[index] = fmt.Sprintf("%d %s", entrant.Seed, entrant.Player.Name)
				}
			}
			described = append(described, fmt.Sprintf("r%dp%d %s v %s -> %s %s",
				match.Round, match.Position, slots[0], slots[1], place[match.NextMatchID], match.Status))
		}
		return described
	}
	want := []string{
		"r1p2 4 Ben v 5 Ana -> r2p1 upcoming",
		"r2p1 1 Eli v - -> r3p1 upcoming",
		"r2p2 2 Dee v 3 Cal -> r3p1 upcoming",
		"r3p1 - v - ->  upcoming",
	}
	generated, err := repository.GenerateBracket(ctx, slug, organizerID)
	if err != nil {
		t.Fatalf("GenerateBracket() error = %v", err)
	}
	regenerated, err := repository.GenerateBracket(ctx, slug, organizerID)
	if err != nil {
		t.Fatalf("GenerateBracket(again) error = %v", err)
	}
	listed, err := repository.ListMatches(ctx, slug, "")
	if err != nil {
		t.Fatalf("ListMatches() error = %v", err)
	}
	if got := [][]string{describe(generated), describe(regenerated), describe(listed)}; !reflect.DeepEqual(got, [][]string{want, want, want}) {
		t.Fatalf("brackets = %q, want %q three times", got, want)
	}
	if !reflect.DeepEqual(regenerated, listed) || generated[0].ID == regenerated[0].ID {
		t.Fatalf("regenerating should replace the matches: generated %v, regenerated %v, listed %v", generated, regenerated, listed)
	}

	// Reseeding without regenerating leaves the bracket and its seeds as
	// they were generated.
	if _, err := repository.SetSeeds(ctx, slug, organizerID, []string{
		entryIDs["Ana"], entryIDs["Ben"], entryIDs["Cal"], entryIDs["Dee"], entryIDs["Eli"],
	}); err != nil {
		t.Fatalf("SetSeeds(again) error = %v", err)
	}
	reseeded, err := repository.ListMatches(ctx, slug, organizerID)
	if err != nil {
		t.Fatalf("ListMatches(reseeded) error = %v", err)
	}
	if got := describe(reseeded); !reflect.DeepEqual(got, want) {
		t.Fatalf("bracket after reseeding = %q, want %q", got, want)
	}

	// Once a match goes live, seeds and the bracket are fixed; once the
	// event ends, they are fixed too.
	if _, err := pool.Exec(ctx, `UPDATE tournament_matches SET status = 'live' WHERE id = $1::uuid`, listed[0].ID); err != nil {
		t.Fatalf("start match: %v", err)
	}
	_, lockedBracketErr := repository.GenerateBracket(ctx, slug, organizerID)
	_, lockedSeedsErr := repository.SetSeeds(ctx, slug, organizerID, []string{
		entryIDs["Ana"], entryIDs["Ben"], entryIDs["Cal"], entryIDs["Dee"], entryIDs["Eli"],
	})
	repository.now = func() time.Time { return startsAt.Add(4 * time.Hour) }
	_, endedErr := repository.GenerateBracket(ctx, slug, organizerID)
	if got, want := []error{lockedBracketErr, lockedSeedsErr, endedErr}, []error{ErrBracketLocked, ErrBracketLocked, ErrEventEnded}; !reflect.DeepEqual(got, want) {
		t.Fatalf("locked errors = %v, want %v", got, want)
	}
}
