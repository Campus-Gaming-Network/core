package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/jackc/pgx/v5"
)

func (r *PostgresRepository) Create(ctx context.Context, params CreateParams) (Event, error) {
	if err := ValidateCreateInput(params.CreateInput); err != nil {
		return Event{}, err
	}
	if params.Visibility == VisibilityPrivate && strings.TrimSpace(params.PrivatePasswordHash) == "" {
		return Event{}, apperror.Validation("private password hash is required")
	}

	params = normalizeCreateParams(params)
	baseSlug := GenerateSlug(params.Title, params.CreatorUserID, r.now())
	for attempt := 0; attempt < 5; attempt++ {
		slug := baseSlug
		if attempt > 0 {
			slug = fmt.Sprintf("%s-%d", baseSlug, attempt+1)
		}

		var createdSlug string
		var err error
		if params.RecurrenceRule == "" {
			createdSlug, err = r.createWithSlug(ctx, params, slug)
		} else {
			createdSlug, err = r.createSeriesWithSlug(ctx, params, slug)
		}
		if errors.Is(err, ErrSlugUnavailable) {
			continue
		}
		if err != nil {
			return Event{}, err
		}
		return r.GetBySlug(ctx, createdSlug)
	}

	return Event{}, ErrSlugUnavailable
}

func (r *PostgresRepository) Update(ctx context.Context, params UpdateParams) (Event, error) {
	if err := ValidateUpdateInput(params.UpdateInput); err != nil {
		return Event{}, err
	}

	params = normalizeUpdateParams(params)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Event{}, fmt.Errorf("begin event update: %w", err)
	}
	defer tx.Rollback(ctx)

	eventID, currentPrivatePasswordHash, err := lockEditableEvent(ctx, tx, params.Slug, params.EditorUserID)
	if err != nil {
		return Event{}, err
	}

	privatePasswordHash := ""
	if params.Visibility == VisibilityPrivate {
		privatePasswordHash = params.PrivatePasswordHash
		if privatePasswordHash == "" && currentPrivatePasswordHash.Valid {
			privatePasswordHash = currentPrivatePasswordHash.String
		}
		if privatePasswordHash == "" {
			return Event{}, apperror.Validation("private password hash is required")
		}
	}

	var slug string
	err = tx.QueryRow(ctx, `
		UPDATE events e
		SET host_school_id = s.id,
		    title = $3,
		    description = $4,
		    visibility = $5,
		    format = $6,
		    starts_at = $7,
		    ends_at = $8,
		    timezone = $9,
		    location_name = NULLIF($10, ''),
		    address = NULLIF($11, ''),
		    online_url = NULLIF($12, ''),
		    private_password_hash = NULLIF($13, ''),
		    capacity = $14,
		    is_paid = $15,
		    payment_note = NULLIF($16, ''),
		    payment_url = NULLIF($17, '')
		FROM schools s
		WHERE e.id = $1::uuid
		  AND s.id = $2::uuid
		  AND s.deleted_at IS NULL
		  AND s.is_active = TRUE
		RETURNING e.slug
	`, eventID, params.HostSchoolID, params.Title, params.Description, params.Visibility,
		params.Format, params.StartsAt, params.EndsAt, params.Timezone, params.LocationName,
		params.Address, params.OnlineURL, privatePasswordHash, nullableInt(params.Capacity),
		params.IsPaid, params.PaymentNote, params.PaymentURL).Scan(&slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrHostSchoolNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("update event: %w", err)
	}

	// Retained links may name games deactivated since they were chosen; only
	// newly added games must be active.
	if _, err := tx.Exec(ctx, `
		DELETE FROM event_games
		WHERE event_id = $1::uuid AND NOT (game_id::text = ANY($2))
	`, eventID, params.GameIDs); err != nil {
		return Event{}, fmt.Errorf("delete event games: %w", err)
	}
	if _, err := insertEventGames(ctx, tx, eventID, params.GameIDs); err != nil {
		return Event{}, err
	}
	var linkedGameCount int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM event_games WHERE event_id = $1::uuid
	`, eventID).Scan(&linkedGameCount); err != nil {
		return Event{}, fmt.Errorf("count event games: %w", err)
	}
	if linkedGameCount != len(params.GameIDs) {
		return Event{}, ErrGameNotFound
	}

	if params.PrivatePasswordHash != "" || params.Visibility != VisibilityPrivate {
		if _, err := tx.Exec(ctx, `
			UPDATE event_private_unlocks
			SET deleted_at = NOW()
			WHERE event_id = $1::uuid AND deleted_at IS NULL
		`, eventID); err != nil {
			return Event{}, fmt.Errorf("archive private event unlocks: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Event{}, fmt.Errorf("commit event update: %w", err)
	}
	return r.GetBySlug(ctx, slug)
}

func (r *PostgresRepository) Delete(ctx context.Context, slug string, userID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin event delete: %w", err)
	}
	defer tx.Rollback(ctx)

	eventID, _, err := lockEditableEvent(ctx, tx, strings.TrimSpace(slug), strings.TrimSpace(userID))
	if err != nil {
		return err
	}
	event, err := scanEvent(tx.QueryRow(ctx, eventSelectSQL(`e.id = $1::uuid`, ``), eventID), r.now())
	if err != nil {
		return fmt.Errorf("load event cancellation email: %w", err)
	}
	recipients, err := cancellationRecipients(ctx, tx, eventID)
	if err != nil {
		return err
	}
	for _, recipient := range recipients {
		if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
			Kind:           emailoutbox.KindEventCancellation,
			Recipient:      recipient.Email,
			Payload:        map[string]any{"event": event, "user_id": recipient.UserID},
			IdempotencyKey: "event-cancellation:" + eventID + ":" + recipient.UserID,
		}); err != nil {
			return fmt.Errorf("enqueue event cancellation email: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE events
		SET deleted_at = NOW()
		WHERE id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_organizers
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event organizers: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_rsvps
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event rsvps: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_interests
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event interests: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_private_unlocks
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event private unlocks: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit event delete: %w", err)
	}
	return nil
}

func (r *PostgresRepository) CreatePrivateUnlock(ctx context.Context, slug string, tokenHash []byte, expiresAt time.Time) error {
	commandTag, err := r.pool.Exec(ctx, `
		INSERT INTO event_private_unlocks (event_id, token_hash, expires_at)
		SELECT id, $2, $3
		FROM events
		WHERE slug = $1
		  AND visibility = 'private'
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug), tokenHash, expiresAt)
	if err != nil {
		return fmt.Errorf("create private event unlock: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return ErrEventNotFound
	}
	return nil
}

