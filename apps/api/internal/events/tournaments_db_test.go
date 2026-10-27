package events

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryTournamentSettingsAndStatus(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "events")
	schoolID := dbtest.InsertSchool(t, pool, "Tournament School", "tournament-school")
	organizerID := dbtest.InsertUser(t, pool, schoolID, "tournament-organizer@example.test", "Tournament Organizer")
	playerID := dbtest.InsertUser(t, pool, schoolID, "tournament-player@example.test", "Tournament Player")
	var gameID, otherGameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Bracket Game', 'bracket-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Other Game', 'other-game') RETURNING id::text
	`).Scan(&otherGameID); err != nil {
		t.Fatalf("insert other game: %v", err)
	}

	repository := NewPostgresRepository(pool)
	startsAt := time.Date(2031, time.June, 1, 18, 0, 0, 0, time.UTC)
	create := func(title string, eventType string) Event {
		t.Helper()
		event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
			Title:         title,
			CreatorUserID: organizerID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID, otherGameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      AudienceOpen,
			EventType:     eventType,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(4 * time.Hour),
			Timezone:      "UTC",
		}})
		if err != nil {
			t.Fatalf("Create(%s) error = %v", title, err)
		}
		return event
	}
	event := create("Spring Bracket", EventTypeTournament)
	plain := create("Game Night", EventTypeGameNight)
	rsvped := create("Taken Bracket", EventTypeTournament)

	teamSize, entrantCap := 5, 16
	closes := startsAt.Add(-time.Hour)
	settings := TournamentInput{
		Slug:                 event.Slug,
		EditorUserID:         organizerID,
		GameID:               gameID,
		EntryType:            EntryTeam,
		TeamSize:             &teamSize,
		Substitutes:          1,
		EntrantCap:           &entrantCap,
		RegistrationClosesAt: &closes,
		Rules:                "  Best of three.  ",
	}
	with := func(change func(*TournamentInput)) TournamentInput {
		input := settings
		change(&input)
		return input
	}

	// The organizer's own RSVP does not block settings; anyone else's does.
	if _, err := repository.SetRSVP(ctx, RSVPInput{Slug: event.Slug, UserID: organizerID, Response: RSVPYes}); err != nil {
		t.Fatalf("SetRSVP(organizer) error = %v", err)
	}
	if _, err := repository.SetRSVP(ctx, RSVPInput{Slug: rsvped.Slug, UserID: playerID, Response: RSVPMaybe}); err != nil {
		t.Fatalf("SetRSVP(player) error = %v", err)
	}

	putErrors := map[string]string{}
	for name, input := range map[string]TournamentInput{
		"non-organizer":      with(func(i *TournamentInput) { i.EditorUserID = playerID }),
		"not a tournament":   with(func(i *TournamentInput) { i.Slug = plain.Slug }),
		"someone RSVP'd":     with(func(i *TournamentInput) { i.Slug = rsvped.Slug }),
		"game not on event":  with(func(i *TournamentInput) { i.GameID = organizerID }),
		"closes after start": with(func(i *TournamentInput) { later := startsAt.Add(time.Minute); i.RegistrationClosesAt = &later }),
	} {
		_, _, err := repository.PutTournament(ctx, input)
		putErrors[name] = fmt.Sprint(err)
	}
	wantPutErrors := map[string]string{
		"non-organizer":      ErrOrganizerRequired.Error(),
		"not a tournament":   ErrTournamentEventType.Error(),
		"someone RSVP'd":     ErrTournamentHasRSVPs.Error(),
		"game not on event":  ErrTournamentGame.Error(),
		"closes after start": "registration must close by the event's start",
	}
	if !reflect.DeepEqual(putErrors, wantPutErrors) {
		t.Fatalf("PutTournament errors = %q, want %q", putErrors, wantPutErrors)
	}

	created, isNew, err := repository.PutTournament(ctx, settings)
	if err != nil {
		t.Fatalf("PutTournament(create) error = %v", err)
	}
	wantCreated := Tournament{
		Game:                 GameSummary{ID: gameID, Name: "Bracket Game", Slug: "bracket-game"},
		EntryType:            EntryTeam,
		TeamSize:             &teamSize,
		Substitutes:          1,
		EntrantCap:           &entrantCap,
		RegistrationClosesAt: &closes,
		Format:               FormatSingleElimination,
		Rules:                "Best of three.",
		Status:               TournamentDraft,
	}
	if created.RegistrationClosesAt != nil {
		utc := created.RegistrationClosesAt.UTC()
		created.RegistrationClosesAt = &utc
	}
	if !isNew || !reflect.DeepEqual(created, wantCreated) {
		t.Fatalf("PutTournament(create) = %+v, %t; want %+v, true", created, isNew, wantCreated)
	}
	solo, isNew, err := repository.PutTournament(ctx, with(func(i *TournamentInput) {
		i.GameID, i.EntryType, i.TeamSize, i.Substitutes, i.EntrantCap, i.RegistrationClosesAt = otherGameID, EntrySolo, nil, 0, nil, nil
	}))
	if err != nil {
		t.Fatalf("PutTournament(update) error = %v", err)
	}
	wantSolo := Tournament{
		Game:      GameSummary{ID: otherGameID, Name: "Other Game", Slug: "other-game"},
		EntryType: EntrySolo,
		Format:    FormatSingleElimination,
		Rules:     "Best of three.",
		Status:    TournamentDraft,
	}
	if isNew || !reflect.DeepEqual(solo, wantSolo) {
		t.Fatalf("PutTournament(update) = %+v, %t; want %+v, false", solo, isNew, wantSolo)
	}

	// While settings exist the event keeps its type and the tournament's game,
	// and RSVPs give way to registration.
	edit := UpdateInput{
		Slug:         event.Slug,
		EditorUserID: organizerID,
		Title:        event.Title,
		HostSchoolID: schoolID,
		GameIDs:      []string{gameID, otherGameID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		Audience:     AudienceOpen,
		EventType:    EventTypeTournament,
		StartsAt:     event.StartsAt,
		EndsAt:       event.EndsAt,
		Timezone:     "UTC",
	}
	retyped, dropped := edit, edit
	retyped.EventType = EventTypeLAN
	dropped.GameIDs = []string{gameID}
	_, retypeErr := repository.Update(ctx, UpdateParams{UpdateInput: retyped})
	_, dropErr := repository.Update(ctx, UpdateParams{UpdateInput: dropped})
	_, keepErr := repository.Update(ctx, UpdateParams{UpdateInput: edit})
	_, rsvpErr := repository.SetRSVP(ctx, RSVPInput{Slug: event.Slug, UserID: playerID, Response: RSVPYes})
	_, declineErr := repository.SetRSVP(ctx, RSVPInput{Slug: event.Slug, UserID: organizerID, Response: RSVPNo})
	if got, want := []error{retypeErr, dropErr, keepErr, rsvpErr, declineErr},
		[]error{ErrTournamentEventType, ErrTournamentGame, nil, ErrTournamentRegistration, nil}; !reflect.DeepEqual(got, want) {
		t.Fatalf("edit and RSVP errors = %v, want %v", got, want)
	}

	var statuses []string
	var statusErrors []error
	for _, status := range []string{
		TournamentCompleted, TournamentRegistrationOpen, TournamentRegistrationOpen,
		TournamentDraft, TournamentRegistrationOpen, TournamentInProgress, TournamentDraft, TournamentCompleted,
	} {
		tournament, err := repository.SetTournamentStatus(ctx, event.Slug, organizerID, status)
		statuses = append(statuses, tournament.Status)
		statusErrors = append(statusErrors, err)
	}
	_, outsiderErr := repository.SetTournamentStatus(ctx, event.Slug, playerID, TournamentCancelled)
	_, _, lockedErr := repository.PutTournament(ctx, settings)
	deleteErr := repository.DeleteTournament(ctx, event.Slug, organizerID)
	if got, want := statuses, []string{
		"", TournamentRegistrationOpen, TournamentRegistrationOpen, TournamentDraft,
		TournamentRegistrationOpen, TournamentInProgress, "", TournamentCompleted,
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("statuses = %q, want %q", got, want)
	}
	if got, want := append(statusErrors, outsiderErr, lockedErr, deleteErr), []error{
		ErrTournamentStatus, nil, nil, nil, nil, nil, ErrTournamentStatus, nil,
		ErrOrganizerRequired, ErrTournamentLocked, ErrTournamentLocked,
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("status errors = %v, want %v", got, want)
	}

	page, err := repository.GetPageBySlug(ctx, event.Slug)
	if err != nil {
		t.Fatalf("GetPageBySlug() error = %v", err)
	}
	if page.Tournament == nil || page.Tournament.Status != TournamentCompleted {
		t.Fatalf("page tournament = %+v, want a completed tournament", page.Tournament)
	}
	plainPage, err := repository.GetPageBySlug(ctx, plain.Slug)
	if err != nil || plainPage.Tournament != nil {
		t.Fatalf("plain event tournament = %+v, %v; want none", plainPage.Tournament, err)
	}

	// A draft's settings can be deleted, and cancelling an event cancels its
	// tournament.
	if _, err := pool.Exec(ctx, `DELETE FROM event_rsvps WHERE event_id = $1::uuid`, rsvped.ID); err != nil {
		t.Fatalf("clear rsvps: %v", err)
	}
	if _, _, err := repository.PutTournament(ctx, with(func(i *TournamentInput) { i.Slug = rsvped.Slug })); err != nil {
		t.Fatalf("PutTournament(second) error = %v", err)
	}
	if err := repository.DeleteTournament(ctx, rsvped.Slug, organizerID); err != nil {
		t.Fatalf("DeleteTournament() error = %v", err)
	}
	if err := repository.DeleteTournament(ctx, rsvped.Slug, organizerID); !errors.Is(err, ErrTournamentNotFound) {
		t.Fatalf("DeleteTournament(again) error = %v, want %v", err, ErrTournamentNotFound)
	}
	if _, _, err := repository.PutTournament(ctx, with(func(i *TournamentInput) { i.Slug = rsvped.Slug })); err != nil {
		t.Fatalf("PutTournament(third) error = %v", err)
	}
	if err := repository.Delete(ctx, rsvped.Slug, organizerID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	cancelled, err := repository.GetPageBySlug(ctx, rsvped.Slug)
	if err != nil {
		t.Fatalf("GetPageBySlug(cancelled) error = %v", err)
	}
	if cancelled.Tournament == nil || cancelled.Tournament.Status != TournamentCancelled {
		t.Fatalf("cancelled event tournament = %+v, want a cancelled tournament", cancelled.Tournament)
	}
}
