package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
	"github.com/jackc/pgx/v5"
)

// Tournament entry status values.
const (
	EntryRegistered = "registered"
	EntryWithdrawn  = "withdrawn"
	EntryRemoved    = "removed"
)

// Errors returned by tournament registration.
var (
	ErrRegistrationClosed = apperror.New(apperror.KindConflict, "tournament_registration_closed", "tournament registration is not open")
	ErrTournamentFull     = apperror.New(apperror.KindConflict, "tournament_full", "the tournament is full")
	// ErrAlreadyEntered reports a person or team that already has an active
	// entry in the tournament.
	ErrAlreadyEntered = apperror.New(apperror.KindConflict, "tournament_already_entered", "already entered in this tournament")
	// ErrEntryRemoved reports an entrant an organizer removed, who cannot
	// register again.
	ErrEntryRemoved = apperror.New(apperror.KindConflict, "tournament_entry_removed", "an organizer removed this entry from the tournament")
	// ErrPlayerEntered reports a roster player who is already in another
	// entry of the tournament.
	ErrPlayerEntered = apperror.New(apperror.KindConflict, "tournament_player_already_entered", "a roster player is already in another entry")
	// ErrRosterInvalid reports a roster of the wrong size, with repeats, or
	// with someone who is not an active member of the team.
	ErrRosterInvalid = apperror.New(apperror.KindUnprocessable, "invalid_tournament_roster", "the roster must be the team's members, from the team size up to the team size plus substitutes")
	// ErrEntryType reports a team registering for a solo tournament, or a
	// person registering alone for a team one.
	ErrEntryType = apperror.New(apperror.KindUnprocessable, "tournament_entry_type_mismatch", "the tournament takes the other kind of entry")
	// ErrEntryTeamNotAllowed reports a team that does not exist or that the
	// user does not own or captain.
	ErrEntryTeamNotAllowed = apperror.New(apperror.KindUnprocessable, "tournament_team_not_allowed", "the team must be one you own or captain")
	// ErrEntryManagerRequired reports a change to an entry by someone who is
	// neither its entrant nor, for removal, an organizer.
	ErrEntryManagerRequired = apperror.New(apperror.KindAuthorization, "not_tournament_entrant", "only the entrant can do this")
	ErrEntryNotFound        = apperror.New(apperror.KindNotFound, "tournament_entry_not_found", "tournament entry not found")
	// ErrTournamentStarted reports a change to entries once the tournament
	// has started.
	ErrTournamentStarted = apperror.New(apperror.KindConflict, "tournament_started", "entries are fixed once the tournament starts")
	// ErrEmailUnverified reports a registration from an account that has not
	// verified its email address.
	ErrEmailUnverified = apperror.New(apperror.KindAuthorization, "email_verification_required", "verify your email address first")
	// ErrTournamentHasEntries reports a move back to draft, or a change of
	// entry type, team size, or format, after someone has registered.
	ErrTournamentHasEntries = apperror.New(apperror.KindConflict, "tournament_has_entries", "the tournament already has entries")
	// ErrTournamentNeedsEntrants reports starting a tournament with fewer
	// than two entries.
	ErrTournamentNeedsEntrants = apperror.New(apperror.KindConflict, "tournament_needs_entrants", "a tournament needs two or more entries to start")
)

// TournamentEntry is one active entry as the entrant list shows it. A
// signed-out viewer receives a solo entry without Player and a team entry
// without Roster.
type TournamentEntry struct {
	ID string `json:"id"`
	// Seed is the entry's place in seed order, from 1.
	Seed         int           `json:"seed"`
	Player       *EntryPlayer  `json:"player,omitempty"`
	Team         *TeamSummary  `json:"team,omitempty"`
	Roster       []EntryPlayer `json:"roster,omitempty"`
	RegisteredAt time.Time     `json:"registered_at"`
}

// EntryPlayer names a solo entrant or a roster player.
type EntryPlayer struct {
	PublicID string `json:"public_id"`
	Name     string `json:"name"`
}