func (r *PostgresRepository) SetRSVP(ctx context.Context, input RSVPInput) (Event, error) {
	input = normalizeRSVPInput(input)
	if err := ValidateRSVPInput(input); err != nil {
		return Event{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Event{}, fmt.Errorf("begin event rsvp: %w", err)
	}
	defer tx.Rollback(ctx)

	var eventID string
	var capacity sql.NullInt64
	var endsAt time.Time
	var yesCount int
	var currentResponse sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT e.id::text,
		       e.capacity,
		       e.ends_at,
		       COALESCE(yes_counts.yes_count, 0)::int,
		       (
		           SELECT r.response
		           FROM event_rsvps r
		           WHERE r.event_id = e.id
		             AND r.user_id = $2::uuid
		             AND r.deleted_at IS NULL
		       ) AS current_response
		FROM events e
		LEFT JOIN LATERAL (
		    SELECT COUNT(*) AS yes_count
		    FROM event_rsvps r
		    WHERE r.event_id = e.id
		      AND r.response = 'yes'
		      AND r.deleted_at IS NULL
		) yes_counts ON TRUE
		WHERE e.slug = $1
		  AND e.deleted_at IS NULL
		FOR UPDATE OF e
	`, input.Slug, input.UserID).Scan(&eventID, &capacity, &endsAt, &yesCount, &currentResponse)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrEventNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("lock event rsvp: %w", err)
	}
	if !r.now().Before(endsAt) {
		return Event{}, ErrRSVPClosed
	}
	if input.Response == RSVPYes && capacity.Valid && yesCount >= int(capacity.Int64) &&
		(!currentResponse.Valid || currentResponse.String != RSVPYes) {
		return Event{}, ErrEventFull
	}

	var transitionID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO event_rsvps (event_id, user_id, response)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (event_id, user_id)
		DO UPDATE SET response = EXCLUDED.response,
		              deleted_at = NULL
		RETURNING gen_random_uuid()::text
	`, eventID, input.UserID, input.Response).Scan(&transitionID); err != nil {
		return Event{}, fmt.Errorf("upsert event rsvp: %w", err)
	}

	event, err := scanEvent(tx.QueryRow(ctx, eventSelectSQL(`e.id = $1::uuid`, ``), eventID), r.now())
	if err != nil {
		return Event{}, fmt.Errorf("load event after rsvp: %w", err)
	}
	if input.Response == RSVPYes && (!currentResponse.Valid || currentResponse.String != RSVPYes) {
		var recipient string
		if err := tx.QueryRow(ctx, `
			SELECT email::text FROM users
			WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
		`, input.UserID).Scan(&recipient); err != nil {
			return Event{}, fmt.Errorf("load rsvp email recipient: %w", err)
		}
		if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
			Kind:           emailoutbox.KindRSVPConfirmation,
			Recipient:      recipient,
			Payload:        map[string]any{"event": event, "user_id": input.UserID},
			IdempotencyKey: fmt.Sprintf("event-rsvp-yes:%s:%s:%s", eventID, input.UserID, transitionID),
		}); err != nil {
			return Event{}, fmt.Errorf("enqueue rsvp confirmation email: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Event{}, fmt.Errorf("commit event rsvp: %w", err)
	}

	event.ViewerRSVP = &input.Response
	return event, nil
}

