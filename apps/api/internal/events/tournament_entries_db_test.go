package events

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryTournamentRegistration(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "events")
	schoolID := dbtest.InsertSchool(t, pool, "Entry School", "entry-school")
	user := func(email, name string) string {
		return dbtest.InsertUser(t, pool, schoolID, email, name, dbtest.VerifiedEmail())
	}
	organizerID := user("entry-organizer@example.test", "Organizer")
	owner := user("entry-owner@example.test", "Owner")
	captain := user("entry-captain@example.test", "Captain")
	member := user("entry-member@example.test", "Member")
	rival := user("entry-rival@example.test", "Rival")
	unverified := dbtest.InsertUser(t, pool, schoolID, "entry-unverified@example.test", "Unverified")
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Entry Game', 'entry-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	publicIDs := map[string]string{}
	rows, err := pool.Query(ctx, `SELECT id::text, public_id FROM users`)
	if err != nil {
		t.Fatalf("read public IDs: %v", err)
	}
	for rows.Next() {
		var id, publicID string
		if err := rows.Scan(&id, &publicID); err != nil {
			t.Fatalf("scan public ID: %v", err)
		}
		publicIDs[id] = publicID
	}
	rows.Close()
	// Knights: owner, captain, and member. Rooks: rival alone, with member
	// on its books too so a roster can try to reuse them.
	if _, err := pool.Exec(ctx, `
		WITH knights AS (
		    INSERT INTO teams (owner_user_id, name, slug, password_hash)
		    VALUES ($1::uuid, 'Knights', 'knights', 'hash') RETURNING id),
		rooks AS (
		    INSERT INTO teams (owner_user_id, name, slug, password_hash)
		    VALUES ($4::uuid, 'Rooks', 'rooks', 'hash') RETURNING id)
		INSERT INTO team_members (team_id, user_id, role)
		SELECT knights.id, m.user_id::uuid, m.role FROM knights,
		    (VALUES ($1, 'owner'), ($2, 'captain'), ($3, 'member')) AS m (user_id, role)
		UNION ALL
		SELECT rooks.id, m.user_id::uuid, m.role FROM rooks,
		    (VALUES ($4, 'owner'), ($3, 'member')) AS m (user_id, role)
	`, owner, captain, member, rival); err != nil {
		t.Fatalf("insert teams: %v", err)
	}

	repository := NewPostgresRepository(pool)
	startsAt := time.Date(2031, time.June, 1, 18, 0, 0, 0, time.UTC)
	tournament := func(title string, input TournamentInput) string {
		t.Helper()
		event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
			Title: title, CreatorUserID: organizerID, HostSchoolID: schoolID, GameIDs: []string{gameID},
			Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceOpen, EventType: EventTypeTournament,
			StartsAt: startsAt, EndsAt: startsAt.Add(4 * time.Hour), Timezone: "UTC",
		}})
		if err != nil {
			t.Fatalf("Create(%s) error = %v", title, err)
		}
		input.Slug, input.EditorUserID, input.GameID = event.Slug, organizerID, gameID
		if _, _, err := repository.PutTournament(ctx, input); err != nil {
			t.Fatalf("PutTournament(%s) error = %v", title, err)
		}
		return event.Slug
	}
	soloCap, teamSize := 3, 2
	solo := tournament("Solo Cup", TournamentInput{EntryType: EntrySolo, EntrantCap: &soloCap})
	team := tournament("Team Cup", TournamentInput{EntryType: EntryTeam, TeamSize: &teamSize, Substitutes: 1})

	// Nobody registers for a draft, which only organizers can see.
	_, draftErr := repository.Register(ctx, RegisterInput{Slug: solo, UserID: member})
	_, draftListErr := repository.ListEntries(ctx, solo, member)
	if got, want := []error{draftErr, draftListErr}, []error{ErrTournamentNotFound, ErrTournamentNotFound}; !reflect.DeepEqual(got, want) {
		t.Fatalf("draft errors = %v, want %v", got, want)
	}
	for _, slug := range []string{solo, team} {
		if _, err := repository.SetTournamentStatus(ctx, slug, organizerID, TournamentRegistrationOpen); err != nil {
			t.Fatalf("open %s: %v", slug, err)
		}
	}

	register := func(slug, userID, teamSlug string, roster ...string) (TournamentEntry, error) {
		ids := make([]string, len(roster))
		for index, id := range roster {
			ids[index] = publicIDs[id]
		}
		return repository.Register(ctx, RegisterInput{Slug: slug, UserID: userID, TeamSlug: teamSlug, Roster: ids})
	}

	// Solo: register, refuse a second entry, withdraw, and register again.
	memberEntry, err := register(solo, member, "")
	if err != nil {
		t.Fatalf("Register(member) error = %v", err)
	}
	_, twiceErr := register(solo, member, "")
	_, unverifiedErr := register(solo, unverified, "")
	_, teamInSoloErr := register(solo, owner, "knights", owner, captain)
	if err := repository.DeleteEntry(ctx, solo, member, memberEntry.ID); err != nil {
		t.Fatalf("DeleteEntry(withdraw) error = %v", err)
	}
	if _, err := register(solo, owner, ""); err != nil {
		t.Fatalf("Register(owner) error = %v", err)
	}
	if _, err := register(solo, member, ""); err != nil {
		t.Fatalf("Register(member again) error = %v", err)
	}
	rivalEntry, err := register(solo, rival, "")
	if err != nil {
		t.Fatalf("Register(rival) error = %v", err)
	}
	_, fullErr := register(solo, captain, "")
	if got, want := []error{twiceErr, unverifiedErr, teamInSoloErr, fullErr},
		[]error{ErrAlreadyEntered, ErrEmailUnverified, ErrEntryType, ErrTournamentFull}; !reflect.DeepEqual(got, want) {
		t.Fatalf("solo errors = %v, want %v", got, want)
	}

	// An organizer removes an entry, the entrant is told, and the entrant
	// cannot come back; someone else cannot withdraw it.
	soloEntries, err := repository.ListEntries(ctx, solo, "")
	if err != nil {
		t.Fatalf("ListEntries(solo) error = %v", err)
	}
	ownerEntryID := soloEntries[0].ID
	outsiderErr := repository.DeleteEntry(ctx, solo, member, ownerEntryID)
	if err := repository.DeleteEntry(ctx, solo, organizerID, rivalEntry.ID); err != nil {
		t.Fatalf("DeleteEntry(remove) error = %v", err)
	}
	_, removedErr := register(solo, rival, "")
	var notices []string
	if err := pool.QueryRow(ctx, `
		SELECT array_agg(type || ': ' || body) FROM notifications WHERE user_id = $1::uuid
	`, rival).Scan(&notices); err != nil {
		t.Fatalf("read notices: %v", err)
	}
	if got, want := []error{outsiderErr, removedErr}, []error{ErrEntryManagerRequired, ErrEntryRemoved}; !reflect.DeepEqual(got, want) {
		t.Fatalf("removal errors = %v, want %v", got, want)
	}
	if want := []string{"tournament.entry_removed: An organizer removed your entry from Solo Cup."}; !reflect.DeepEqual(notices, want) {
		t.Fatalf("rival notices = %q, want %q", notices, want)
	}
	soloEntries, err = repository.ListEntries(ctx, solo, "")
	if err != nil {
		t.Fatalf("ListEntries(solo) error = %v", err)
	}
	for index := range soloEntries {
		soloEntries[index].ID, soloEntries[index].RegisteredAt = "", time.Time{}
	}
	if want := []TournamentEntry{
		{Seed: 1, Player: &EntryPlayer{PublicID: publicIDs[owner], Name: "Owner"}},
		{Seed: 2, Player: &EntryPlayer{PublicID: publicIDs[member], Name: "Member"}},
	}; !reflect.DeepEqual(soloEntries, want) {
		t.Fatalf("solo entries = %+v, want %+v", soloEntries, want)
	}

	// Team: only the owner or a captain registers, with a roster of the
	// team's members from the team size to the team size plus substitutes.
	_, memberTeamErr := register(team, member, "knights", owner, member)
	_, shortErr := register(team, owner, "knights", owner)
	_, outsiderRosterErr := register(team, owner, "knights", owner, rival)
	_, soloInTeamErr := register(team, owner, "")
	knights, err := register(team, captain, "knights", owner, captain, member)
	if err != nil {
		t.Fatalf("Register(knights) error = %v", err)
	}
	_, takenErr := register(team, rival, "rooks", rival, member)
	_, againErr := register(team, owner, "knights", owner, captain)
	if got, want := []error{memberTeamErr, shortErr, outsiderRosterErr, soloInTeamErr, takenErr, againErr}, []error{
		ErrEntryTeamNotAllowed, ErrRosterInvalid, ErrRosterInvalid, ErrEntryType, ErrPlayerEntered, ErrAlreadyEntered,
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("team errors = %v, want %v", got, want)
	}

	// The roster changes until the start, and a member who leaves the team
	// leaves its roster, free to play for another.
	if _, err := repository.UpdateRoster(ctx, team, member, knights.ID, []string{publicIDs[owner], publicIDs[member]}); err != ErrEntryManagerRequired {
		t.Fatalf("UpdateRoster(member) error = %v, want %v", err, ErrEntryManagerRequired)
	}
	if _, err := repository.UpdateRoster(ctx, team, owner, knights.ID, []string{publicIDs[owner], publicIDs[member]}); err != nil {
		t.Fatalf("UpdateRoster(owner) error = %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE team_members SET deleted_at = NOW()
		WHERE user_id = $1::uuid AND team_id = (SELECT id FROM teams WHERE slug = 'knights')
	`, member); err != nil {
		t.Fatalf("leave team: %v", err)
	}
	rooks, err := register(team, rival, "rooks", rival, member)
	if err != nil {
		t.Fatalf("Register(rooks) error = %v", err)
	}
	captainView, err := repository.ViewerEntry(ctx, team, captain)
	if err != nil {
		t.Fatalf("ViewerEntry(captain) error = %v", err)
	}
	memberView, err := repository.ViewerEntry(ctx, team, member)
	if err != nil {
		t.Fatalf("ViewerEntry(member) error = %v", err)
	}
	teams, err := repository.RegistrationTeams(ctx, team, owner)
	if err != nil {
		t.Fatalf("RegistrationTeams() error = %v", err)
	}
	entries, err := repository.ListEntries(ctx, team, organizerID)
	if err != nil {
		t.Fatalf("ListEntries(team) error = %v", err)
	}
	for index := range entries {
		entries[index].RegisteredAt = time.Time{}
	}
	knightsTeam := knights.Team
	rooksTeam := rooks.Team
	if want := []RegistrationTeam{{
		ID: knightsTeam.ID, Name: "Knights", Slug: "knights", Entered: true,
		Members: []EntryPlayer{{PublicID: publicIDs[captain], Name: "Captain"}, {PublicID: publicIDs[owner], Name: "Owner"}},
	}}; !reflect.DeepEqual(teams, want) {
		t.Fatalf("RegistrationTeams() = %+v, want %+v", teams, want)
	}
	if got, want := []*ViewerEntry{captainView, memberView}, []*ViewerEntry{
		{ID: knights.ID, Team: knightsTeam, CanManage: true},
		{ID: rooks.ID, Team: rooksTeam, CanManage: false},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("viewer entries = %+v, want %+v", got, want)
	}
	if want := []TournamentEntry{
		{ID: knights.ID, Seed: 1, Team: knightsTeam, Roster: []EntryPlayer{{PublicID: publicIDs[owner], Name: "Owner"}}},
		{ID: rooks.ID, Seed: 2, Team: rooksTeam, Roster: []EntryPlayer{
			{PublicID: publicIDs[member], Name: "Member"}, {PublicID: publicIDs[rival], Name: "Rival"},
		}},
	}; !reflect.DeepEqual(entries, want) {
		t.Fatalf("team entries = %+v, want %+v", entries, want)
	}
	if signedOut := entries[1].ForSignedOut(); signedOut.Roster != nil || signedOut.Team == nil {
		t.Fatalf("signed-out entry = %+v, want the team without its roster", signedOut)
	}

	// Entries freeze at the start, and entry type, team size, and format are
	// fixed once anyone has registered.
	_, _, settingsErr := repository.PutTournament(ctx, TournamentInput{
		Slug: team, EditorUserID: organizerID, GameID: gameID, EntryType: EntrySolo,
	})
	if _, err := repository.SetTournamentStatus(ctx, team, organizerID, TournamentInProgress); err != nil {
		t.Fatalf("start team tournament: %v", err)
	}
	withdrawErr := repository.DeleteEntry(ctx, team, owner, knights.ID)
	_, rosterErr := repository.UpdateRoster(ctx, team, owner, knights.ID, []string{publicIDs[owner], publicIDs[captain]})
	repository.now = func() time.Time { return startsAt }
	_, lateErr := register(solo, captain, "")
	if got, want := []error{settingsErr, withdrawErr, rosterErr, lateErr},
		[]error{ErrTournamentHasEntries, ErrTournamentStarted, ErrTournamentStarted, ErrRegistrationClosed}; !reflect.DeepEqual(got, want) {
		t.Fatalf("closed errors = %v, want %v", got, want)
	}

	// Cancelling the event emails its entrants as it emails RSVPs.
	if err := repository.Delete(ctx, solo, organizerID); err != nil {
		t.Fatalf("Delete(solo) error = %v", err)
	}
	var recipients []string
	if err := pool.QueryRow(ctx, `
		SELECT array_agg(recipient ORDER BY recipient) FROM email_outbox WHERE kind = 'event_cancellation'
	`).Scan(&recipients); err != nil {
		t.Fatalf("read cancellation emails: %v", err)
	}
	if want := []string{"entry-member@example.test", "entry-owner@example.test"}; !reflect.DeepEqual(recipients, want) {
		t.Fatalf("cancellation recipients = %q, want %q", recipients, want)
	}
}