// ViewerEntry is the signed-in viewer's own entry: theirs alone, one on whose
// roster they are, or one for a team they own or captain.
type ViewerEntry struct {
	ID   string       `json:"id"`
	Team *TeamSummary `json:"team,omitempty"`
	// CanManage is set for the solo player and for the team's owner and
	// captains, who may change the roster and withdraw.
	CanManage bool `json:"can_manage"`
}

// RegistrationTeam is a team the viewer owns or captains, with the members a
// roster may pick from.
type RegistrationTeam struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Slug    string        `json:"slug"`
	Entered bool          `json:"entered"`
	Members []EntryPlayer `json:"members"`
}

// RegisterInput registers UserID alone, or the team TeamSlug with Roster (the
// players' public IDs).
type RegisterInput struct {
	Slug     string
	UserID   string
	TeamSlug string
	Roster   []string
}

// entryTournament is a tournament locked for a registration change.
type entryTournament struct {
	EventID     string
	ID          string
	Status      string
	EntryType   string
	TeamSize    int
	Substitutes int
	Cap         sql.NullInt32
	ClosesAt    time.Time
	Organizer   bool
	EntryCount  int
}

// lockEntryTournament locks the tournament on the live event with slug. A
// draft is not found for anyone but the event's organizers.
func lockEntryTournament(ctx context.Context, tx pgx.Tx, slug string, userID string) (entryTournament, error) {
	var tournament entryTournament
	var teamSize sql.NullInt32
	err := tx.QueryRow(ctx, `
		SELECT e.id::text, t.id::text, t.status, t.entry_type, t.team_size, t.substitutes, t.entrant_cap,
		       COALESCE(LEAST(t.registration_closes_at, e.starts_at), e.starts_at),
		       `+editableBy("$2")+`,
		       (SELECT COUNT(*) FROM tournament_entries te WHERE te.tournament_id = t.id AND te.status = 'registered')::int
		FROM events e
		JOIN tournaments t ON t.event_id = e.id
		WHERE e.slug = $1 AND e.deleted_at IS NULL
		FOR UPDATE OF t
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(
		&tournament.EventID, &tournament.ID, &tournament.Status, &tournament.EntryType, &teamSize,
		&tournament.Substitutes, &tournament.Cap, &tournament.ClosesAt, &tournament.Organizer, &tournament.EntryCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return entryTournament{}, ErrTournamentNotFound
	}
	if err != nil {
		return entryTournament{}, fmt.Errorf("lock tournament: %w", err)
	}
	if tournament.Status == TournamentDraft && !tournament.Organizer {
		return entryTournament{}, ErrTournamentNotFound
	}
	tournament.TeamSize = int(teamSize.Int32)
	return tournament, nil
}

// Register enters the user, or a team they own or captain, in the tournament
// on the event with slug while registration is open. A withdrawn entrant
// registering again keeps its entry and goes to the end of the seed order.
func (r *PostgresRepository) Register(ctx context.Context, input RegisterInput) (TournamentEntry, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return TournamentEntry{}, fmt.Errorf("begin tournament registration: %w", err)
	}
	defer tx.Rollback(ctx)

	tournament, err := lockEntryTournament(ctx, tx, input.Slug, input.UserID)
	if err != nil {
		return TournamentEntry{}, err
	}
	if tournament.Status != TournamentRegistrationOpen || !r.now().Before(tournament.ClosesAt) {
		return TournamentEntry{}, ErrRegistrationClosed
	}
	var verified bool
	if err := tx.QueryRow(ctx, `
		SELECT email_verified_at IS NOT NULL FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
	`, input.UserID).Scan(&verified); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return TournamentEntry{}, fmt.Errorf("check registering account: %w", err)
	}
	if !verified {
		return TournamentEntry{}, ErrEmailUnverified
	}
	if tournament.Cap.Valid && tournament.EntryCount >= int(tournament.Cap.Int32) {
		return TournamentEntry{}, ErrTournamentFull
	}
	team := strings.TrimSpace(input.TeamSlug) != ""
	if team != (tournament.EntryType == EntryTeam) {
		return TournamentEntry{}, ErrEntryType
	}

	var entrantColumn, entrantID string
	if team {
		var manager bool
		err := tx.QueryRow(ctx, `
			SELECT t.id::text, EXISTS (
			    SELECT 1 FROM team_members m
			    WHERE m.team_id = t.id AND m.user_id = $2::uuid
			      AND m.deleted_at IS NULL AND m.role IN ('owner', 'captain'))
			FROM teams t
			WHERE t.slug = $1 AND t.deleted_at IS NULL
		`, strings.TrimSpace(input.TeamSlug), input.UserID).Scan(&entrantID, &manager)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !manager) {
			return TournamentEntry{}, ErrEntryTeamNotAllowed
		}
		if err != nil {
			return TournamentEntry{}, fmt.Errorf("check entry team: %w", err)
		}
		entrantColumn = "team_id"
	} else {
		entrantColumn, entrantID = "user_id", input.UserID
		if active, err := personEntered(ctx, tx, tournament.ID, []string{input.UserID}, ""); err != nil {
			return TournamentEntry{}, err
		} else if active {
			return TournamentEntry{}, ErrAlreadyEntered
		}
	}

	var entryID, status string
	err = tx.QueryRow(ctx, `
		SELECT id::text, status FROM tournament_entries
		WHERE tournament_id = $1::uuid AND `+entrantColumn+` = $2::uuid
	`, tournament.ID, entrantID).Scan(&entryID, &status)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if err := tx.QueryRow(ctx, `
			INSERT INTO tournament_entries (tournament_id, `+entrantColumn+`, registered_by_user_id)
			VALUES ($1::uuid, $2::uuid, $3::uuid)
			RETURNING id::text
		`, tournament.ID, entrantID, input.UserID).Scan(&entryID); err != nil {
			return TournamentEntry{}, fmt.Errorf("insert tournament entry: %w", err)
		}
	case err != nil:
		return TournamentEntry{}, fmt.Errorf("load tournament entry: %w", err)
	case status == EntryRegistered:
		return TournamentEntry{}, ErrAlreadyEntered
	case status == EntryRemoved:
		return TournamentEntry{}, ErrEntryRemoved
	default:
		if _, err := tx.Exec(ctx, `
			UPDATE tournament_entries
			SET status = 'registered', registered_at = NOW(), registered_by_user_id = $2::uuid, seed = NULL
			WHERE id = $1::uuid
		`, entryID, input.UserID); err != nil {
			return TournamentEntry{}, fmt.Errorf("reregister tournament entry: %w", err)
		}
	}
	if team {
		if err := setRoster(ctx, tx, tournament, entryID, entrantID, input.Roster); err != nil {
			return TournamentEntry{}, err
		}
	}

	entry, err := loadEntry(ctx, tx, tournament.ID, entryID)
	if err != nil {
		return TournamentEntry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TournamentEntry{}, fmt.Errorf("commit tournament registration: %w", err)
	}
	return entry, nil
}

// UpdateRoster replaces the roster of a team entry for the team's owner or a
// captain until the tournament starts.
func (r *PostgresRepository) UpdateRoster(ctx context.Context, slug string, userID string, entryID string, roster []string) (TournamentEntry, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return TournamentEntry{}, fmt.Errorf("begin roster update: %w", err)
	}
	defer tx.Rollback(ctx)

	tournament, err := lockEntryTournament(ctx, tx, slug, userID)
	if err != nil {
		return TournamentEntry{}, err
	}
	entry, err := lockEntry(ctx, tx, tournament.ID, entryID, userID)
	if err != nil {
		return TournamentEntry{}, err
	}
	if entry.teamID == "" {
		return TournamentEntry{}, ErrEntryType
	}
	if !entry.manager {
		return TournamentEntry{}, ErrEntryManagerRequired
	}
	if tournament.Status != TournamentRegistrationOpen {
		return TournamentEntry{}, ErrTournamentStarted
	}
	if err := setRoster(ctx, tx, tournament, entryID, entry.teamID, roster); err != nil {
		return TournamentEntry{}, err
	}
	updated, err := loadEntry(ctx, tx, tournament.ID, entryID)
	if err != nil {
		return TournamentEntry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TournamentEntry{}, fmt.Errorf("commit roster update: %w", err)
	}
	return updated, nil
}

// DeleteEntry withdraws an entry for its entrant, or removes it for an
// organizer, until the tournament starts. A removed entrant is told so and
// cannot register again.
func (r *PostgresRepository) DeleteEntry(ctx context.Context, slug string, userID string, entryID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin entry delete: %w", err)
	}
	defer tx.Rollback(ctx)

	tournament, err := lockEntryTournament(ctx, tx, slug, userID)
	if err != nil {
		return err
	}
	entry, err := lockEntry(ctx, tx, tournament.ID, entryID, userID)
	if err != nil {
		return err
	}
	if !entry.manager && !tournament.Organizer {
		return ErrEntryManagerRequired
	}
	if tournament.Status != TournamentRegistrationOpen {
		return ErrTournamentStarted
	}
	status := EntryWithdrawn
	if !entry.manager {
		status = EntryRemoved
	}

	var recipients []string
	if status == EntryRemoved {
		rows, err := tx.Query(ctx, `
			SELECT DISTINCT u.id::text
			FROM users u
			WHERE u.deleted_at IS NULL AND u.account_status = 'active'
			  AND (u.id IN (SELECT user_id FROM tournament_entries WHERE id = $1::uuid)
			       OR u.id IN (SELECT user_id FROM tournament_entry_players WHERE entry_id = $1::uuid)
			       OR u.id IN (SELECT m.user_id FROM team_members m
			                   JOIN tournament_entries te ON te.team_id = m.team_id
			                   WHERE te.id = $1::uuid AND m.deleted_at IS NULL AND m.role IN ('owner', 'captain')))
			ORDER BY 1
		`, entryID)
		if err != nil {
			return fmt.Errorf("list removed entrants: %w", err)
		}
		recipients, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return fmt.Errorf("scan removed entrants: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE tournament_entries SET status = $2 WHERE id = $1::uuid`, entryID, status); err != nil {
		return fmt.Errorf("delete tournament entry: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM tournament_entry_players WHERE entry_id = $1::uuid`, entryID); err != nil {
		return fmt.Errorf("clear tournament roster: %w", err)
	}
	if len(recipients) > 0 {
		var title string
		if err := tx.QueryRow(ctx, `SELECT title FROM events WHERE id = $1::uuid`, tournament.EventID).Scan(&title); err != nil {
			return fmt.Errorf("load event title: %w", err)
		}
		inputs := make([]notifications.Input, 0, len(recipients))
		for _, recipient := range recipients {
			inputs = append(inputs, notifications.Input{
				UserID:  recipient,
				Type:    notifications.TypeTournamentEntryRemoved,
				Title:   "Tournament entry removed",
				Body:    "An organizer removed your entry from " + title + ".",
				EventID: tournament.EventID,
			})
		}
		if err := notifications.Insert(ctx, tx, inputs...); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit entry delete: %w", err)
	}
	return nil
}

// ListEntries returns the active entries of the tournament on the event with
// slug in seed order. A draft is not found for anyone but the organizers.
func (r *PostgresRepository) ListEntries(ctx context.Context, slug string, userID string) ([]TournamentEntry, error) {
	var tournamentID, status string
	var organizer bool
	err := r.pool.QueryRow(ctx, `
		SELECT t.id::text, t.status, `+editableBy("NULLIF($2, '')")+`
		FROM events e
		JOIN tournaments t ON t.event_id = e.id
		WHERE e.slug = $1 AND e.deleted_at IS NULL
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&tournamentID, &status, &organizer)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && status == TournamentDraft && !organizer) {
		return nil, ErrTournamentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load tournament: %w", err)
	}
	return listEntries(ctx, r.pool, tournamentID, "")
}

// ViewerEntry returns the user's own entry in the tournament on the event
// with slug, or nil when they have none.
func (r *PostgresRepository) ViewerEntry(ctx context.Context, slug string, userID string) (*ViewerEntry, error) {
	var entry ViewerEntry
	var teamID, teamName, teamSlug sql.NullString
	err := r.pool.QueryRow(ctx, `
		SELECT te.id::text, tm.id::text, tm.name, tm.slug,
		       COALESCE(te.user_id = $2::uuid, FALSE) OR EXISTS (
		           SELECT 1 FROM team_members m
		           WHERE m.team_id = te.team_id AND m.user_id = $2::uuid
		             AND m.deleted_at IS NULL AND m.role IN ('owner', 'captain'))
		FROM events e
		JOIN tournaments t ON t.event_id = e.id
		JOIN tournament_entries te ON te.tournament_id = t.id AND te.status = 'registered'
		LEFT JOIN teams tm ON tm.id = te.team_id
		WHERE e.slug = $1 AND e.deleted_at IS NULL
		  AND (te.user_id = $2::uuid
		       OR EXISTS (SELECT 1 FROM tournament_entry_players p WHERE p.entry_id = te.id AND p.user_id = $2::uuid)
		       OR EXISTS (SELECT 1 FROM team_members m
		                  WHERE m.team_id = te.team_id AND m.user_id = $2::uuid
		                    AND m.deleted_at IS NULL AND m.role IN ('owner', 'captain')))
		ORDER BY te.registered_at, te.id
		LIMIT 1
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&entry.ID, &teamID, &teamName, &teamSlug, &entry.CanManage)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load viewer entry: %w", err)
	}
	if teamID.Valid {
		entry.Team = &TeamSummary{ID: teamID.String, Name: teamName.String, Slug: teamSlug.String}
	}
	return &entry, nil
}

