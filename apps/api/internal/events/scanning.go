package events

import (
	"context"
	"database/sql"
	"time"

	"github.com/jackc/pgx/v5"
)

type eventScanner interface {
	Scan(dest ...any) error
}

type eventGameInserter interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanEvent(scanner eventScanner, now time.Time) (Event, error) {
	var event Event
	var capacity sql.NullInt64
	var locationName sql.NullString
	var address sql.NullString
	var onlineURL sql.NullString
	var paymentNote sql.NullString
	var paymentURL sql.NullString
	var recurrenceRule sql.NullString
	var recurrenceUntil sql.NullTime
	var gameIDs []string
	var gameNames []string
	var gameSlugs []string

	err := scanner.Scan(
		&event.ID,
		&event.Title,
		&event.Slug,
		&event.Description,
		&event.Visibility,
		&event.Format,
		&event.StartsAt,
		&event.EndsAt,
		&event.Timezone,
		&locationName,
		&address,
		&onlineURL,
		&capacity,
		&event.IsPaid,
		&paymentNote,
		&paymentURL,
		&recurrenceRule,
		&recurrenceUntil,
		&event.HostSchool.ID,
		&event.HostSchool.Name,
		&event.HostSchool.Slug,
		&event.HostSchool.City,
		&event.HostSchool.State,
		&event.RSVPYesCount,
		&event.InterestCount,
		&gameIDs,
		&gameNames,
		&gameSlugs,
	)
	if err != nil {
		return Event{}, err
	}

	if locationName.Valid {
		event.LocationName = locationName.String
	}
	if address.Valid {
		event.Address = address.String
	}
	if onlineURL.Valid {
		event.OnlineURL = onlineURL.String
	}
	if capacity.Valid {
		value := int(capacity.Int64)
		event.Capacity = &value
	}
	if paymentNote.Valid {
		event.PaymentNote = paymentNote.String
	}
	if paymentURL.Valid {
		event.PaymentURL = paymentURL.String
	}
	if recurrenceRule.Valid {
		event.RecurrenceRule = recurrenceRule.String
	}
	if recurrenceUntil.Valid {
		value := recurrenceUntil.Time
		event.RecurrenceUntil = &value
	}

	event.Games = make([]GameSummary, 0, len(gameIDs))
	for index := range gameIDs {
		event.Games = append(event.Games, GameSummary{
			ID:   gameIDs[index],
			Name: gameNames[index],
			Slug: gameSlugs[index],
		})
	}
	event.Lifecycle = Lifecycle(now, event.StartsAt, event.EndsAt, event.Capacity, event.RSVPYesCount)

	return event, nil
}

func scanEventForUser(scanner eventScanner, now time.Time) (Event, error) {
	var event Event
	var capacity sql.NullInt64
	var locationName sql.NullString
	var address sql.NullString
	var onlineURL sql.NullString
	var paymentNote sql.NullString
	var paymentURL sql.NullString
	var recurrenceRule sql.NullString
	var recurrenceUntil sql.NullTime
	var viewerRSVP sql.NullString
	var gameIDs []string
	var gameNames []string
	var gameSlugs []string

	err := scanner.Scan(
		&event.ID,
		&event.Title,
		&event.Slug,
		&event.Description,
		&event.Visibility,
		&event.Format,
		&event.StartsAt,
		&event.EndsAt,
		&event.Timezone,
		&locationName,
		&address,
		&onlineURL,
		&capacity,
		&event.IsPaid,
		&paymentNote,
		&paymentURL,
		&recurrenceRule,
		&recurrenceUntil,
		&event.HostSchool.ID,
		&event.HostSchool.Name,
		&event.HostSchool.Slug,
		&event.HostSchool.City,
		&event.HostSchool.State,
		&event.RSVPYesCount,
		&event.InterestCount,
		&gameIDs,
		&gameNames,
		&gameSlugs,
		&viewerRSVP,
		&event.ViewerInterested,
	)
	if err != nil {
		return Event{}, err
	}

	if locationName.Valid {
		event.LocationName = locationName.String
	}
	if address.Valid {
		event.Address = address.String
	}
	if onlineURL.Valid {
		event.OnlineURL = onlineURL.String
	}
	if capacity.Valid {
		value := int(capacity.Int64)
		event.Capacity = &value
	}
	if paymentNote.Valid {
		event.PaymentNote = paymentNote.String
	}
	if paymentURL.Valid {
		event.PaymentURL = paymentURL.String
	}
	if recurrenceRule.Valid {
		event.RecurrenceRule = recurrenceRule.String
	}
	if recurrenceUntil.Valid {
		value := recurrenceUntil.Time
		event.RecurrenceUntil = &value
	}
	if viewerRSVP.Valid {
		event.ViewerRSVP = &viewerRSVP.String
	}

	event.Games = make([]GameSummary, 0, len(gameIDs))
	for index := range gameIDs {
		event.Games = append(event.Games, GameSummary{
			ID:   gameIDs[index],
			Name: gameNames[index],
			Slug: gameSlugs[index],
		})
	}
	event.Lifecycle = Lifecycle(now, event.StartsAt, event.EndsAt, event.Capacity, event.RSVPYesCount)

	return event, nil
}

