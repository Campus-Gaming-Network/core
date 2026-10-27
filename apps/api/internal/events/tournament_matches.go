package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
)

// Match status values.
const (
	MatchUpcoming = "upcoming"
	MatchLive     = "live"
	MatchComplete = "complete"
)

// Errors returned by seeding and bracket generation.
var (
	// ErrSeedOrder reports a seed order that is not every registered entry
	// exactly once.
	ErrSeedOrder = apperror.New(apperror.KindUnprocessable, "invalid_seed_order", "the seed order must list every registered entry once")
	// ErrTournamentNotStarted reports generating a bracket before the
	// tournament is in progress.
	ErrTournamentNotStarted = apperror.New(apperror.KindConflict, "tournament_not_started", "start the tournament before generating its bracket")
	// ErrBracketLocked reports a change to seeds or the bracket once a match
	// has a result.
	ErrBracketLocked = apperror.New(apperror.KindConflict, "tournament_bracket_locked", "the bracket has a result, so seeds and the bracket are fixed")
)

// TournamentMatch is one match of a tournament's bracket as its page shows
// it. An entrant slot is nil until an earlier match decides it.
type TournamentMatch struct {
	ID          string           `json:"id"`
	Round       int              `json:"round"`
	Position    int              `json:"position"`
	Entrants    [2]*MatchEntrant `json:"entrants"`
	Status      string           `json:"status"`
	ScheduledAt *time.Time       `json:"scheduled_at,omitempty"`
	// Scores holds both sides' scores once a result has them.
	Scores        []int  `json:"scores,omitempty"`
	WinnerEntryID string `json:"winner_entry_id,omitempty"`
	Walkover      bool   `json:"walkover,omitempty"`
	// NextMatchID is where the winner goes; the final has none.
	NextMatchID string `json:"next_match_id,omitempty"`
}

// MatchEntrant is an entry in a match slot. A signed-out viewer receives a
// solo entrant without Player.
type MatchEntrant struct {
	EntryID string       `json:"entry_id"`
	Seed    int          `json:"seed"`
	Player  *EntryPlayer `json:"player,omitempty"`
	Team    *TeamSummary `json:"team,omitempty"`
}

// ForSignedOut removes the solo entrants' names, as the entrant list does.
func (m TournamentMatch) ForSignedOut() TournamentMatch {
	for index, entrant := range m.Entrants {
		if entrant != nil {
			hidden := *entrant
			hidden.Player = nil
			m.Entrants[index] = &hidden
		}
	}
	return m
}