// RegistrationTeams returns the live teams the user owns or captains, by
// name, with their active members and whether each is already entered in
// the tournament on the event with slug.
func (r *PostgresRepository) RegistrationTeams(ctx context.Context, slug string, userID string) ([]RegistrationTeam, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT tm.id::text, tm.name, tm.slug,
		       EXISTS (SELECT 1 FROM tournament_entries te
		               JOIN tournaments t ON t.id = te.tournament_id
		               JOIN events e ON e.id = t.event_id
		               WHERE te.team_id = tm.id AND te.status = 'registered' AND e.slug = $2),
		       COALESCE((
		           SELECT array_agg(u.public_id ORDER BY lower(u.name), u.public_id)
		           FROM team_members m JOIN users u ON u.id = m.user_id
		           WHERE m.team_id = tm.id AND m.deleted_at IS NULL
		             AND u.deleted_at IS NULL AND u.account_status = 'active'), '{}'),
		       COALESCE((
		           SELECT array_agg(u.name ORDER BY lower(u.name), u.public_id)
		           FROM team_members m JOIN users u ON u.id = m.user_id
		           WHERE m.team_id = tm.id AND m.deleted_at IS NULL
		             AND u.deleted_at IS NULL AND u.account_status = 'active'), '{}')
		FROM teams tm
		JOIN team_members me ON me.team_id = tm.id AND me.user_id = $1::uuid
		     AND me.deleted_at IS NULL AND me.role IN ('owner', 'captain')
		WHERE tm.deleted_at IS NULL
		ORDER BY lower(tm.name), tm.id
	`, strings.TrimSpace(userID), strings.TrimSpace(slug))
	if err != nil {
		return nil, fmt.Errorf("list registration teams: %w", err)
	}
	defer rows.Close()
	teams := []RegistrationTeam{}
	for rows.Next() {
		var team RegistrationTeam
		var ids, names []string
		if err := rows.Scan(&team.ID, &team.Name, &team.Slug, &team.Entered, &ids, &names); err != nil {
			return nil, fmt.Errorf("scan registration team: %w", err)
		}
		team.Members = make([]EntryPlayer, len(ids))
		for index := range ids {
			team.Members[index] = EntryPlayer{PublicID: ids[index], Name: names[index]}
		}
		teams = append(teams, team)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate registration teams: %w", err)
	}
	return teams, nil
}

// lockedEntry is an active entry locked for a change.
type lockedEntry struct {
	teamID string
	// manager is set for the solo player and the team's owner and captains.
	manager bool
}

func lockEntry(ctx context.Context, tx pgx.Tx, tournamentID string, entryID string, userID string) (lockedEntry, error) {
	var entry lockedEntry
	var teamID sql.NullString
	err := tx.QueryRow(ctx, `
		SELECT te.team_id::text,
		       COALESCE(te.user_id = $3::uuid, FALSE) OR EXISTS (
		           SELECT 1 FROM team_members m
		           WHERE m.team_id = te.team_id AND m.user_id = $3::uuid
		             AND m.deleted_at IS NULL AND m.role IN ('owner', 'captain'))
		FROM tournament_entries te
		WHERE te.id::text = $2 AND te.tournament_id = $1::uuid AND te.status = 'registered'
		FOR UPDATE
	`, tournamentID, entryID, userID).Scan(&teamID, &entry.manager)
	if errors.Is(err, pgx.ErrNoRows) {
		return lockedEntry{}, ErrEntryNotFound
	}
	if err != nil {
		return lockedEntry{}, fmt.Errorf("lock tournament entry: %w", err)
	}
	entry.teamID = teamID.String
	return entry, nil
}

// personEntered reports whether any of userIDs is in an active entry of the
// tournament other than exceptEntryID: alone, or on a roster.
func personEntered(ctx context.Context, tx pgx.Tx, tournamentID string, userIDs []string, exceptEntryID string) (bool, error) {
	var entered bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1 FROM tournament_entries
		    WHERE tournament_id = $1::uuid AND status = 'registered' AND user_id::text = ANY($2)
		) OR EXISTS (
		    SELECT 1 FROM tournament_entry_players
		    WHERE tournament_id = $1::uuid AND user_id::text = ANY($2) AND entry_id::text <> $3
		)
	`, tournamentID, userIDs, exceptEntryID).Scan(&entered); err != nil {
		return false, fmt.Errorf("check entered players: %w", err)
	}
	return entered, nil
}

