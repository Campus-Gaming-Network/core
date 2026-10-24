package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
)

// Access returns what the user may do to the live event with slug. A missing
// event allows nothing.
func (r *PostgresRepository) Access(ctx context.Context, slug string, userID string) (Access, error) {
	var access Access
	err := r.pool.QueryRow(ctx, `
		SELECT `+editableBy("$2")+`, e.creator_user_id = $2::uuid OR `+hostClubOfficer("$2")+`
		FROM events e
		WHERE e.slug = $1 AND e.deleted_at IS NULL
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&access.Edit, &access.Cancel)
	if errors.Is(err, pgx.ErrNoRows) {
		return Access{}, nil
	}
	if err != nil {
		return Access{}, fmt.Errorf("read event access: %w", err)
	}
	return access, nil
}

// PrivatePasswordHash returns the password hash of a private event. It
// returns ErrEventNotFound when the event is missing, not private, or has no
// password.
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

// IsPrivateUnlockValid reports whether tokenHash is an unexpired unlock for
// the private event with slug.
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

// GetRSVP returns the user's RSVP response for the event, or "" when they
// have not responded.
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

// IsInterested reports whether the user marked the event as interested.
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

// ListUpcomingRSVPs returns the upcoming events the user RSVP'd yes or maybe
// to, soonest first.
func (r *PostgresRepository) ListUpcomingRSVPs(ctx context.Context, userID string, limit int) ([]Event, error) {
	return r.listUpcomingForUser(ctx, userID, limit, `viewer_rsvp.response IN ('yes', 'maybe')`, "upcoming event rsvps")
}

// ListInterestedEvents returns the upcoming events the user marked as
// interested, soonest first.
func (r *PostgresRepository) ListInterestedEvents(ctx context.Context, userID string, limit int) ([]Event, error) {
	return r.listUpcomingForUser(ctx, userID, limit, `viewer_interest.user_id IS NOT NULL`, "interested events")
}

// listUpcomingForUser lists events that have not ended and match condition,
// a clause over the viewer_rsvp and viewer_interest joins, soonest first.
func (r *PostgresRepository) listUpcomingForUser(ctx context.Context, userID string, limit int, condition string, label string) ([]Event, error) {
	return r.listSoonestForUser(ctx, userID, limit, label, `
		e.deleted_at IS NULL
		AND e.ends_at > $2
		AND `+condition+`
	`)
}

// ListFollowedSchoolEvents returns the upcoming public events hosted by
// schools the user follows, soonest first.
func (r *PostgresRepository) ListFollowedSchoolEvents(ctx context.Context, userID string, limit int) ([]Event, error) {
	return r.listSoonestForUser(ctx, userID, limit, "followed school events", `
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
	`)
}

// listSoonestForUser runs the viewer event select with whereClause, which may
// use $1 (user ID) and $2 (now), and returns up to limit events by start time.
// A limit outside 1 to 25 becomes 5.
func (r *PostgresRepository) listSoonestForUser(ctx context.Context, userID string, limit int, label string, whereClause string) ([]Event, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, apperror.Validation("user is required")
	}
	if limit < 1 || limit > 25 {
		limit = 5
	}

	rows, err := r.pool.Query(ctx, eventSelectForUserSQL(whereClause, `
		ORDER BY e.starts_at, e.id
		LIMIT $3
	`), userID, r.now(), limit)
	if err != nil {
		return nil, fmt.Errorf("list %s: %w", label, err)
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
		return nil, fmt.Errorf("iterate %s: %w", label, err)
	}
	return events, nil
}

// ListPublic returns public events that have not ended, soonest first,
// optionally filtered by game, school, host team, title keyword, format,
// audience, event type, cost, local start date, and start window (StartsAfter and StartsBefore). After and Before page forward
// and backward from a cursor; setting both is an invalid cursor. A previous
// page is returned in the same soonest-first order.
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
		AND ($4 = '' OR e.audience = $4)
		AND ($5 = '' OR e.event_type = $5)
		AND ($6 = '' OR e.cost = $6)
		AND ($8 = '' OR ht.slug = $8)
		AND ($12 = '' OR hc.slug = $12)
		AND ($9 = '' OR e.title ILIKE '%' || $9 || '%')
		AND ($10 = '' OR (e.starts_at AT TIME ZONE e.timezone)::date >= $10::date)
		AND ($11 = '' OR (e.starts_at AT TIME ZONE e.timezone)::date <= $11::date)
	`
	arguments := []any{
		params.GameSlug, params.SchoolSlug, params.Format, params.Audience, params.EventType,
		params.Cost, r.now(), params.TeamSlug, likePattern(params.Query), params.FromDate, params.ToDate,
		params.ClubSlug,
	}
	// Soonest first: events under way, then upcoming ones by start time.
	// Ended events leave the list. A previous page reads backward from its
	// cursor and is reversed afterward.
	whereClause += " AND e.ends_at > $7"
	if params.StartsAfter != nil {
		whereClause += fmt.Sprintf(" AND e.starts_at >= $%d", len(arguments)+1)
		arguments = append(arguments, *params.StartsAfter)
	}
	if params.StartsBefore != nil {
		whereClause += fmt.Sprintf(" AND e.starts_at < $%d", len(arguments)+1)
		arguments = append(arguments, *params.StartsBefore)
	}
	order := "ORDER BY e.starts_at, e.id"
	if params.After != nil {
		whereClause += fmt.Sprintf(" AND (e.starts_at, e.id) > ($%d, $%d::uuid)", len(arguments)+1, len(arguments)+2)
		arguments = append(arguments, params.After.Timestamp, params.After.ID)
	}
	if params.Before != nil {
		whereClause += fmt.Sprintf(" AND (e.starts_at, e.id) < ($%d, $%d::uuid)", len(arguments)+1, len(arguments)+2)
		arguments = append(arguments, params.Before.Timestamp, params.Before.ID)
		order = "ORDER BY e.starts_at DESC, e.id DESC"
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

// likePattern escapes a keyword so ILIKE matches it literally; the trigram
// index on events.title serves the contains-match.
func likePattern(query string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
}

// reverseEvents reverses events in place.
func reverseEvents(events []Event) {
	for left, right := 0, len(events)-1; left < right; left, right = left+1, right-1 {
		events[left], events[right] = events[right], events[left]
	}
}

// GetBySlug returns the live event with slug, including its organizers. It
// does not check visibility; callers do.
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

// GetPageBySlug returns the event with slug as its page shows it: a live
// event, or one cancelled less than CancelledEventVisibility ago with
// CancelledAt set and the organizers it had when it was cancelled. It does
// not check visibility; callers do.
func (r *PostgresRepository) GetPageBySlug(ctx context.Context, slug string) (Event, error) {
	var eventID string
	var cancelledAt *time.Time
	if err := r.pool.QueryRow(ctx, `
		SELECT id::text, deleted_at
		FROM events
		WHERE slug = $1
		  AND (deleted_at IS NULL OR deleted_at > $2)
	`, strings.TrimSpace(slug), r.now().Add(-CancelledEventVisibility)).Scan(&eventID, &cancelledAt); err != nil {
		return Event{}, err
	}
	if cancelledAt == nil {
		return r.GetBySlug(ctx, slug)
	}
	event, err := scanEvent(r.pool.QueryRow(ctx, eventSelectSQL(`e.id = $1::uuid`, ``), eventID), r.now())
	if err != nil {
		return Event{}, err
	}
	event.CancelledAt = cancelledAt
	if err := r.populateOrganizers(ctx, &event); err != nil {
		return Event{}, err
	}
	return event, nil
}

// ListCreated returns the live events userID created, past and upcoming,
// latest start first, starting after the cursor when one is given.
func (r *PostgresRepository) ListCreated(ctx context.Context, userID string, after *pagecursor.Cursor, limit int) (CreatedPage, error) {
	if limit < 1 || limit > MaximumCreatedLimit {
		limit = DefaultCreatedLimit
	}
	var cursorTime, cursorID any
	if after != nil {
		cursorTime, cursorID = after.Timestamp, after.ID
	}
	rows, err := r.pool.Query(ctx, eventSelectSQL(`
		e.deleted_at IS NULL
		AND e.creator_user_id = $1::uuid
		AND ($2::timestamptz IS NULL OR (e.starts_at, e.id) < ($2::timestamptz, $3::uuid))
	`, `
		ORDER BY e.starts_at DESC, e.id DESC
		LIMIT $4
	`), strings.TrimSpace(userID), cursorTime, cursorID, limit+1)
	if err != nil {
		return CreatedPage{}, fmt.Errorf("list created events: %w", err)
	}
	defer rows.Close()

	events := make([]Event, 0, limit+1)
	for rows.Next() {
		event, err := scanEvent(rows, r.now())
		if err != nil {
			return CreatedPage{}, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return CreatedPage{}, fmt.Errorf("iterate created events: %w", err)
	}
	page := CreatedPage{Events: events}
	if len(events) > limit {
		page.Events = events[:limit]
		last := page.Events[limit-1]
		page.NextCursor = pagecursor.Encode(last.StartsAt, last.ID)
	}
	return page, nil
}

func (r *PostgresRepository) populateOrganizers(ctx context.Context, event *Event) error {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id::text,
		       u.public_id,
		       u.name,
		       eo.role,
		       u.verification_level,
		       ARRAY_REMOVE(ARRAY[
		           CASE WHEN u.verification_level = 'staff_faculty' THEN 'staff_faculty'::text END,
		           CASE WHEN sa.user_id IS NOT NULL THEN 'school_admin'::text END
		       ], NULL::text)
		FROM event_organizers eo
		JOIN events e ON e.id = eo.event_id
		JOIN users u ON u.id = eo.user_id
		LEFT JOIN school_admins sa
		       ON sa.user_id = u.id
		      AND sa.school_id = $2::uuid
		      AND sa.deleted_at IS NULL
		WHERE eo.event_id = $1::uuid
		  -- A cancelled event keeps the organizers it had: cancelling ends
		  -- their roles in the same transaction, so at the same NOW().
		  AND (eo.deleted_at IS NULL OR eo.deleted_at = e.deleted_at)
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
		if err := rows.Scan(&organizer.ID, &organizer.PublicID, &organizer.Name, &organizer.Role, &organizer.VerificationLevel, &organizer.RoleIndicators); err != nil {
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
