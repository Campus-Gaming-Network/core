package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
)

func (r *PostgresRepository) IsOrganizer(ctx context.Context, slug string, userID string) (bool, error) {
	var organizer bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM events e
			JOIN event_organizers eo ON eo.event_id = e.id
			WHERE e.slug = $1
			  AND e.deleted_at IS NULL
			  AND eo.user_id = $2::uuid
			  AND eo.deleted_at IS NULL
		)
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&organizer)
	return organizer, err
}

func (r *PostgresRepository) PrivatePasswordHash(ctx context.Context, slug string) (string, error) {
	var hash sql.NullString
	err := r.pool.QueryRow(ctx, `
		SELECT private_password_hash
		FROM events
		WHERE slug = $1
		  AND visibility = 'private'
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug)).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrEventNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get private event password hash: %w", err)
	}
	if !hash.Valid || strings.TrimSpace(hash.String) == "" {
		return "", ErrEventNotFound
	}
	return hash.String, nil
}

func (r *PostgresRepository) IsPrivateUnlockValid(ctx context.Context, slug string, tokenHash []byte) (bool, error) {
	if len(tokenHash) == 0 {
		return false, nil
	}

	var unlocked bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM events e
			JOIN event_private_unlocks unlocks ON unlocks.event_id = e.id
			WHERE e.slug = $1
			  AND e.visibility = 'private'
			  AND e.deleted_at IS NULL
			  AND unlocks.token_hash = $2
			  AND unlocks.expires_at > $3
			  AND unlocks.deleted_at IS NULL
		)
	`, strings.TrimSpace(slug), tokenHash, r.now()).Scan(&unlocked)
	return unlocked, err
}

