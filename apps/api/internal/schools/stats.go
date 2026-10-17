package schools

import (
	"context"
	"fmt"
	"time"
)

// MaximumStatsSchools bounds how many schools one stats read covers: a
// directory page and then some.
const MaximumStatsSchools = 50

// Stats is a school's activity on CGN, counted as it stands. It is not
// enrollment.
type Stats struct {
	Slug string `json:"slug"`
	// Members counts active accounts with the school as home school,
	// including people who chose not to appear in member lists.
	Members int `json:"members"`
	// Teams counts teams at the school that are not deleted.
	Teams int `json:"teams"`
	// UpcomingEvents counts public events the school hosts that have not
	// ended.
	UpcomingEvents int `json:"upcoming_events"`
}

// Stats returns the activity counts of the active schools among slugs,
// ordered by slug. Unknown and inactive slugs are left out. The counts are
// read live rather than from the catalog cache, because they change far more
// often than the catalog does.
func (r *PostgresRepository) Stats(ctx context.Context, slugs []string, now time.Time) ([]Stats, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT s.slug,
		       (SELECT COUNT(*) FROM users u
		        WHERE u.home_school_id = s.id AND u.deleted_at IS NULL AND u.account_status = 'active'),
		       (SELECT COUNT(*) FROM teams t
		        WHERE t.school_id = s.id AND t.deleted_at IS NULL),
		       (SELECT COUNT(*) FROM events e
		        WHERE e.host_school_id = s.id AND e.deleted_at IS NULL
		          AND e.visibility = 'public' AND e.ends_at > $2)
		FROM schools s
		WHERE s.slug = ANY($1::text[]) AND s.deleted_at IS NULL AND s.is_active = TRUE
		ORDER BY s.slug
	`, slugs, now)
	if err != nil {
		return nil, fmt.Errorf("read school stats: %w", err)
	}
	defer rows.Close()

	result := make([]Stats, 0, len(slugs))
	for rows.Next() {
		var stats Stats
		if err := rows.Scan(&stats.Slug, &stats.Members, &stats.Teams, &stats.UpcomingEvents); err != nil {
			return nil, fmt.Errorf("scan school stats: %w", err)
		}
		result = append(result, stats)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate school stats: %w", err)
	}
	return result, nil
}
