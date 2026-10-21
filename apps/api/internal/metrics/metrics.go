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

// Metrics is the active-account and signup summary as of one UTC day. Days
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

// DayCounts are one UTC day's active accounts and new signups. Metrics lists
// them newest first.
type DayCounts struct {
	Day     string `json:"day"`
	Active  int    `json:"active"`
	Signups int    `json:"signups"`
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

	// Signups are bucketed by their UTC date whatever the session time zone.
	rows, err := tx.Query(ctx, `
		WITH days AS (
			SELECT generate_series($1::date - ($2::int - 1), $1::date, INTERVAL '1 day')::date AS day
		),
		active AS (
			SELECT day, COUNT(*) AS count FROM user_activity_days
			WHERE day > $1::date - $2::int AND day <= $1::date
			GROUP BY day
		),
		signups AS (
			SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS count FROM users
			WHERE created_at >= ($1::date - ($2::int - 1))::timestamp AT TIME ZONE 'UTC'
			  AND created_at < ($1::date + 1)::timestamp AT TIME ZONE 'UTC'
			GROUP BY 1
		)
		SELECT days.day::text, COALESCE(active.count, 0), COALESCE(signups.count, 0)
		FROM days
		LEFT JOIN active ON active.day = days.day
		LEFT JOIN signups ON signups.day = days.day
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
