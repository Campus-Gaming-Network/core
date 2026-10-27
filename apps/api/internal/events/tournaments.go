package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
	"github.com/jackc/pgx/v5"
)

// Tournament values (docs/01-product.md, Tournaments).
const (
	EntrySolo = "solo"
	EntryTeam = "team"

	// FormatSingleElimination is the only format so far.
	FormatSingleElimination = "single_elimination"

	// RegistrationOpenMode lets anyone register; RegistrationApproval makes
	// each entry a request organizers approve or decline.
	RegistrationOpenMode = "open"
	RegistrationApproval = "approval"

	TournamentDraft            = "draft"
	TournamentRegistrationOpen = "registration_open"
	TournamentInProgress       = "in_progress"
	TournamentCompleted        = "completed"
	TournamentCancelled        = "cancelled"
)

// Limits on tournament settings, matched by checks in the tournaments table.
const (
	MinimumTeamSize   = 2
	MaximumTeamSize   = 20
	MinimumEntrantCap = 2
	MaximumEntrantCap = 512
	MaximumRulesBytes = 10000
	MaximumPrizeBytes = 2000
	MaximumBracketURL = 500
)

// Errors returned by tournament operations.
var (
	ErrTournamentNotFound = apperror.New(apperror.KindNotFound, "tournament_not_found", "the event has no tournament")
	// ErrTournamentEventType reports settings for an event whose type is not
	// tournament, or an edit that changes the type while settings exist.
	ErrTournamentEventType = apperror.New(apperror.KindConflict, "tournament_event_type_required", "tournament settings need an event whose type is tournament")
	// ErrTournamentHasRSVPs reports settings added to an event that someone
	// other than its organizers has RSVP'd to, whose RSVP registration would
	// replace.
	ErrTournamentHasRSVPs = apperror.New(apperror.KindConflict, "event_has_rsvps", "tournament settings can be added only before anyone but the organizers has RSVP'd")
	// ErrTournamentGame reports a tournament game that is not one of the
	// event's games, or an edit that drops it from the event.
	ErrTournamentGame = apperror.New(apperror.KindUnprocessable, "tournament_game_not_on_event", "the tournament's game must be one of the event's games")
	// ErrTournamentStatus reports a status change the tournament's current
	// status does not allow.
	ErrTournamentStatus = apperror.New(apperror.KindConflict, "invalid_tournament_status", "the tournament cannot move to that status")
	// ErrTournamentLocked reports a change to the settings of a completed or
	// cancelled tournament, or a deletion after draft.
	ErrTournamentLocked = apperror.New(apperror.KindConflict, "tournament_locked", "the tournament can no longer be changed this way")
	// ErrTournamentRegistration reports an RSVP to an event whose tournament
	// takes registrations instead.
	ErrTournamentRegistration = apperror.New(apperror.KindConflict, "event_uses_registration", "this event takes tournament registrations instead of RSVPs")
)

// Tournament is the tournament on an event, as the event's page returns it.
type Tournament struct {
	Game      GameSummary `json:"game"`
	EntryType string      `json:"entry_type"`
	// TeamSize and Substitutes apply to team entry only: a roster has at
	// least TeamSize players and at most TeamSize plus Substitutes.
	TeamSize    *int `json:"team_size,omitempty"`
	Substitutes int  `json:"substitutes"`
	// EntrantCap counts entries, so teams in a team tournament. Nil is no
	// limit.
	EntrantCap *int `json:"entrant_cap,omitempty"`
	// RegistrationClosesAt is nil when registration closes at the event's
	// start.
	RegistrationClosesAt *time.Time `json:"registration_closes_at,omitempty"`
	Format               string     `json:"format"`
	Rules                string     `json:"rules"`
	Prizes               string     `json:"prizes"`
	// BracketURL links a bracket hosted on another site; empty is none.
	BracketURL       string `json:"bracket_url,omitempty"`
	RegistrationMode string `json:"registration_mode"`
	Status           string `json:"status"`
	// EntryCount counts the registered entries.
	EntryCount int `json:"entry_count"`
	// RequestCount counts the pending requests; only organizers see it.
	RequestCount int `json:"request_count,omitempty"`
	// ViewerEntry is the signed-in viewer's own entry, set by the event
	// page's handler.
	ViewerEntry *ViewerEntry `json:"viewer_entry,omitempty"`
}

