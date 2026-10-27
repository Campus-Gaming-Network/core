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
	var audience sql.NullString
	var eventType sql.NullString
	var hostTeamID sql.NullString
	var hostTeamName sql.NullString
	var hostTeamSlug sql.NullString
	var hostClubID sql.NullString
	var hostClubName sql.NullString
	var hostClubSlug sql.NullString
	var tournamentEntryType sql.NullString
	var tournamentEntrantCap sql.NullInt32
	var tournamentEntryCount sql.NullInt32
	var gameIDs []string
	var gameNames []string
	var gameSlugs []string
	var gameCovers []bool

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
		&event.Cost,
		&paymentNote,
		&paymentURL,
		&recurrenceRule,
		&recurrenceUntil,
		&audience,
		&eventType,
		&event.Revision,
		&event.UpdatedAt,
		&hostTeamID,
		&hostTeamName,
		&hostTeamSlug,
		&hostClubID,
		&hostClubName,
		&hostClubSlug,
		&event.HostSchool.ID,
		&event.HostSchool.Name,
		&event.HostSchool.Slug,
		&event.HostSchool.City,
		&event.HostSchool.State,
		&event.RSVPYesCount,
		&event.InterestCount,
		&tournamentEntryType,
		&tournamentEntrantCap,
		&tournamentEntryCount,
		&gameIDs,
		&gameNames,
		&gameSlugs,
		&gameCovers,
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
	if audience.Valid {
		event.Audience = audience.String
	}
	if eventType.Valid {
		event.EventType = eventType.String
	}
	if hostTeamID.Valid {
		event.HostTeam = &TeamSummary{ID: hostTeamID.String, Name: hostTeamName.String, Slug: hostTeamSlug.String}
	}
	if hostClubID.Valid {
		event.HostClub = &ClubSummary{ID: hostClubID.String, Name: hostClubName.String, Slug: hostClubSlug.String}
	}
	event.TournamentEntries = tournamentEntries(tournamentEntryType, tournamentEntrantCap, tournamentEntryCount)

	event.Games = make([]GameSummary, 0, len(gameIDs))
	for index := range gameIDs {
		event.Games = append(event.Games, GameSummary{
			ID:       gameIDs[index],
			Name:     gameNames[index],
			Slug:     gameSlugs[index],
			HasCover: gameCovers[index],
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
	var audience sql.NullString
	var eventType sql.NullString
	var hostTeamID sql.NullString
	var hostTeamName sql.NullString
	var hostTeamSlug sql.NullString
	var hostClubID sql.NullString
	var hostClubName sql.NullString
	var hostClubSlug sql.NullString
	var tournamentEntryType sql.NullString
	var tournamentEntrantCap sql.NullInt32
	var tournamentEntryCount sql.NullInt32
	var viewerRSVP sql.NullString
	var gameIDs []string
	var gameNames []string
	var gameSlugs []string
	var gameCovers []bool

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
		&event.Cost,
		&paymentNote,
		&paymentURL,
		&recurrenceRule,
		&recurrenceUntil,
		&audience,
		&eventType,
		&event.Revision,
		&event.UpdatedAt,
		&hostTeamID,
		&hostTeamName,
		&hostTeamSlug,
		&hostClubID,
		&hostClubName,
		&hostClubSlug,
		&event.HostSchool.ID,
		&event.HostSchool.Name,
		&event.HostSchool.Slug,
		&event.HostSchool.City,
		&event.HostSchool.State,
		&event.RSVPYesCount,
		&event.InterestCount,
		&tournamentEntryType,
		&tournamentEntrantCap,
		&tournamentEntryCount,
		&gameIDs,
		&gameNames,
		&gameSlugs,
		&gameCovers,
		&viewerRSVP,
		&event.ViewerInterested,
		&event.ViewerCanEdit,
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
	if audience.Valid {
		event.Audience = audience.String
	}
	if eventType.Valid {
		event.EventType = eventType.String
	}
	if hostTeamID.Valid {
		event.HostTeam = &TeamSummary{ID: hostTeamID.String, Name: hostTeamName.String, Slug: hostTeamSlug.String}
	}
	if hostClubID.Valid {
		event.HostClub = &ClubSummary{ID: hostClubID.String, Name: hostClubName.String, Slug: hostClubSlug.String}
	}
	event.TournamentEntries = tournamentEntries(tournamentEntryType, tournamentEntrantCap, tournamentEntryCount)
	if viewerRSVP.Valid {
		event.ViewerRSVP = &viewerRSVP.String
	}

	event.Games = make([]GameSummary, 0, len(gameIDs))
	for index := range gameIDs {
		event.Games = append(event.Games, GameSummary{
			ID:       gameIDs[index],
			Name:     gameNames[index],
			Slug:     gameSlugs[index],
			HasCover: gameCovers[index],
		})
	}
	event.Lifecycle = Lifecycle(now, event.StartsAt, event.EndsAt, event.Capacity, event.RSVPYesCount)

	return event, nil
}

// tournamentEntries is how full the event's tournament is, or nil when the
// event has none past draft.
func tournamentEntries(entryType sql.NullString, entrantCap sql.NullInt32, entryCount sql.NullInt32) *TournamentEntries {
	if !entryType.Valid {
		return nil
	}
	entries := TournamentEntries{EntryType: entryType.String, EntryCount: int(entryCount.Int32)}
	if entrantCap.Valid {
		value := int(entrantCap.Int32)
		entries.EntrantCap = &value
	}
	return &entries
}

func eventSelectSQL(whereClause string, tailClause string) string {
	return `
		SELECT e.id::text, e.title, e.slug, e.description, e.visibility,
		       e.format, e.starts_at, e.ends_at, e.timezone,
		       e.location_name, e.address, e.online_url, e.capacity, e.cost,
		       e.payment_note, e.payment_url,
		       e.recurrence_rule, e.recurrence_until, e.audience, e.event_type,
		       e.revision, e.updated_at,
		       ht.id::text, ht.name, ht.slug,
		       hc.id::text, hc.name, hc.slug,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
		       COALESCE(yes_counts.yes_count, 0)::int,
		       COALESCE(interest_counts.interest_count, 0)::int,
		       tournament_counts.entry_type, tournament_counts.entrant_cap, tournament_counts.entry_count,
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
		       COALESCE(
		           array_agg(g.is_active AND EXISTS(SELECT 1 FROM game_covers gc WHERE gc.game_id = g.id)
		                     ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::boolean[]
		       )
		FROM events e
		JOIN schools s ON s.id = e.host_school_id
		LEFT JOIN teams ht ON ht.id = e.host_team_id AND ht.deleted_at IS NULL
		LEFT JOIN clubs hc ON hc.id = e.host_club_id AND hc.deleted_at IS NULL AND hc.status = 'published'
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
		LEFT JOIN LATERAL (
			SELECT t.entry_type, t.entrant_cap,
			       (SELECT COUNT(*) FROM tournament_entries te
			        WHERE te.tournament_id = t.id AND te.status = 'registered')::int AS entry_count
			FROM tournaments t
			WHERE t.event_id = e.id
			  AND t.status <> 'draft'
		) tournament_counts ON TRUE
		WHERE ` + whereClause + `
		GROUP BY e.id, e.title, e.slug, e.description, e.visibility,
		         e.format, e.starts_at, e.ends_at, e.timezone,
		         e.location_name, e.address, e.online_url, e.capacity, e.cost,
		         e.payment_note, e.payment_url, e.recurrence_rule, e.recurrence_until, e.audience,
		         e.event_type, e.revision, e.updated_at, ht.id, ht.name, ht.slug, hc.id, hc.name, hc.slug,
		         s.id, s.name, s.slug, s.city, s.state, yes_counts.yes_count,
		         interest_counts.interest_count, tournament_counts.entry_type,
		         tournament_counts.entrant_cap, tournament_counts.entry_count
	` + tailClause
}

func eventSelectForUserSQL(whereClause string, tailClause string) string {
	return `
		SELECT e.id::text, e.title, e.slug, e.description, e.visibility,
		       e.format, e.starts_at, e.ends_at, e.timezone,
		       e.location_name, e.address, e.online_url, e.capacity, e.cost,
		       e.payment_note, e.payment_url,
		       e.recurrence_rule, e.recurrence_until, e.audience, e.event_type,
		       e.revision, e.updated_at,
		       ht.id::text, ht.name, ht.slug,
		       hc.id::text, hc.name, hc.slug,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
		       COALESCE(yes_counts.yes_count, 0)::int,
		       COALESCE(interest_counts.interest_count, 0)::int,
		       tournament_counts.entry_type, tournament_counts.entrant_cap, tournament_counts.entry_count,
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
		       COALESCE(
		           array_agg(g.is_active AND EXISTS(SELECT 1 FROM game_covers gc WHERE gc.game_id = g.id)
		                     ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::boolean[]
		       ),
		       viewer_rsvp.response,
		       (viewer_interest.user_id IS NOT NULL),
		       ` + editableBy("$1") + `
		FROM events e
		JOIN schools s ON s.id = e.host_school_id
		LEFT JOIN teams ht ON ht.id = e.host_team_id AND ht.deleted_at IS NULL
		LEFT JOIN clubs hc ON hc.id = e.host_club_id AND hc.deleted_at IS NULL AND hc.status = 'published'
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
		LEFT JOIN LATERAL (
			SELECT t.entry_type, t.entrant_cap,
			       (SELECT COUNT(*) FROM tournament_entries te
			        WHERE te.tournament_id = t.id AND te.status = 'registered')::int AS entry_count
			FROM tournaments t
			WHERE t.event_id = e.id
			  AND t.status <> 'draft'
		) tournament_counts ON TRUE
		WHERE ` + whereClause + `
		GROUP BY e.id, e.title, e.slug, e.description, e.visibility,
		         e.format, e.starts_at, e.ends_at, e.timezone,
		         e.location_name, e.address, e.online_url, e.capacity, e.cost,
		         e.payment_note, e.payment_url, e.recurrence_rule, e.recurrence_until, e.audience,
		         e.event_type, e.revision, e.updated_at, ht.id, ht.name, ht.slug, hc.id, hc.name, hc.slug,
		         s.id, s.name, s.slug, s.city, s.state, yes_counts.yes_count,
		         interest_counts.interest_count, tournament_counts.entry_type,
		         tournament_counts.entrant_cap, tournament_counts.entry_count, viewer_rsvp.response,
		         viewer_interest.user_id
	` + tailClause
}