func eventSelectSQL(whereClause string, tailClause string) string {
	return `
		SELECT e.id::text, e.title, e.slug, e.description, e.visibility,
		       e.format, e.starts_at, e.ends_at, e.timezone,
		       e.location_name, e.address, e.online_url, e.capacity, e.is_paid,
		       e.payment_note, e.payment_url,
		       e.recurrence_rule, e.recurrence_until,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
		       COALESCE(yes_counts.yes_count, 0)::int,
		       COALESCE(interest_counts.interest_count, 0)::int,
		       COALESCE(
		           array_agg(g.id::text ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       COALESCE(
		           array_agg(g.name ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       COALESCE(
		           array_agg(g.slug ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       )
		FROM events e
		JOIN schools s ON s.id = e.host_school_id
		LEFT JOIN event_games eg ON eg.event_id = e.id
		LEFT JOIN games g ON g.id = eg.game_id AND g.deleted_at IS NULL
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS yes_count
			FROM event_rsvps r
			WHERE r.event_id = e.id
			  AND r.response = 'yes'
			  AND r.deleted_at IS NULL
		) yes_counts ON TRUE
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS interest_count
			FROM event_interests i
			WHERE i.event_id = e.id
			  AND i.deleted_at IS NULL
		) interest_counts ON TRUE
		WHERE ` + whereClause + `
		GROUP BY e.id, e.title, e.slug, e.description, e.visibility,
		         e.format, e.starts_at, e.ends_at, e.timezone,
		         e.location_name, e.address, e.online_url, e.capacity, e.is_paid,
		         e.payment_note, e.payment_url, e.recurrence_rule, e.recurrence_until,
		         s.id, s.name, s.slug, s.city, s.state, yes_counts.yes_count,
		         interest_counts.interest_count
	` + tailClause
}

func eventSelectForUserSQL(whereClause string, tailClause string) string {
	return `
		SELECT e.id::text, e.title, e.slug, e.description, e.visibility,
		       e.format, e.starts_at, e.ends_at, e.timezone,
		       e.location_name, e.address, e.online_url, e.capacity, e.is_paid,
		       e.payment_note, e.payment_url,
		       e.recurrence_rule, e.recurrence_until,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
		       COALESCE(yes_counts.yes_count, 0)::int,
		       COALESCE(interest_counts.interest_count, 0)::int,
		       COALESCE(
		           array_agg(g.id::text ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       COALESCE(
		           array_agg(g.name ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       COALESCE(
		           array_agg(g.slug ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       viewer_rsvp.response,
		       (viewer_interest.user_id IS NOT NULL)
		FROM events e
		JOIN schools s ON s.id = e.host_school_id
		LEFT JOIN event_games eg ON eg.event_id = e.id
		LEFT JOIN games g ON g.id = eg.game_id AND g.deleted_at IS NULL
		LEFT JOIN event_rsvps viewer_rsvp ON viewer_rsvp.event_id = e.id
		                                  AND viewer_rsvp.user_id = $1::uuid
		                                  AND viewer_rsvp.deleted_at IS NULL
		LEFT JOIN event_interests viewer_interest ON viewer_interest.event_id = e.id
		                                         AND viewer_interest.user_id = $1::uuid
		                                         AND viewer_interest.deleted_at IS NULL
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS yes_count
			FROM event_rsvps r
			WHERE r.event_id = e.id
			  AND r.response = 'yes'
			  AND r.deleted_at IS NULL
		) yes_counts ON TRUE
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS interest_count
			FROM event_interests i
			WHERE i.event_id = e.id
			  AND i.deleted_at IS NULL
		) interest_counts ON TRUE
		WHERE ` + whereClause + `
		GROUP BY e.id, e.title, e.slug, e.description, e.visibility,
		         e.format, e.starts_at, e.ends_at, e.timezone,
		         e.location_name, e.address, e.online_url, e.capacity, e.is_paid,
		         e.payment_note, e.payment_url, e.recurrence_rule, e.recurrence_until,
		         s.id, s.name, s.slug, s.city, s.state, yes_counts.yes_count,
		         interest_counts.interest_count, viewer_rsvp.response,
		         viewer_interest.user_id
	` + tailClause
}
