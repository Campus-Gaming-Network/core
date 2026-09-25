package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (r *PostgresRepository) createWithSlug(ctx context.Context, params CreateParams, slug string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin event create: %w", err)
	}
	defer tx.Rollback(ctx)

	var eventID string
	err = tx.QueryRow(ctx, `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, description, visibility,
			format, starts_at, ends_at, timezone, location_name, address, online_url,
			private_password_hash, capacity, is_paid, payment_note, payment_url,
			recurrence_rule, recurrence_until
		)
		SELECT $1::uuid, s.id, $3, $4, $5, $6, $7, $8, $9, $10,
		       NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
		       NULLIF($14, ''), $15, $16, NULLIF($17, ''), NULLIF($18, ''),
		       NULLIF($19, ''), $20
		FROM schools s
		WHERE s.id = $2::uuid
		  AND s.deleted_at IS NULL
		  AND s.is_active = TRUE
		ON CONFLICT (slug) DO NOTHING
		RETURNING id::text
	`, params.CreatorUserID, params.HostSchoolID, params.Title, slug, params.Description,
		params.Visibility, params.Format, params.StartsAt, params.EndsAt, params.Timezone,
		params.LocationName, params.Address, params.OnlineURL, params.PrivatePasswordHash,
		nullableInt(params.Capacity), params.IsPaid, params.PaymentNote, params.PaymentURL,
		params.RecurrenceRule, nullableTime(params.RecurrenceUntil)).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", r.createNoRowsError(ctx, tx, params.HostSchoolID)
	}
	if err != nil {
		return "", fmt.Errorf("insert event: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO event_organizers (event_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'creator')
	`, eventID, params.CreatorUserID); err != nil {
		return "", fmt.Errorf("insert event organizer: %w", err)
	}

	insertedGameCount, err := insertEventGames(ctx, tx, eventID, params.GameIDs)
	if err != nil {
		return "", err
	}
	if insertedGameCount != len(params.GameIDs) {
		return "", ErrGameNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit event create: %w", err)
	}
	return slug, nil
}

func (r *PostgresRepository) createSeriesWithSlug(ctx context.Context, params CreateParams, slug string) (string, error) {
	schedule, err := newRecurrenceSchedule(
		params.RecurrenceRule,
		params.StartsAt,
		params.EndsAt,
		params.Timezone,
	)
	if err != nil {
		return "", err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin recurring event create: %w", err)
	}
	defer tx.Rollback(ctx)

	rootID, err := insertRecurringOccurrence(ctx, tx, params, slug, params.StartsAt, params.EndsAt, "")
	if errors.Is(err, pgx.ErrNoRows) {
		return "", r.createNoRowsError(ctx, tx, params.HostSchoolID)
	}
	if err != nil {
		return "", err
	}
	if err := insertEventAssociations(ctx, tx, rootID, params); err != nil {
		return "", err
	}

	occurrence := 2
	for {
		start, end, err := schedule.occurrence(occurrence - 1)
		if err != nil {
			return "", fmt.Errorf("generate recurring event occurrence: %w", err)
		}
		if start.After(params.RecurrenceUntil) {
			break
		}
		childSlug := fmt.Sprintf("%s-%d", GenerateSlug(params.Title, params.CreatorUserID, start), occurrence)
		childID, err := insertRecurringOccurrence(ctx, tx, params, childSlug, start, end, rootID)
		if err != nil {
			return "", err
		}
		if err := insertEventAssociations(ctx, tx, childID, params); err != nil {
			return "", err
		}
		occurrence++
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit recurring event create: %w", err)
	}
	return slug, nil
}

func insertRecurringOccurrence(ctx context.Context, tx pgx.Tx, params CreateParams, slug string, startsAt time.Time, endsAt time.Time, parentID string) (string, error) {
	var eventID string
	err := tx.QueryRow(ctx, `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, description, visibility,
			format, starts_at, ends_at, timezone, location_name, address, online_url,
			private_password_hash, capacity, is_paid, payment_note, payment_url,
			recurrence_rule, recurrence_until, recurrence_parent_id
		)
		SELECT $1::uuid, s.id, $3, $4, $5, $6, $7, $8, $9, $10,
		       NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
		       NULLIF($14, ''), $15, $16, NULLIF($17, ''), NULLIF($18, ''),
		       NULLIF($19, ''), $20, NULLIF($21, '')::uuid
		FROM schools s
		WHERE s.id = $2::uuid
		  AND s.deleted_at IS NULL
		  AND s.is_active = TRUE
		ON CONFLICT (slug) DO NOTHING
		RETURNING id::text
	`, params.CreatorUserID, params.HostSchoolID, params.Title, slug, params.Description,
		params.Visibility, params.Format, startsAt, endsAt, params.Timezone,
		params.LocationName, params.Address, params.OnlineURL, params.PrivatePasswordHash,
		nullableInt(params.Capacity), params.IsPaid, params.PaymentNote, params.PaymentURL,
		params.RecurrenceRule, nullableTime(params.RecurrenceUntil), parentID).Scan(&eventID)
	if err != nil {
		return "", fmt.Errorf("insert recurring event occurrence: %w", err)
	}
	return eventID, nil
}

func insertEventAssociations(ctx context.Context, tx pgx.Tx, eventID string, params CreateParams) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO event_organizers (event_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'creator')
	`, eventID, params.CreatorUserID); err != nil {
		return fmt.Errorf("insert event organizer: %w", err)
	}
	insertedGameCount, err := insertEventGames(ctx, tx, eventID, params.GameIDs)
	if err != nil {
		return err
	}
	if insertedGameCount != len(params.GameIDs) {
		return ErrGameNotFound
	}
	return nil
}