type cancellationRecipient struct {
	UserID string
	Email  string
}

func cancellationRecipients(ctx context.Context, tx pgx.Tx, eventID string) ([]cancellationRecipient, error) {
	rows, err := tx.Query(ctx, `
		SELECT u.id::text, u.email::text
		FROM event_rsvps r
		JOIN users u ON u.id = r.user_id
		WHERE r.event_id = $1::uuid
		  AND r.deleted_at IS NULL
		  AND r.response IN ('yes', 'maybe')
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
		ORDER BY u.id
	`, eventID)
	if err != nil {
		return nil, fmt.Errorf("list event cancellation recipients: %w", err)
	}
	defer rows.Close()
	var recipients []cancellationRecipient
	for rows.Next() {
		var recipient cancellationRecipient
		if err := rows.Scan(&recipient.UserID, &recipient.Email); err != nil {
			return nil, fmt.Errorf("scan event cancellation recipient: %w", err)
		}
		recipients = append(recipients, recipient)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event cancellation recipients: %w", err)
	}
	return recipients, nil
}

func (r *PostgresRepository) SetInterest(ctx context.Context, slug string, userID string, interested bool) (Event, error) {
	slug = strings.TrimSpace(slug)
	userID = strings.TrimSpace(userID)
	if slug == "" || userID == "" {
		return Event{}, apperror.Validation("event slug and user are required")
	}

	if interested {
		commandTag, err := r.pool.Exec(ctx, `
			INSERT INTO event_interests (event_id, user_id)
			SELECT id, $2::uuid
			FROM events
			WHERE slug = $1
			  AND deleted_at IS NULL
			ON CONFLICT (event_id, user_id)
			DO UPDATE SET deleted_at = NULL
		`, slug, userID)
		if err != nil {
			return Event{}, fmt.Errorf("set event interest: %w", err)
		}
		if commandTag.RowsAffected() != 1 {
			return Event{}, ErrEventNotFound
		}
	} else {
		eventID, err := r.eventIDBySlug(ctx, slug)
		if err != nil {
			return Event{}, err
		}
		if _, err := r.pool.Exec(ctx, `
			UPDATE event_interests
			SET deleted_at = NOW()
			WHERE event_id = $1::uuid
			  AND user_id = $2::uuid
			  AND deleted_at IS NULL
		`, eventID, userID); err != nil {
			return Event{}, fmt.Errorf("unset event interest: %w", err)
		}
	}

	event, err := r.GetBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrEventNotFound
	}
	if err != nil {
		return Event{}, err
	}
	event.ViewerInterested = interested
	return event, nil
}