func (r *PostgresRepository) GetRSVP(ctx context.Context, slug string, userID string) (string, error) {
	var response string
	err := r.pool.QueryRow(ctx, `
		SELECT r.response
		FROM events e
		JOIN event_rsvps r ON r.event_id = e.id
		WHERE e.slug = $1
		  AND e.deleted_at IS NULL
		  AND r.user_id = $2::uuid
		  AND r.deleted_at IS NULL
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&response)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return response, err
}

func (r *PostgresRepository) IsInterested(ctx context.Context, slug string, userID string) (bool, error) {
	var interested bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM events e
			JOIN event_interests i ON i.event_id = e.id
			WHERE e.slug = $1
			  AND e.deleted_at IS NULL
			  AND i.user_id = $2::uuid
			  AND i.deleted_at IS NULL
		)
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&interested)
	return interested, err
}

func (r *PostgresRepository) ListUpcomingRSVPs(ctx context.Context, userID string, limit int) ([]Event, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, apperror.Validation("user is required")
	}
	if limit < 1 || limit > 25 {
		limit = 5
	}

	rows, err := r.pool.Query(ctx, eventSelectForUserSQL(`
		e.deleted_at IS NULL
		AND e.ends_at > $2
		AND viewer_rsvp.response IN ('yes', 'maybe')
	`, `
		ORDER BY e.starts_at, e.id
		LIMIT $3
	`), userID, r.now(), limit)
	if err != nil {
		return nil, fmt.Errorf("list upcoming event rsvps: %w", err)
	}
	defer rows.Close()

	events := make([]Event, 0, limit)
	for rows.Next() {
		event, err := scanEventForUser(rows, r.now())
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate upcoming event rsvps: %w", err)
	}
	return events, nil
}

func (r *PostgresRepository) ListFollowedSchoolEvents(ctx context.Context, userID string, limit int) ([]Event, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, apperror.Validation("user is required")
	}
	if limit < 1 || limit > 25 {
		limit = 5
	}

	rows, err := r.pool.Query(ctx, eventSelectForUserSQL(`
		e.deleted_at IS NULL
		AND e.visibility = 'public'
		AND e.ends_at > $2
		AND EXISTS (
			SELECT 1
			FROM user_school_follows f
			WHERE f.school_id = e.host_school_id
			  AND f.user_id = $1::uuid
			  AND f.deleted_at IS NULL
		)
	`, `
		ORDER BY e.starts_at, e.id
		LIMIT $3
	`), userID, r.now(), limit)
	if err != nil {
		return nil, fmt.Errorf("list followed school events: %w", err)
	}
	defer rows.Close()

	events := make([]Event, 0, limit)
	for rows.Next() {
		event, err := scanEventForUser(rows, r.now())
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate followed school events: %w", err)
	}
	return events, nil
}

func (r *PostgresRepository) ListPublic(ctx context.Context, params ListParams) ([]Event, error) {
	params = NormalizeListParams(params)
	if params.After != nil && params.Before != nil {
		return nil, pagecursor.ErrInvalid
	}

	whereClause := `
		e.deleted_at IS NULL
		AND e.visibility = 'public'
		AND ($1 = '' OR EXISTS (
			SELECT 1
			FROM event_games filter_eg
			JOIN games filter_g ON filter_g.id = filter_eg.game_id
			WHERE filter_eg.event_id = e.id
			  AND filter_g.slug = $1
			  AND filter_g.deleted_at IS NULL
		))
		AND ($2 = '' OR s.slug = $2)
		AND ($3 = '' OR e.format = $3)
	`
	arguments := []any{params.GameSlug, params.SchoolSlug, params.Format}
	// Newest start times first; a previous page reads forward and is reversed.
	order := "ORDER BY e.starts_at DESC, e.id DESC"
	if params.After != nil {
		whereClause += fmt.Sprintf(" AND (e.starts_at, e.id) < ($%d, $%d::uuid)", len(arguments)+1, len(arguments)+2)
		arguments = append(arguments, params.After.Timestamp, params.After.ID)
	}
	if params.Before != nil {
		whereClause += fmt.Sprintf(" AND (e.starts_at, e.id) > ($%d, $%d::uuid)", len(arguments)+1, len(arguments)+2)
		arguments = append(arguments, params.Before.Timestamp, params.Before.ID)
		order = "ORDER BY e.starts_at, e.id"
	}
	arguments = append(arguments, params.Limit)
	tailClause := fmt.Sprintf(" %s LIMIT $%d", order, len(arguments))

	rows, err := r.pool.Query(ctx, eventSelectSQL(whereClause, tailClause), arguments...)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()

	result := make([]Event, 0, params.Limit)
	for rows.Next() {
		event, err := scanEvent(rows, r.now())
		if err != nil {
			return nil, err
		}
		result = append(result, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}
	if params.Before != nil {
		reverseEvents(result)
	}
	return result, nil
}

func reverseEvents(events []Event) {
	for left, right := 0, len(events)-1; left < right; left, right = left+1, right-1 {
		events[left], events[right] = events[right], events[left]
	}
}

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Event, error) {
	row := r.pool.QueryRow(ctx, eventSelectSQL(`
		e.deleted_at IS NULL
		AND e.slug = $1
	`, ``), strings.TrimSpace(slug))
	event, err := scanEvent(row, r.now())
	if err != nil {
		return Event{}, err
	}
	if err := r.populateOrganizers(ctx, &event); err != nil {
		return Event{}, err
	}
	return event, nil
}

func (r *PostgresRepository) populateOrganizers(ctx context.Context, event *Event) error {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id::text,
		       u.name,
		       eo.role,
		       u.verification_level,
		       ARRAY_REMOVE(ARRAY[
		           CASE WHEN u.verification_level = 'staff_faculty' THEN 'staff_faculty'::text END,
		           CASE WHEN sa.user_id IS NOT NULL THEN 'school_admin'::text END
		       ], NULL::text)
		FROM event_organizers eo
		JOIN users u ON u.id = eo.user_id
		LEFT JOIN school_admins sa
		       ON sa.user_id = u.id
		      AND sa.school_id = $2::uuid
		      AND sa.deleted_at IS NULL
		WHERE eo.event_id = $1::uuid
		  AND eo.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
		ORDER BY CASE eo.role WHEN 'creator' THEN 0 ELSE 1 END, eo.created_at, u.id
	`, event.ID, event.HostSchool.ID)
	if err != nil {
		return fmt.Errorf("list event organizers: %w", err)
	}
	defer rows.Close()

	organizers := make([]Organizer, 0)
	for rows.Next() {
		var organizer Organizer
		if err := rows.Scan(&organizer.ID, &organizer.Name, &organizer.Role, &organizer.VerificationLevel, &organizer.RoleIndicators); err != nil {
			return fmt.Errorf("scan event organizer: %w", err)
		}
		organizers = append(organizers, organizer)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate event organizers: %w", err)
	}
	event.Organizers = organizers
	return nil
}