// setRoster replaces the roster of the team entry entryID with the players
// whose public IDs are given: active members of the team, from the team size
// up to the team size plus substitutes, in no other entry.
func setRoster(ctx context.Context, tx pgx.Tx, tournament entryTournament, entryID string, teamID string, publicIDs []string) error {
	roster := normalizeIDs(publicIDs)
	if len(roster) != len(publicIDs) || len(roster) < tournament.TeamSize || len(roster) > tournament.TeamSize+tournament.Substitutes {
		return ErrRosterInvalid
	}
	rows, err := tx.Query(ctx, `
		SELECT u.id::text
		FROM users u
		JOIN team_members m ON m.user_id = u.id AND m.team_id = $1::uuid AND m.deleted_at IS NULL
		WHERE u.public_id = ANY($2) AND u.deleted_at IS NULL AND u.account_status = 'active'
	`, teamID, roster)
	if err != nil {
		return fmt.Errorf("resolve roster: %w", err)
	}
	userIDs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("scan roster: %w", err)
	}
	if len(userIDs) != len(roster) {
		return ErrRosterInvalid
	}
	if entered, err := personEntered(ctx, tx, tournament.ID, userIDs, entryID); err != nil {
		return err
	} else if entered {
		return ErrPlayerEntered
	}
	if _, err := tx.Exec(ctx, `DELETE FROM tournament_entry_players WHERE entry_id = $1::uuid`, entryID); err != nil {
		return fmt.Errorf("clear roster: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tournament_entry_players (entry_id, tournament_id, user_id)
		SELECT $1::uuid, $2::uuid, id::uuid FROM unnest($3::text[]) AS id
	`, entryID, tournament.ID, userIDs); err != nil {
		return fmt.Errorf("insert roster: %w", err)
	}
	return nil
}

func loadEntry(ctx context.Context, tx pgx.Tx, tournamentID string, entryID string) (TournamentEntry, error) {
	entries, err := listEntries(ctx, tx, tournamentID, entryID)
	if err != nil {
		return TournamentEntry{}, err
	}
	if len(entries) != 1 {
		return TournamentEntry{}, ErrEntryNotFound
	}
	return entries[0], nil
}

type entryQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// listEntries returns the active entries of a tournament in seed order, or
// only the entry onlyEntryID when it is set.
func listEntries(ctx context.Context, querier entryQuerier, tournamentID string, onlyEntryID string) ([]TournamentEntry, error) {
	rows, err := querier.Query(ctx, `
		WITH ordered AS (
		    SELECT te.*, row_number() OVER (ORDER BY te.seed NULLS LAST, te.registered_at, te.id)::int AS place
		    FROM tournament_entries te
		    WHERE te.tournament_id = $1::uuid AND te.status = 'registered'
		)
		SELECT o.id::text, o.place, o.registered_at,
		       u.public_id, u.name, tm.id::text, tm.name, tm.slug,
		       COALESCE((SELECT array_agg(pu.public_id ORDER BY lower(pu.name), pu.public_id)
		                 FROM tournament_entry_players p JOIN users pu ON pu.id = p.user_id
		                 WHERE p.entry_id = o.id), '{}'),
		       COALESCE((SELECT array_agg(pu.name ORDER BY lower(pu.name), pu.public_id)
		                 FROM tournament_entry_players p JOIN users pu ON pu.id = p.user_id
		                 WHERE p.entry_id = o.id), '{}')
		FROM ordered o
		LEFT JOIN users u ON u.id = o.user_id
		LEFT JOIN teams tm ON tm.id = o.team_id
		WHERE $2 = '' OR o.id::text = $2
		ORDER BY o.place
	`, tournamentID, onlyEntryID)
	if err != nil {
		return nil, fmt.Errorf("list tournament entries: %w", err)
	}
	defer rows.Close()
	entries := []TournamentEntry{}
	for rows.Next() {
		var entry TournamentEntry
		var playerID, playerName, teamID, teamName, teamSlug sql.NullString
		var rosterIDs, rosterNames []string
		if err := rows.Scan(&entry.ID, &entry.Seed, &entry.RegisteredAt, &playerID, &playerName,
			&teamID, &teamName, &teamSlug, &rosterIDs, &rosterNames); err != nil {
			return nil, fmt.Errorf("scan tournament entry: %w", err)
		}
		if playerID.Valid {
			entry.Player = &EntryPlayer{PublicID: playerID.String, Name: playerName.String}
		}
		if teamID.Valid {
			entry.Team = &TeamSummary{ID: teamID.String, Name: teamName.String, Slug: teamSlug.String}
			entry.Roster = make([]EntryPlayer, len(rosterIDs))
			for index := range rosterIDs {
				entry.Roster[index] = EntryPlayer{PublicID: rosterIDs[index], Name: rosterNames[index]}
			}
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tournament entries: %w", err)
	}
	return entries, nil
}

// ForSignedOut removes what only signed-in viewers see: a solo entrant's name
// and a team's roster.
func (e TournamentEntry) ForSignedOut() TournamentEntry {
	e.Player = nil
	e.Roster = nil
	return e
}

// countEntries counts the active entries of the tournament on the event.
func countEntries(ctx context.Context, tx pgx.Tx, eventID string) (int, error) {
	var count int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM tournament_entries te
		JOIN tournaments t ON t.id = te.tournament_id
		WHERE t.event_id = $1::uuid AND te.status = 'registered'
	`, eventID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count tournament entries: %w", err)
	}
	return count, nil
}
