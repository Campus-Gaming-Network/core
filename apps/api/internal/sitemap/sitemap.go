// Package sitemap lists the public pages a search crawler may index. It
// returns only slugs and change times, and only for records any visitor can
// already open without signing in.
package sitemap

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MaximumEntries bounds each list. The sitemap protocol allows 50,000 URLs per
// file; the three lists and the fixed pages stay well under it.
const MaximumEntries = 10000

// eventRetention is how long an ended event stays listed, so a shared link to
// a recent event still has a page to land on.
const eventRetention = 90 * 24 * time.Hour

// Entry is one indexable record.
type Entry struct {
	Slug      string    `json:"slug"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Entries are the indexable records of each kind.
type Entries struct {
	Events  []Entry `json:"events"`
	Schools []Entry `json:"schools"`
	Teams   []Entry `json:"teams"`
}

// Repository reads the indexable records.
type Repository interface {
	Entries(ctx context.Context) (Entries, error)
}

// PostgresRepository reads the indexable records from PostgreSQL.
type PostgresRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool, now: time.Now}
}

// Entries returns the records a crawler may index.
//
// An event is listed only when its visibility is public and its audience is
// open, collegiate, or not set. Unlisted and private events, and events for a
// campus or a group, are left out: a slug in a sitemap is a published title.
// People are never listed; profile pages are not indexed.
func (r *PostgresRepository) Entries(ctx context.Context) (Entries, error) {
	events, err := r.list(ctx, `
		SELECT slug, updated_at
		FROM events
		WHERE deleted_at IS NULL
		  AND visibility = 'public'
		  AND (audience IS NULL OR audience IN ('open', 'collegiate'))
		  AND ends_at > $1
		ORDER BY slug
		LIMIT $2
	`, r.now().Add(-eventRetention), MaximumEntries)
	if err != nil {
		return Entries{}, fmt.Errorf("list sitemap events: %w", err)
	}
	schools, err := r.list(ctx, `
		SELECT slug, updated_at
		FROM schools
		WHERE deleted_at IS NULL AND is_active = TRUE
		ORDER BY slug
		LIMIT $1
	`, MaximumEntries)
	if err != nil {
		return Entries{}, fmt.Errorf("list sitemap schools: %w", err)
	}
	teams, err := r.list(ctx, `
		SELECT slug, updated_at
		FROM teams
		WHERE deleted_at IS NULL
		ORDER BY slug
		LIMIT $1
	`, MaximumEntries)
	if err != nil {
		return Entries{}, fmt.Errorf("list sitemap teams: %w", err)
	}
	return Entries{Events: events, Schools: schools, Teams: teams}, nil
}

func (r *PostgresRepository) list(ctx context.Context, query string, args ...any) ([]Entry, error) {
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []Entry{}
	for rows.Next() {
		var entry Entry
		if err := rows.Scan(&entry.Slug, &entry.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan entry: %w", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate entries: %w", err)
	}
	return entries, nil
}
