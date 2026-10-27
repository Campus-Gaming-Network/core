package events

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
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

func TestPostgresRepositoryTournamentResults(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "events")
	schoolID := dbtest.InsertSchool(t, pool, "Results School", "results-school")
	organizerID := dbtest.InsertUser(t, pool, schoolID, "results-organizer@example.test", "Organizer")
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Results Game', 'results-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	repository := NewPostgresRepository(pool)
	startsAt := time.Date(2031, time.June, 1, 18, 0, 0, 0, time.UTC)
	event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
		Title: "Results Cup", CreatorUserID: organizerID, HostSchoolID: schoolID, GameIDs: []string{gameID},
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
	// Five players register in seed order: Eli 1, Dee 2, Cal 3, Ben 4, Ana 5.
	entryIDs := map[string]string{}
	var playerID string
	for _, name := range []string{"Eli", "Dee", "Cal", "Ben", "Ana"} {
		playerID = dbtest.InsertUser(t, pool, schoolID, "results-"+name+"@example.test", name, dbtest.VerifiedEmail())
		entry, err := repository.Register(ctx, RegisterInput{Slug: slug, UserID: playerID})
		if err != nil {
			t.Fatalf("Register(%s) error = %v", name, err)
		}
		entryIDs[name] = entry.ID
	}
	if _, err := repository.SetTournamentStatus(ctx, slug, organizerID, TournamentInProgress); err != nil {
		t.Fatalf("start: %v", err)
	}
	generated, err := repository.GenerateBracket(ctx, slug, organizerID)
	if err != nil {
		t.Fatalf("GenerateBracket() error = %v", err)
	}
	matchIDs := map[string]string{}
	for _, match := range generated {
		matchIDs[fmt.Sprintf("r%dp%d", match.Round, match.Position)] = match.ID
	}
	record := func(userID, place, winner string, scores ...int) error {
		_, err := repository.RecordResult(ctx, ResultInput{
			Slug: slug, UserID: userID, MatchID: matchIDs[place], WinnerEntryID: entryIDs[winner],
			Scores: scores, Walkover: scores == nil,
		})
		return err
	}
	describe := func() []string {
		matches, err := repository.ListMatches(ctx, slug, organizerID)
		if err != nil {
			t.Fatalf("ListMatches() error = %v", err)
		}
		names := map[string]string{}
		for name, id := range entryIDs {
			names[id] = name
		}
		var described []string
		for _, match := range matches {
			slots := [2]string{"-", "-"}
			for index, entrant := range match.Entrants {
				if entrant != nil {
					slots[index] = fmt.Sprintf("%d %s", entrant.Seed, entrant.Player.Name)
				}
			}
			described = append(described, fmt.Sprintf("r%dp%d %s v %s %s %v winner=%s walkover=%t",
				match.Round, match.Position, slots[0], slots[1], match.Status, match.Scores, names[match.WinnerEntryID], match.Walkover))
		}
		return described
	}
	tournamentStatus := func() string {
		var status string
		if err := pool.QueryRow(ctx, `SELECT status FROM tournaments`).Scan(&status); err != nil {
			t.Fatalf("read tournament status: %v", err)
		}
		return status
	}

	schedule := func(userID, place string, at *time.Time) error {
		_, err := repository.ScheduleMatch(ctx, slug, userID, matchIDs[place], at)
		return err
	}
	at := func(offset time.Duration) *time.Time {
		value := startsAt.Add(offset)
		return &value
	}
	scheduled := []error{
		schedule(organizerID, "r2p1", at(time.Hour)),
		schedule(organizerID, "r3p1", at(3*time.Hour)),
		schedule(organizerID, "r3p1", nil),
		schedule(playerID, "r2p1", at(2*time.Hour)),
		schedule(organizerID, "r2p1", at(-time.Minute)),
		schedule(organizerID, "r2p1", at(4*time.Hour+time.Minute)),
	}
	times := map[string]string{}
	listedTimes, err := repository.ListMatches(ctx, slug, "")
	if err != nil {
		t.Fatalf("ListMatches() error = %v", err)
	}
	for _, match := range listedTimes {
		if match.ScheduledAt != nil {
			times[fmt.Sprintf("r%dp%d", match.Round, match.Position)] = match.ScheduledAt.UTC().Format(time.RFC3339)
		}
	}
	if got, want := []any{scheduled, times}, []any{
		[]error{nil, nil, nil, ErrOrganizerRequired, ErrMatchTime, ErrMatchTime},
		map[string]string{"r2p1": "2031-06-01T19:00:00Z"},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("schedule = %v, want %v", got, want)
	}

	refused := []error{
		record(playerID, "r1p2", "Ben", 2, 1),
		record(organizerID, "r2p1", "Eli", 2, 1),
		record(organizerID, "r1p2", "Eli", 2, 1),
		record(organizerID, "r1p2", "Ben", 1, 2),
		record(organizerID, "r1p2", "Ben", 1, 1),
	}
	_, unknownMatchErr := repository.RecordResult(ctx, ResultInput{
		Slug: slug, UserID: organizerID, MatchID: entryIDs["Ben"], WinnerEntryID: entryIDs["Ben"], Walkover: true,
	})
	refused = append(refused, unknownMatchErr)
	if got, want := refused, []error{
		ErrOrganizerRequired, ErrMatchNotReady, ErrInvalidResult, ErrInvalidResult,
		apperror.Validation("an elimination match has no draw"), ErrMatchNotFound,
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("refused results = %v, want %v", got, want)
	}

	if err := record(organizerID, "r1p2", "Ben", 2, 1); err != nil {
		t.Fatalf("record r1p2: %v", err)
	}
	afterFirst := describe()
	matchCompleteErr := schedule(organizerID, "r1p2", at(time.Hour))
	if err := record(organizerID, "r1p2", "Ana", 0, 2); err != nil {
		t.Fatalf("correct r1p2: %v", err)
	}
	afterCorrection := describe()
	if err := record(organizerID, "r2p2", "Dee"); err != nil {
		t.Fatalf("walkover r2p2: %v", err)
	}
	if err := record(organizerID, "r2p1", "Eli", 3, 1); err != nil {
		t.Fatalf("record r2p1: %v", err)
	}
	lockedErr := record(organizerID, "r1p2", "Ben", 2, 1)
	beforeFinal := []string{tournamentStatus()}
	if err := record(organizerID, "r3p1", "Dee", 1, 2); err != nil {
		t.Fatalf("record final: %v", err)
	}
	if err := record(organizerID, "r3p1", "Eli", 3, 2); err != nil {
		t.Fatalf("correct final: %v", err)
	}
	semifinalErr := record(organizerID, "r2p1", "Ana", 1, 3)
	// A completed tournament's schedule is fixed.
	completeErr := schedule(organizerID, "r1p2", at(time.Hour))
	if got, want := []any{afterFirst, afterCorrection, describe(), lockedErr, semifinalErr, matchCompleteErr, completeErr, append(beforeFinal, tournamentStatus())}, []any{
		[]string{
			"r1p2 4 Ben v 5 Ana complete [2 1] winner=Ben walkover=false",
			"r2p1 1 Eli v 4 Ben upcoming [] winner= walkover=false",
			"r2p2 2 Dee v 3 Cal upcoming [] winner= walkover=false",
			"r3p1 - v - upcoming [] winner= walkover=false",
		},
		[]string{
			"r1p2 4 Ben v 5 Ana complete [0 2] winner=Ana walkover=false",
			"r2p1 1 Eli v 5 Ana upcoming [] winner= walkover=false",
			"r2p2 2 Dee v 3 Cal upcoming [] winner= walkover=false",
			"r3p1 - v - upcoming [] winner= walkover=false",
		},
		[]string{
			"r1p2 4 Ben v 5 Ana complete [0 2] winner=Ana walkover=false",
			"r2p1 1 Eli v 5 Ana complete [3 1] winner=Eli walkover=false",
			"r2p2 2 Dee v 3 Cal complete [] winner=Dee walkover=true",
			"r3p1 1 Eli v 2 Dee complete [3 2] winner=Eli walkover=false",
		},
		ErrResultLocked, ErrResultLocked, ErrMatchComplete, ErrTournamentLocked,
		[]string{TournamentInProgress, TournamentCompleted},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("results = %#v\nwant %#v", got, want)
	}

	editorLog, err := repository.Activity(ctx, event.ID, true, nil, MaximumActivityLimit)
	if err != nil {
		t.Fatalf("Activity(editor) error = %v", err)
	}
	var logged []string
	for _, entry := range editorLog.Entries {
		if entry.Action != ActionMatchResult && entry.Action != ActionMatchResultCorrected {
			continue
		}
		changes, err := json.Marshal(entry.Changes)
		if err != nil {
			t.Fatalf("encode changes: %v", err)
		}
		logged = append(logged, fmt.Sprintf("%s %s %s", entry.Action, entry.Visibility, changes))
	}
	publicLog, err := repository.Activity(ctx, event.ID, false, nil, MaximumActivityLimit)
	if err != nil {
		t.Fatalf("Activity(public) error = %v", err)
	}
	if got, want := []any{logged, len(publicLog.Entries)}, []any{[]string{
		`event.match_result_corrected editors [{"field":"result","before":{"round":3,"scores":[1,2],"position":1,"walkover":false,"winner_seed":2},"after":{"round":3,"scores":[3,2],"position":1,"walkover":false,"winner_seed":1}}]`,
		`event.match_result editors [{"field":"result","after":{"round":3,"scores":[1,2],"position":1,"walkover":false,"winner_seed":2}}]`,
		`event.match_result editors [{"field":"result","after":{"round":2,"scores":[3,1],"position":1,"walkover":false,"winner_seed":1}}]`,
		`event.match_result editors [{"field":"result","after":{"round":2,"position":2,"walkover":true,"winner_seed":2}}]`,
		`event.match_result_corrected editors [{"field":"result","before":{"round":1,"scores":[2,1],"position":2,"walkover":false,"winner_seed":4},"after":{"round":1,"scores":[0,2],"position":2,"walkover":false,"winner_seed":5}}]`,
		`event.match_result editors [{"field":"result","after":{"round":1,"scores":[2,1],"position":2,"walkover":false,"winner_seed":4}}]`,
	}, 0}; !reflect.DeepEqual(got, want) {
		t.Fatalf("log = %#v\nwant %#v", got, want)
	}
}