type schoolExistenceChecker interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type editableEventLocker interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func lockEditableEvent(ctx context.Context, locker editableEventLocker, slug string, userID string) (string, sql.NullString, error) {
	var eventID string
	var currentPrivatePasswordHash sql.NullString
	var organizer bool
	err := locker.QueryRow(ctx, `
		SELECT e.id::text,
		       e.private_password_hash,
		       EXISTS (
		           SELECT 1
		           FROM event_organizers eo
		           WHERE eo.event_id = e.id
		             AND eo.user_id = $2::uuid
		             AND eo.deleted_at IS NULL
		       ) AS organizer
		FROM events e
		WHERE e.slug = $1
		  AND e.deleted_at IS NULL
		FOR UPDATE OF e
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&eventID, &currentPrivatePasswordHash, &organizer)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", sql.NullString{}, ErrEventNotFound
	}
	if err != nil {
		return "", sql.NullString{}, fmt.Errorf("lock editable event: %w", err)
	}
	if !organizer {
		return "", sql.NullString{}, ErrOrganizerRequired
	}
	return eventID, currentPrivatePasswordHash, nil
}

func (r *PostgresRepository) createNoRowsError(ctx context.Context, checker schoolExistenceChecker, hostSchoolID string) error {
	var schoolExists bool
	if err := checker.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM schools
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
			  AND is_active = TRUE
		)
	`, hostSchoolID).Scan(&schoolExists); err != nil {
		return fmt.Errorf("check host school: %w", err)
	}
	if !schoolExists {
		return ErrHostSchoolNotFound
	}
	return ErrSlugUnavailable
}

func (r *PostgresRepository) eventIDBySlug(ctx context.Context, slug string) (string, error) {
	var eventID string
	err := r.pool.QueryRow(ctx, `
		SELECT id::text
		FROM events
		WHERE slug = $1
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug)).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrEventNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get event id by slug: %w", err)
	}
	return eventID, nil
}

func insertEventGames(ctx context.Context, tx eventGameInserter, eventID string, gameIDs []string) (int, error) {
	rows, err := tx.Query(ctx, `
		INSERT INTO event_games (event_id, game_id)
		SELECT $1::uuid, g.id
		FROM games g
		WHERE g.id::text = ANY($2)
		  AND g.deleted_at IS NULL AND g.is_active = TRUE
		ON CONFLICT (event_id, game_id) DO NOTHING
		RETURNING game_id::text
	`, eventID, gameIDs)
	if err != nil {
		return 0, fmt.Errorf("insert event games: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var gameID string
		if err := rows.Scan(&gameID); err != nil {
			return 0, fmt.Errorf("scan inserted event game: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate inserted event games: %w", err)
	}
	return count, nil
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}