// TournamentInput is the request to create or replace an event's tournament
// settings.
type TournamentInput struct {
	Slug                 string
	EditorUserID         string
	GameID               string
	EntryType            string
	TeamSize             *int
	Substitutes          int
	EntrantCap           *int
	RegistrationClosesAt *time.Time
	Format               string
	Rules                string
	Prizes               string
	BracketURL           string
	// RegistrationMode is open (the default when empty) or approval.
	RegistrationMode string
}

// tournamentTransitions lists the statuses each status may move to.
// Organizers move a tournament forward; it goes back from registration open
// to draft only while nobody has registered.
var tournamentTransitions = map[string][]string{
	TournamentDraft:            {TournamentRegistrationOpen, TournamentCancelled},
	TournamentRegistrationOpen: {TournamentDraft, TournamentInProgress, TournamentCancelled},
	TournamentInProgress:       {TournamentCompleted, TournamentCancelled},
}

// ValidateTournamentInput checks the settings that need no stored state.
func ValidateTournamentInput(input TournamentInput) error {
	if strings.TrimSpace(input.GameID) == "" {
		return apperror.Validation("game is required")
	}
	switch input.EntryType {
	case EntrySolo:
		if input.TeamSize != nil || input.Substitutes != 0 {
			return apperror.Validation("team size and substitutes apply to team entry only")
		}
	case EntryTeam:
		if input.TeamSize == nil || *input.TeamSize < MinimumTeamSize || *input.TeamSize > MaximumTeamSize {
			return apperror.Validation(fmt.Sprintf("team size must be from %d to %d", MinimumTeamSize, MaximumTeamSize))
		}
		if input.Substitutes < 0 || input.Substitutes > *input.TeamSize {
			return apperror.Validation("substitutes must be from 0 to the team size")
		}
	default:
		return apperror.Validation("entry type must be solo or team")
	}
	if input.EntrantCap != nil && (*input.EntrantCap < MinimumEntrantCap || *input.EntrantCap > MaximumEntrantCap) {
		return apperror.Validation(fmt.Sprintf("entrant cap must be from %d to %d", MinimumEntrantCap, MaximumEntrantCap))
	}
	if input.RegistrationMode != RegistrationOpenMode && input.RegistrationMode != RegistrationApproval {
		return apperror.Validation("registration mode must be open or approval")
	}
	if input.Format != FormatSingleElimination {
		return apperror.Validation("format must be single_elimination")
	}
	if len(input.Rules) > MaximumRulesBytes {
		return apperror.Validation("rules must be 10,000 characters or fewer")
	}
	if err := safety.ValidateCleanText("rules", input.Rules); err != nil {
		return err
	}
	if len(input.Prizes) > MaximumPrizeBytes {
		return apperror.Validation("prizes must be 2,000 characters or fewer")
	}
	if err := safety.ValidateCleanText("prizes", input.Prizes); err != nil {
		return err
	}
	if input.BracketURL != "" {
		if len(input.BracketURL) > MaximumBracketURL {
			return apperror.Validation("bracket URL must be 500 characters or fewer")
		}
		if err := validateHTTPURL(input.BracketURL); err != nil {
			return apperror.Validation("bracket URL must be a valid HTTP or HTTPS URL")
		}
	}
	return nil
}

type tournamentEvent struct {
	ID        string
	EventType string
	StartsAt  time.Time
	EndsAt    time.Time
	Status    string
}