// SetSeeds orders the registered entries of the tournament on the event
// with slug for an organizer, from seed 1. Seeds change until a match has a
// result; a bracket generated before the change keeps its old order until it
// is generated again.
func (r *PostgresRepository) SetSeeds(ctx context.Context, slug string, userID string, entryIDs []string) ([]TournamentEntry, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin seeding: %w", err)
	}
	defer tx.Rollback(ctx)

	tournament, err := lockEntryTournament(ctx, tx, slug, userID)
	if err != nil {
		return nil, err
	}
	if !tournament.Organizer {
		return nil, ErrOrganizerRequired
	}
	if tournament.Status != TournamentRegistrationOpen && tournament.Status != TournamentInProgress {
		return nil, ErrTournamentLocked
	}
	if locked, err := bracketHasResult(ctx, tx, tournament.ID); err != nil {
		return nil, err
	} else if locked {
		return nil, ErrBracketLocked
	}
	ordered := normalizeIDs(entryIDs)
	if len(ordered) != len(entryIDs) || len(ordered) != tournament.EntryCount {
		return nil, ErrSeedOrder
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tournament_entries te SET seed = o.place
		FROM unnest($2::text[]) WITH ORDINALITY AS o (id, place)
		WHERE te.id::text = o.id AND te.tournament_id = $1::uuid AND te.status = 'registered'
	`, tournament.ID, ordered)
	if err != nil {
		return nil, fmt.Errorf("set seeds: %w", err)
	}
	if int(tag.RowsAffected()) != len(ordered) {
		return nil, ErrSeedOrder
	}
	entries, err := listEntries(ctx, tx, tournament.ID, "", EntryRegistered)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit seeding: %w", err)
	}
	return entries, nil
}

// GenerateBracket builds, or rebuilds, the single-elimination bracket of the
// tournament on the event with slug from its registered entries in seed
// order, for an organizer once the tournament is in progress and until a
// match has a result.
func (r *PostgresRepository) GenerateBracket(ctx context.Context, slug string, userID string) ([]TournamentMatch, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin bracket generation: %w", err)
	}
	defer tx.Rollback(ctx)

	tournament, err := lockEntryTournament(ctx, tx, slug, userID)
	if err != nil {
		return nil, err
	}
	if !tournament.Organizer {
		return nil, ErrOrganizerRequired
	}
	if tournament.Status != TournamentInProgress {
		return nil, ErrTournamentNotStarted
	}
	if locked, err := bracketHasResult(ctx, tx, tournament.ID); err != nil {
		return nil, err
	} else if locked {
		return nil, ErrBracketLocked
	}
	entries, err := listEntries(ctx, tx, tournament.ID, "", EntryRegistered)
	if err != nil {
		return nil, err
	}
	plan, err := PlanSingleElimination(len(entries))
	if err != nil {
		return nil, ErrTournamentNeedsEntrants
	}
	if _, err := tx.Exec(ctx, `DELETE FROM tournament_matches WHERE tournament_id = $1::uuid`, tournament.ID); err != nil {
		return nil, fmt.Errorf("clear bracket: %w", err)
	}

	// Later rounds go in first, so each match can name the one its winner
	// moves to.
	ids := map[[2]int]string{}
	for index := len(plan) - 1; index >= 0; index-- {
		match := plan[index]
		var entrants [2]*string
		for slot, seed := range match.Seeds {
			if seed > 0 {
				entrants[slot] = &entries[seed-1].ID
			}
		}
		var next *string
		var nextSlot *int
		if match.NextPosition > 0 {
			id := ids[[2]int{match.Round + 1, match.NextPosition}]
			next, nextSlot = &id, &match.NextSlot
		}
		var id string
		if err := tx.QueryRow(ctx, `
			INSERT INTO tournament_matches (tournament_id, round, position, entry1_id, entry2_id, next_match_id, next_slot)
			VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7)
			RETURNING id::text
		`, tournament.ID, match.Round, match.Position, entrants[0], entrants[1], next, nextSlot).Scan(&id); err != nil {
			return nil, fmt.Errorf("insert match: %w", err)
		}
		ids[[2]int{match.Round, match.Position}] = id
	}
	matches, err := listMatches(ctx, tx, tournament.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit bracket generation: %w", err)
	}
	return matches, nil
}

// ListMatches returns the bracket of the tournament on the event with slug
// by round and position; it is empty until organizers generate it. A draft
// is not found for anyone but the organizers.
func (r *PostgresRepository) ListMatches(ctx context.Context, slug string, userID string) ([]TournamentMatch, error) {
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
	return listMatches(ctx, r.pool, tournamentID)
}

// bracketHasResult reports whether any match of the tournament has a result.
func bracketHasResult(ctx context.Context, tx pgx.Tx, tournamentID string) (bool, error) {
	var locked bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1 FROM tournament_matches
		    WHERE tournament_id = $1::uuid AND (winner_entry_id IS NOT NULL OR status = 'complete'))
	`, tournamentID).Scan(&locked); err != nil {
		return false, fmt.Errorf("check bracket results: %w", err)
	}
	return locked, nil
}

// listMatches returns a tournament's matches by bracket, round, and position,
// with each slot's entrant.
func listMatches(ctx context.Context, querier entryQuerier, tournamentID string) ([]TournamentMatch, error) {
	entries, err := listEntries(ctx, querier, tournamentID, "", EntryRegistered)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]TournamentEntry, len(entries))
	for _, entry := range entries {
		byID[entry.ID] = entry
	}
	rows, err := querier.Query(ctx, `
		SELECT id::text, round, position, entry1_id::text, entry2_id::text, status, scheduled_at,
		       score1, score2, winner_entry_id::text, walkover, next_match_id::text
		FROM tournament_matches
		WHERE tournament_id = $1::uuid
		ORDER BY bracket, round, position
	`, tournamentID)
	if err != nil {
		return nil, fmt.Errorf("list matches: %w", err)
	}
	defer rows.Close()
	matches := []TournamentMatch{}
	for rows.Next() {
		var match TournamentMatch
		var entry1, entry2, winner, next sql.NullString
		var score1, score2 sql.NullInt32
		if err := rows.Scan(&match.ID, &match.Round, &match.Position, &entry1, &entry2, &match.Status,
			&match.ScheduledAt, &score1, &score2, &winner, &match.Walkover, &next); err != nil {
			return nil, fmt.Errorf("scan match: %w", err)
		}
		for slot, id := range []sql.NullString{entry1, entry2} {
			if entry, ok := byID[id.String]; id.Valid && ok {
				match.Entrants[slot] = &MatchEntrant{EntryID: entry.ID, Seed: entry.Seed, Player: entry.Player, Team: entry.Team}
			}
		}
		if score1.Valid && score2.Valid {
			match.Scores = []int{int(score1.Int32), int(score2.Int32)}
		}
		match.WinnerEntryID, match.NextMatchID = winner.String, next.String
		matches = append(matches, match)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate matches: %w", err)
	}
	return matches, nil
}
