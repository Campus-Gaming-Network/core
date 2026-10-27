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
	// ErrMatchNotFound reports a match that is not in the tournament's
	// bracket.
	ErrMatchNotFound = apperror.New(apperror.KindNotFound, "tournament_match_not_found", "the tournament has no such match")
	// ErrMatchNotReady reports a result for a match whose entrants are not
	// both decided yet.
	ErrMatchNotReady = apperror.New(apperror.KindConflict, "tournament_match_not_ready", "both entrants must be decided before the match has a result")
	// ErrResultLocked reports a correction once the match the winner moved on
	// to has a result.
	ErrResultLocked = apperror.New(apperror.KindConflict, "tournament_result_locked", "the winner's next match has a result, so this result is fixed")
	// ErrInvalidResult reports a result whose winner is not in the match, or
	// whose scores do not name that winner.
	ErrInvalidResult = apperror.New(apperror.KindUnprocessable, "invalid_match_result", "the winner must be in the match and have the higher score")
)

// MaximumMatchScore bounds a side's score.
const MaximumMatchScore = 1000000

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
	if !r.now().Before(tournament.EndsAt) {
		return nil, ErrEventEnded
	}
	if locked, err := bracketHasResult(ctx, tx, tournament.ID); err != nil {
		return nil, err
	} else if locked {
		return nil, ErrBracketLocked
	}
	lowered := make([]string, len(entryIDs))
	for index, id := range entryIDs {
		lowered[index] = strings.ToLower(id)
	}
	ordered := normalizeIDs(lowered)
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
	if !r.now().Before(tournament.EndsAt) {
		return nil, ErrEventEnded
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
	if errors.Is(err, errTooFewEntrants) {
		return nil, ErrTournamentNeedsEntrants
	}
	if err != nil {
		return nil, fmt.Errorf("plan bracket: %w", err)
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
		var seeds [2]*int
		for slot, seed := range match.Seeds {
			if seed > 0 {
				entrants[slot], seeds[slot] = &entries[seed-1].ID, &match.Seeds[slot]
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
			INSERT INTO tournament_matches (tournament_id, round, position, entry1_id, entry2_id, seed1, seed2, next_match_id, next_slot)
			VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, $8::uuid, $9)
			RETURNING id::text
		`, tournament.ID, match.Round, match.Position, entrants[0], entrants[1], seeds[0], seeds[1], next, nextSlot).Scan(&id); err != nil {
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
	// One snapshot, so a bracket regenerated mid-read is not half seen.
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("begin match read: %w", err)
	}
	defer tx.Rollback(ctx)
	return listMatches(ctx, tx, tournamentID)
}

func bracketHasResult(ctx context.Context, tx pgx.Tx, tournamentID string) (bool, error) {
	var locked bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1 FROM tournament_matches
		    WHERE tournament_id = $1::uuid
		      AND (status <> 'upcoming' OR winner_entry_id IS NOT NULL OR score1 IS NOT NULL OR score2 IS NOT NULL))
	`, tournamentID).Scan(&locked); err != nil {
		return false, fmt.Errorf("check bracket results: %w", err)
	}
	return locked, nil
}

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
		SELECT id::text, round, position, entry1_id::text, entry2_id::text, seed1, seed2, status, scheduled_at,
		       score1, score2, winner_entry_id::text, walkover, next_match_id::text
		FROM tournament_matches
		WHERE tournament_id = $1::uuid
		ORDER BY CASE bracket WHEN 'upper' THEN 1 WHEN 'lower' THEN 2 ELSE 3 END, round, position
	`, tournamentID)
	if err != nil {
		return nil, fmt.Errorf("list matches: %w", err)
	}
	defer rows.Close()
	matches := []TournamentMatch{}
	for rows.Next() {
		var match TournamentMatch
		var entry1, entry2, winner, next sql.NullString
		var seed1, seed2, score1, score2 sql.NullInt32
		if err := rows.Scan(&match.ID, &match.Round, &match.Position, &entry1, &entry2, &seed1, &seed2, &match.Status,
			&match.ScheduledAt, &score1, &score2, &winner, &match.Walkover, &next); err != nil {
			return nil, fmt.Errorf("scan match: %w", err)
		}
		seeds := []sql.NullInt32{seed1, seed2}
		for slot, id := range []sql.NullString{entry1, entry2} {
			if entry, ok := byID[id.String]; id.Valid && ok {
				match.Entrants[slot] = &MatchEntrant{EntryID: entry.ID, Seed: int(seeds[slot].Int32), Player: entry.Player, Team: entry.Team}
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

// ResultInput is an organizer's result for one match: each side's score and
// the winner, or a walkover, which advances WinnerEntryID without a score.
type ResultInput struct {
	Slug          string
	UserID        string
	MatchID       string
	WinnerEntryID string
	// Scores holds the two sides' scores in slot order; a walkover has none.
	Scores   []int
	Walkover bool
}

// ValidateResultInput checks a result's shape before any stored state: a
// walkover has no scores, and anything else has two whole-number scores that
// are not a draw.
func ValidateResultInput(input ResultInput) error {
	if strings.TrimSpace(input.WinnerEntryID) == "" {
		return apperror.Validation("winner is required")
	}
	if input.Walkover {
		if input.Scores != nil {
			return apperror.Validation("a walkover has no scores")
		}
		return nil
	}
	if len(input.Scores) != 2 {
		return apperror.Validation("a result needs both sides' scores")
	}
	for _, score := range input.Scores {
		if score < 0 || score > MaximumMatchScore {
			return apperror.Validation(fmt.Sprintf("scores must be from 0 to %d", MaximumMatchScore))
		}
	}
	if input.Scores[0] == input.Scores[1] {
		return apperror.Validation("an elimination match has no draw")
	}
	return nil
}

// RecordResult enters or corrects the result of a match in the tournament on
// the event with slug, for an organizer while the tournament is in progress,
// and returns the bracket. The winner moves to their next match at once; a
// correction that changes the winner moves the new one there instead, and is
// refused once that match has a result. The final's result completes the
// tournament, and the final can still be corrected after that. Every result
// and correction is written to the event's activity log.
func (r *PostgresRepository) RecordResult(ctx context.Context, input ResultInput) ([]TournamentMatch, error) {
	if err := ValidateResultInput(input); err != nil {
		return nil, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin match result: %w", err)
	}
	defer tx.Rollback(ctx)

	tournament, err := lockEntryTournament(ctx, tx, input.Slug, input.UserID)
	if err != nil {
		return nil, err
	}
	if !tournament.Organizer {
		return nil, ErrOrganizerRequired
	}

	var match struct {
		Round, Position int
		Entries         [2]sql.NullString
		Seeds           [2]sql.NullInt32
		Scores          [2]sql.NullInt32
		Winner, Next    sql.NullString
		NextSlot        sql.NullInt16
		Walkover        bool
		NextHasResult   bool
	}
	err = tx.QueryRow(ctx, `
		SELECT m.round, m.position, m.entry1_id::text, m.entry2_id::text, m.seed1, m.seed2, m.score1, m.score2,
		       m.winner_entry_id::text, m.walkover, m.next_match_id::text, m.next_slot,
		       COALESCE(n.winner_entry_id IS NOT NULL, FALSE)
		FROM tournament_matches m
		LEFT JOIN tournament_matches n ON n.id = m.next_match_id
		WHERE m.id::text = $1 AND m.tournament_id = $2::uuid
		FOR UPDATE OF m
	`, strings.ToLower(strings.TrimSpace(input.MatchID)), tournament.ID).Scan(
		&match.Round, &match.Position, &match.Entries[0], &match.Entries[1], &match.Seeds[0], &match.Seeds[1],
		&match.Scores[0], &match.Scores[1], &match.Winner, &match.Walkover, &match.Next, &match.NextSlot, &match.NextHasResult)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMatchNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock match: %w", err)
	}
	final := !match.Next.Valid
	corrected := match.Winner.Valid
	if corrected && match.NextHasResult {
		return nil, ErrResultLocked
	}
	switch {
	case tournament.Status == TournamentInProgress:
	case tournament.Status == TournamentCompleted && final && match.Winner.Valid:
	default:
		return nil, ErrTournamentLocked
	}
	if !match.Entries[0].Valid || !match.Entries[1].Valid {
		return nil, ErrMatchNotReady
	}
	winnerSlot := slices.IndexFunc(match.Entries[:], func(entry sql.NullString) bool {
		return entry.String == strings.ToLower(strings.TrimSpace(input.WinnerEntryID))
	})
	if winnerSlot < 0 || (!input.Walkover && input.Scores[winnerSlot] < input.Scores[1-winnerSlot]) {
		return nil, ErrInvalidResult
	}

	before := map[string]any{}
	if corrected {
		before = matchResultState(match.Round, match.Position, match.Seeds, match.Entries, match.Winner.String,
			match.Walkover, match.Scores)
	}
	var scores [2]sql.NullInt32
	if !input.Walkover {
		for slot, score := range input.Scores {
			scores[slot] = sql.NullInt32{Int32: int32(score), Valid: true}
		}
	}
	winnerID := match.Entries[winnerSlot].String
	if _, err := tx.Exec(ctx, `
		UPDATE tournament_matches
		SET score1 = $2, score2 = $3, winner_entry_id = $4::uuid, walkover = $5, status = 'complete'
		WHERE id::text = $1
	`, strings.ToLower(strings.TrimSpace(input.MatchID)), scores[0], scores[1], winnerID, input.Walkover); err != nil {
		return nil, fmt.Errorf("record match result: %w", err)
	}
	if final {
		if _, err := tx.Exec(ctx, `
			UPDATE tournaments SET status = 'completed' WHERE id = $1::uuid
		`, tournament.ID); err != nil {
			return nil, fmt.Errorf("complete tournament: %w", err)
		}
	} else {
		// The slot is the winner's whatever it held, so a correction replaces
		// the old winner.
		if _, err := tx.Exec(ctx, `
			UPDATE tournament_matches
			SET entry1_id = CASE WHEN $2 = 1 THEN $3::uuid ELSE entry1_id END,
			    seed1 = CASE WHEN $2 = 1 THEN $4 ELSE seed1 END,
			    entry2_id = CASE WHEN $2 = 2 THEN $3::uuid ELSE entry2_id END,
			    seed2 = CASE WHEN $2 = 2 THEN $4 ELSE seed2 END
			WHERE id::text = $1
		`, match.Next.String, match.NextSlot.Int16, winnerID, match.Seeds[winnerSlot]); err != nil {
			return nil, fmt.Errorf("advance winner: %w", err)
		}
	}
	action := ActionMatchResult
	if corrected {
		action = ActionMatchResultCorrected
	}
	after := matchResultState(match.Round, match.Position, match.Seeds, match.Entries, winnerID, input.Walkover, scores)
	if err := writeActivity(ctx, tx, tournament.EventID, input.UserID, action, before, after, nil); err != nil {
		return nil, err
	}
	matches, err := listMatches(ctx, tx, tournament.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit match result: %w", err)
	}
	return matches, nil
}

// matchResultState is a result as the activity log records it: the match's
// place, the winner by seed, and the scores in slot order unless it was a
// walkover. Seeds rather than entry IDs keep names out of the log, as the
// bracket shows solo entrants to signed-out viewers.
func matchResultState(round, position int, seeds [2]sql.NullInt32, entries [2]sql.NullString, winnerID string, walkover bool, scores [2]sql.NullInt32) map[string]any {
	state := map[string]any{"round": round, "position": position, "walkover": walkover}
	for slot, entry := range entries {
		if entry.String == winnerID {
			state["winner_seed"] = seeds[slot].Int32
		}
	}
	if scores[0].Valid && scores[1].Valid {
		state["scores"] = []int32{scores[0].Int32, scores[1].Int32}
	}
	return state
}