// lockTournamentEvent locks the live event with slug and its tournament for a
// change by userID, who must be able to edit the event. Status is empty when
// the event has no tournament.
func lockTournamentEvent(ctx context.Context, tx pgx.Tx, slug string, userID string) (tournamentEvent, error) {
	var event tournamentEvent
	var organizer bool
	err := tx.QueryRow(ctx, `
		SELECT e.id::text, COALESCE(e.event_type, ''), e.starts_at, e.ends_at,
		       COALESCE(t.status, ''), `+editableBy("$2")+`
		FROM events e
		LEFT JOIN tournaments t ON t.event_id = e.id
		WHERE e.slug = $1 AND e.deleted_at IS NULL
		FOR UPDATE OF e
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(
		&event.ID, &event.EventType, &event.StartsAt, &event.EndsAt, &event.Status, &organizer)
	if errors.Is(err, pgx.ErrNoRows) {
		return tournamentEvent{}, ErrEventNotFound
	}
	if err != nil {
		return tournamentEvent{}, fmt.Errorf("lock tournament event: %w", err)
	}
	if !organizer {
		return tournamentEvent{}, ErrOrganizerRequired
	}
	return event, nil
}

// PutTournament creates or replaces the tournament settings of an event the
// user may edit, and reports whether it created them. A new tournament starts
// in draft. Settings are added only to a tournament-type event that nobody
// but its organizers has RSVP'd to, and change only until the tournament is
// completed or cancelled.
func (r *PostgresRepository) PutTournament(ctx context.Context, input TournamentInput) (Tournament, bool, error) {
	input.Rules = strings.TrimSpace(input.Rules)
	input.Prizes = strings.TrimSpace(input.Prizes)
	input.BracketURL = strings.TrimSpace(input.BracketURL)
	if input.RegistrationMode == "" {
		input.RegistrationMode = RegistrationOpenMode
	}
	if input.Format == "" {
		input.Format = FormatSingleElimination
	}
	if err := ValidateTournamentInput(input); err != nil {
		return Tournament{}, false, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Tournament{}, false, fmt.Errorf("begin tournament put: %w", err)
	}
	defer tx.Rollback(ctx)

	event, err := lockTournamentEvent(ctx, tx, input.Slug, input.EditorUserID)
	if err != nil {
		return Tournament{}, false, err
	}
	if !r.now().Before(event.EndsAt) {
		return Tournament{}, false, ErrEventEnded
	}
	if event.EventType != EventTypeTournament {
		return Tournament{}, false, ErrTournamentEventType
	}
	if event.Status == TournamentCompleted || event.Status == TournamentCancelled {
		return Tournament{}, false, ErrTournamentLocked
	}
	if input.RegistrationClosesAt != nil && input.RegistrationClosesAt.After(event.StartsAt) {
		return Tournament{}, false, apperror.Validation("registration must close by the event's start")
	}
	var onEvent bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM event_games WHERE event_id = $1::uuid AND game_id::text = $2)
	`, event.ID, strings.TrimSpace(input.GameID)).Scan(&onEvent); err != nil {
		return Tournament{}, false, fmt.Errorf("check tournament game: %w", err)
	}
	if !onEvent {
		return Tournament{}, false, ErrTournamentGame
	}

	created := event.Status == ""
	if !created {
		teamSize := 0
		if input.TeamSize != nil {
			teamSize = *input.TeamSize
		}
		var changed bool
		if err := tx.QueryRow(ctx, `
			SELECT (entry_type, COALESCE(team_size, 0), format) IS DISTINCT FROM ($2, $3::int, $4)
			FROM tournaments WHERE event_id = $1::uuid
		`, event.ID, input.EntryType, teamSize, input.Format).Scan(&changed); err != nil {
			return Tournament{}, false, fmt.Errorf("compare tournament settings: %w", err)
		}
		entries, err := countEntries(ctx, tx, event.ID)
		if err != nil {
			return Tournament{}, false, err
		}
		if changed && entries.Registered+entries.Pending > 0 {
			return Tournament{}, false, ErrTournamentHasEntries
		}
		if input.RegistrationMode == RegistrationOpenMode && entries.Pending > 0 {
			return Tournament{}, false, ErrTournamentHasRequests
		}
	}
	if created {
		// Registration replaces RSVP, so no one but an organizer may hold an
		// RSVP that the tournament would set aside.
		var others bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
			    SELECT 1 FROM event_rsvps rsvp
			    JOIN events e ON e.id = rsvp.event_id
			    WHERE rsvp.event_id = $1::uuid
			      AND rsvp.deleted_at IS NULL
			      AND NOT `+editableBy("rsvp.user_id")+`
			)
		`, event.ID).Scan(&others); err != nil {
			return Tournament{}, false, fmt.Errorf("check event rsvps: %w", err)
		}
		if others {
			return Tournament{}, false, ErrTournamentHasRSVPs
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO tournaments (event_id, game_id, entry_type, team_size, substitutes, entrant_cap,
		                         registration_closes_at, format, rules, prizes, bracket_url, registration_mode)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (event_id) DO UPDATE
		SET game_id = EXCLUDED.game_id,
		    entry_type = EXCLUDED.entry_type,
		    team_size = EXCLUDED.team_size,
		    substitutes = EXCLUDED.substitutes,
		    entrant_cap = EXCLUDED.entrant_cap,
		    registration_closes_at = EXCLUDED.registration_closes_at,
		    format = EXCLUDED.format,
		    rules = EXCLUDED.rules,
		    prizes = EXCLUDED.prizes,
		    bracket_url = EXCLUDED.bracket_url,
		    registration_mode = EXCLUDED.registration_mode
	`, event.ID, strings.TrimSpace(input.GameID), input.EntryType, nullableInt(input.TeamSize),
		input.Substitutes, nullableInt(input.EntrantCap), input.RegistrationClosesAt, input.Format,
		input.Rules, input.Prizes, input.BracketURL, input.RegistrationMode); err != nil {
		return Tournament{}, false, fmt.Errorf("put tournament: %w", err)
	}
	tournament, err := loadTournament(ctx, tx, event.ID)
	if err != nil {
		return Tournament{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Tournament{}, false, fmt.Errorf("commit tournament put: %w", err)
	}
	return *tournament, created, nil
}

