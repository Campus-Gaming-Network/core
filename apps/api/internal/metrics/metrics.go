// Package metrics counts active accounts and signups for the Admin Console.
// It reports counts only, never which accounts were active.
package metrics

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TrendDays is how many days the daily series covers, ending on the as-of day.
const TrendDays = 30

// SchoolLimit is how many schools the by-school list names.
const SchoolLimit = 20

// Metrics is the active-account and activity summary as of one UTC day. Days
// are YYYY-MM-DD.
type Metrics struct {
	AsOf    string        `json:"as_of"`
	Active  ActiveCounts  `json:"active"`
	Days    []DayCounts   `json:"days"`
	Schools []SchoolCount `json:"schools"`
}

// ActiveCounts are distinct accounts active on the as-of day and in the 7 and
// 30 days ending on it.
type ActiveCounts struct {
	Day   int `json:"day"`
	Week  int `json:"week"`
	Month int `json:"month"`
}

// DayCounts are one UTC day's active accounts and the records created that
// day: accounts, club memberships, event RSVPs, events, and teams. Records are
// counted while they exist, so a deleted account's memberships and RSVPs and
// a club someone left drop out of past days. Metrics lists days newest first.
type DayCounts struct {
	Day           string `json:"day"`
	Active        int    `json:"active"`
	Signups       int    `json:"signups"`
	ClubJoins     int    `json:"club_joins"`
	RSVPs         int    `json:"rsvps"`
	EventsCreated int    `json:"events_created"`
	TeamsCreated  int    `json:"teams_created"`
}

// SchoolCount is how many accounts with this home school were active in the
// 30 days ending on the as-of day.
type SchoolCount struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active int    `json:"active"`
}

// PostgresRepository reads metrics from Postgres.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// Metrics summarizes activity as of the UTC date of asOf. The three reads
// share one snapshot so their counts agree.
func (r *PostgresRepository) Metrics(ctx context.Context, asOf time.Time) (Metrics, error) {
	day := asOf.UTC().Format(time.DateOnly)
	result := Metrics{AsOf: day}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Metrics{}, fmt.Errorf("begin metrics: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `
		SELECT
			COUNT(DISTINCT user_id) FILTER (WHERE day = $1::date),
			COUNT(DISTINCT user_id) FILTER (WHERE day > $1::date - 7),
			COUNT(DISTINCT user_id)
		FROM user_activity_days
		WHERE day > $1::date - $2::int AND day <= $1::date
	`, day, TrendDays).Scan(&result.Active.Day, &result.Active.Week, &result.Active.Month); err != nil {
		return Metrics{}, fmt.Errorf("count active accounts: %w", err)
	}

	// Records are bucketed by their UTC date whatever the session time zone.
	rows, err := tx.Query(ctx, `
		WITH days AS (
			SELECT generate_series($1::date - ($2::int - 1), $1::date, INTERVAL '1 day')::date AS day
		),
		active AS (
			SELECT day, COUNT(*) AS count FROM user_activity_days
			WHERE day > $1::date - $2::int AND day <= $1::date
			GROUP BY day
		),
		window_bounds AS (
			SELECT ($1::date - ($2::int - 1))::timestamp AT TIME ZONE 'UTC' AS opens,
			       ($1::date + 1)::timestamp AT TIME ZONE 'UTC' AS closes
		),
		created AS (
			SELECT 'signup' AS kind, created_at FROM users
			UNION ALL SELECT 'club_join', created_at FROM club_members
			UNION ALL SELECT 'rsvp', created_at FROM event_rsvps
			UNION ALL SELECT 'event', created_at FROM events
			UNION ALL SELECT 'team', created_at FROM teams
		),
		counts AS (
			SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
			       COUNT(*) FILTER (WHERE kind = 'signup') AS signups,
			       COUNT(*) FILTER (WHERE kind = 'club_join') AS club_joins,
			       COUNT(*) FILTER (WHERE kind = 'rsvp') AS rsvps,
			       COUNT(*) FILTER (WHERE kind = 'event') AS events,
			       COUNT(*) FILTER (WHERE kind = 'team') AS teams
			FROM created, window_bounds
			WHERE created_at >= opens AND created_at < closes
			GROUP BY 1
		)
		SELECT days.day::text, COALESCE(active.count, 0),
		       COALESCE(counts.signups, 0), COALESCE(counts.club_joins, 0), COALESCE(counts.rsvps, 0),
		       COALESCE(counts.events, 0), COALESCE(counts.teams, 0)
		FROM days
		LEFT JOIN active ON active.day = days.day
		LEFT JOIN counts ON counts.day = days.day
		ORDER BY days.day DESC
	`, day, TrendDays)
	if err != nil {
		return Metrics{}, fmt.Errorf("list daily counts: %w", err)
	}
	result.Days, err = pgx.CollectRows(rows, pgx.RowToStructByPos[DayCounts])
	if err != nil {
		return Metrics{}, fmt.Errorf("list daily counts: %w", err)
	}

	rows, err = tx.Query(ctx, `
		SELECT s.id::text, s.name, COUNT(DISTINCT a.user_id)::int
		FROM user_activity_days a
		JOIN users u ON u.id = a.user_id
		JOIN schools s ON s.id = u.home_school_id
		WHERE a.day > $1::date - $2::int AND a.day <= $1::date
		GROUP BY s.id, s.name
		ORDER BY 3 DESC, s.name, s.id
		LIMIT $3
	`, day, TrendDays, SchoolLimit)
	if err != nil {
		return Metrics{}, fmt.Errorf("count active accounts by school: %w", err)
	}
	result.Schools, err = pgx.CollectRows(rows, pgx.RowToStructByPos[SchoolCount])
	if err != nil {
		return Metrics{}, fmt.Errorf("count active accounts by school: %w", err)
	}

	return result, nil
}