// DeleteTournament removes a draft tournament's settings, leaving a plain
// tournament-type event.
func (r *PostgresRepository) DeleteTournament(ctx context.Context, slug string, userID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tournament delete: %w", err)
	}
	defer tx.Rollback(ctx)

	event, err := lockTournamentEvent(ctx, tx, slug, userID)
	if err != nil {
		return err
	}
	if event.Status == "" {
		return ErrTournamentNotFound
	}
	if event.Status != TournamentDraft {
		return ErrTournamentLocked
	}
	if _, err := tx.Exec(ctx, `DELETE FROM tournaments WHERE event_id = $1::uuid`, event.ID); err != nil {
		return fmt.Errorf("delete tournament: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tournament delete: %w", err)
	}
	return nil
}

// SetTournamentStatus moves the tournament on an event the user may edit to
// status. Moving to the current status changes nothing. Once the event has
// ended, the only move left is completing it.
func (r *PostgresRepository) SetTournamentStatus(ctx context.Context, slug string, userID string, status string) (Tournament, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Tournament{}, fmt.Errorf("begin tournament status: %w", err)
	}
	defer tx.Rollback(ctx)

	event, err := lockTournamentEvent(ctx, tx, slug, userID)
	if err != nil {
		return Tournament{}, err
	}
	if event.Status == "" {
		return Tournament{}, ErrTournamentNotFound
	}
	if status != event.Status {
		if !slices.Contains(tournamentTransitions[event.Status], status) {
			return Tournament{}, ErrTournamentStatus
		}
		if !r.now().Before(event.EndsAt) && status != TournamentCompleted {
			return Tournament{}, ErrEventEnded
		}
		entries, err := countEntries(ctx, tx, event.ID)
		if err != nil {
			return Tournament{}, err
		}
		if status == TournamentDraft && entries.Registered+entries.Pending > 0 {
			return Tournament{}, ErrTournamentHasEntries
		}
		if status == TournamentInProgress && entries.Registered < 2 {
			return Tournament{}, ErrTournamentNeedsEntrants
		}
		if (status == TournamentInProgress || status == TournamentCancelled) && entries.Pending > 0 {
			if err := declinePending(ctx, tx, event.ID, status); err != nil {
				return Tournament{}, err
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE tournaments SET status = $2 WHERE event_id = $1::uuid
		`, event.ID, status); err != nil {
			return Tournament{}, fmt.Errorf("set tournament status: %w", err)
		}
	}
	tournament, err := loadTournament(ctx, tx, event.ID)
	if err != nil {
		return Tournament{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Tournament{}, fmt.Errorf("commit tournament status: %w", err)
	}
	return *tournament, nil
}

type tournamentLoader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func loadTournament(ctx context.Context, loader tournamentLoader, eventID string) (*Tournament, error) {
	var tournament Tournament
	var teamSize, entrantCap sql.NullInt32
	err := loader.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.slug, g.is_active AND EXISTS (SELECT 1 FROM game_covers gc WHERE gc.game_id = g.id),
		       t.entry_type, t.team_size, t.substitutes, t.entrant_cap, t.registration_closes_at,
		       t.format, t.rules, t.prizes, t.bracket_url, t.registration_mode, t.status,
		       c.registered, c.pending
		FROM tournaments t
		JOIN games g ON g.id = t.game_id
		CROSS JOIN LATERAL (
		    SELECT COUNT(*) FILTER (WHERE te.status = 'registered')::int AS registered,
		           COUNT(*) FILTER (WHERE te.status = 'pending')::int AS pending
		    FROM tournament_entries te WHERE te.tournament_id = t.id) c
		WHERE t.event_id = $1::uuid
	`, eventID).Scan(
		&tournament.Game.ID, &tournament.Game.Name, &tournament.Game.Slug, &tournament.Game.HasCover,
		&tournament.EntryType, &teamSize, &tournament.Substitutes, &entrantCap, &tournament.RegistrationClosesAt,
		&tournament.Format, &tournament.Rules, &tournament.Prizes, &tournament.BracketURL, &tournament.RegistrationMode, &tournament.Status,
		&tournament.EntryCount, &tournament.RequestCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load tournament: %w", err)
	}
	if teamSize.Valid {
		value := int(teamSize.Int32)
		tournament.TeamSize = &value
	}
	if entrantCap.Valid {
		value := int(entrantCap.Int32)
		tournament.EntrantCap = &value
	}
	return &tournament, nil
}

// checkTournamentEdit refuses an event edit that would leave its tournament
// on an event of another type, or without the tournament's game.
func checkTournamentEdit(ctx context.Context, tx pgx.Tx, eventID string, eventType string, gameIDs []string) error {
	var gameID string
	err := tx.QueryRow(ctx, `
		SELECT game_id::text FROM tournaments WHERE event_id = $1::uuid
	`, eventID).Scan(&gameID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load event tournament: %w", err)
	}
	if eventType != EventTypeTournament {
		return ErrTournamentEventType
	}
	if !slices.Contains(gameIDs, gameID) {
		return ErrTournamentGame
	}
	return nil
}

// HideDraftTournament removes a draft tournament, and a tournament's request
// count, unless the viewer can edit the event. Call it after the viewer
// fields are set.
func (e *Event) HideDraftTournament() {
	if e.Tournament == nil || e.ViewerCanEdit {
		return
	}
	if e.Tournament.Status == TournamentDraft {
		e.Tournament = nil
		return
	}
	e.Tournament.RequestCount = 0
}

// declinePending declines the pending requests of the event's tournament as
// it starts or is cancelled, and tells each requester.
func declinePending(ctx context.Context, tx pgx.Tx, eventID string, status string) error {
	var tournamentID string
	var pending []string
	if err := tx.QueryRow(ctx, `
		SELECT t.id::text, COALESCE(array_agg(te.id::text) FILTER (WHERE te.id IS NOT NULL), '{}')
		FROM tournaments t
		LEFT JOIN tournament_entries te ON te.tournament_id = t.id AND te.status = 'pending'
		WHERE t.event_id = $1::uuid
		GROUP BY t.id
	`, eventID).Scan(&tournamentID, &pending); err != nil {
		return fmt.Errorf("list pending requests: %w", err)
	}
	recipients, err := entryRecipients(ctx, tx, pending...)
	if err != nil {
		return err
	}
	if err := declineEntries(ctx, tx, tournamentID, ""); err != nil {
		return err
	}
	body := "%s started before your request to join was approved."
	if status == TournamentCancelled {
		body = "%s was cancelled, so your request to join was declined."
	}
	return notifyEntrants(ctx, tx, eventID, recipients, notifications.TypeTournamentEntryDeclined,
		"Tournament request declined", body)
}
