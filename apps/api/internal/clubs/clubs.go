// Package clubs reads the public records of student clubs and university
// esports programs. Each club belongs to one school.
package clubs

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrClubNotFound   = apperror.New(apperror.KindNotFound, "club_not_found", "club not found")
	ErrSchoolNotFound = apperror.New(apperror.KindNotFound, "school_not_found", "school not found")
)

// Club types. Neither implies that the university endorses the club.
const (
	TypeStudentClub       = "student_club"
	TypeUniversityProgram = "university_program"
)

// Sources of a club's last confirmation.
const (
	ConfirmedByClub = "club"
	ConfirmedByCGN  = "cgn"
)

// Club is a published club as its page shows it.
type Club struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	Type    string `json:"type"`
	Summary string `json:"summary"`
	// HowToJoin is the club's own process for becoming a member. It is empty
	// when the club has not said.
	HowToJoin string        `json:"how_to_join,omitempty"`
	School    SchoolSummary `json:"school"`
	Games     []GameSummary `json:"games"`
	Links     []Link        `json:"links"`
	// Claimed reports whether officers manage the club. An unclaimed club is
	// maintained by CGN.
	Claimed         bool       `json:"claimed"`
	ConfirmedAt     *time.Time `json:"confirmed_at,omitempty"`
	ConfirmedSource string     `json:"confirmed_source,omitempty"`
}

// ListItem is a club as a school page lists it.
type ListItem struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Slug    string        `json:"slug"`
	Type    string        `json:"type"`
	Summary string        `json:"summary"`
	Games   []GameSummary `json:"games"`
	Claimed bool          `json:"claimed"`
}

// SchoolSummary identifies the club's school.
type SchoolSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	City  string `json:"city,omitempty"`
	State string `json:"state,omitempty"`
}

// GameSummary identifies a game the club plays.
type GameSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// HasCover reports a cover the site serves at /api/games/{slug}/cover.
	HasCover bool `json:"has_cover"`
}

// Link is one of the club's labeled outbound links.
type Link struct {
	Type  string `json:"type"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

// Repository reads public club records.
type Repository interface {
	GetBySlug(ctx context.Context, slug string) (Club, error)
	ListBySchool(ctx context.Context, schoolSlug string) ([]ListItem, error)
}

// PostgresRepository reads clubs from Postgres.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// publishedClub is the condition every public read applies.
const publishedClub = `c.deleted_at IS NULL AND c.status = 'published'`

// gameColumns aggregates a club's visible games, ordered by name.
const gameColumns = `
	COALESCE(array_agg(g.id::text ORDER BY g.name, g.id) FILTER (WHERE g.id IS NOT NULL), ARRAY[]::text[]),
	COALESCE(array_agg(g.name ORDER BY g.name, g.id) FILTER (WHERE g.id IS NOT NULL), ARRAY[]::text[]),
	COALESCE(array_agg(g.slug ORDER BY g.name, g.id) FILTER (WHERE g.id IS NOT NULL), ARRAY[]::text[]),
	COALESCE(array_agg(g.is_active AND EXISTS (SELECT 1 FROM game_covers gc WHERE gc.game_id = g.id)
	                   ORDER BY g.name, g.id) FILTER (WHERE g.id IS NOT NULL), ARRAY[]::boolean[])`

// GetBySlug returns the published club with slug, with its school, games,
// and links. A hidden, deleted, or missing club is ErrClubNotFound.
func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Club, error) {
	var club Club
	var confirmedSource *string
	var gameIDs, gameNames, gameSlugs []string
	var gameCovers []bool
	err := r.pool.QueryRow(ctx, `
		SELECT c.id::text, c.name, c.slug, c.type, c.summary, c.how_to_join,
		       c.confirmed_at, c.confirmed_source,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
		       `+gameColumns+`
		FROM clubs c
		JOIN schools s ON s.id = c.school_id AND s.deleted_at IS NULL
		LEFT JOIN club_games cg ON cg.club_id = c.id
		LEFT JOIN games g ON g.id = cg.game_id AND g.deleted_at IS NULL
		WHERE c.slug = $1 AND `+publishedClub+`
		GROUP BY c.id, s.id
	`, strings.TrimSpace(slug)).Scan(
		&club.ID, &club.Name, &club.Slug, &club.Type, &club.Summary, &club.HowToJoin,
		&club.ConfirmedAt, &confirmedSource,
		&club.School.ID, &club.School.Name, &club.School.Slug, &club.School.City, &club.School.State,
		&gameIDs, &gameNames, &gameSlugs, &gameCovers,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Club{}, ErrClubNotFound
	}
	if err != nil {
		return Club{}, fmt.Errorf("get club: %w", err)
	}
	if confirmedSource != nil {
		club.ConfirmedSource = *confirmedSource
	}
	club.Games = games(gameIDs, gameNames, gameSlugs, gameCovers)

	rows, err := r.pool.Query(ctx, `
		SELECT type, label, url
		FROM club_links
		WHERE club_id = $1::uuid
		ORDER BY position, created_at, id
	`, club.ID)
	if err != nil {
		return Club{}, fmt.Errorf("list club links: %w", err)
	}
	defer rows.Close()
	club.Links = []Link{}
	for rows.Next() {
		var link Link
		if err := rows.Scan(&link.Type, &link.Label, &link.URL); err != nil {
			return Club{}, fmt.Errorf("scan club link: %w", err)
		}
		club.Links = append(club.Links, link)
	}
	if err := rows.Err(); err != nil {
		return Club{}, fmt.Errorf("iterate club links: %w", err)
	}
	return club, nil
}

// ListBySchool returns the published clubs of the school with schoolSlug,
// by name. A missing or inactive school is ErrSchoolNotFound; a school with
// no clubs returns an empty list.
func (r *PostgresRepository) ListBySchool(ctx context.Context, schoolSlug string) ([]ListItem, error) {
	var schoolID string
	err := r.pool.QueryRow(ctx, `
		SELECT id::text FROM schools
		WHERE slug = $1 AND deleted_at IS NULL AND is_active = TRUE
	`, strings.TrimSpace(schoolSlug)).Scan(&schoolID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSchoolNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get club school: %w", err)
	}

	rows, err := r.pool.Query(ctx, `
		SELECT c.id::text, c.name, c.slug, c.type, c.summary,
		       `+gameColumns+`
		FROM clubs c
		LEFT JOIN club_games cg ON cg.club_id = c.id
		LEFT JOIN games g ON g.id = cg.game_id AND g.deleted_at IS NULL
		WHERE c.school_id = $1::uuid AND `+publishedClub+`
		GROUP BY c.id
		ORDER BY LOWER(c.name), c.id
	`, schoolID)
	if err != nil {
		return nil, fmt.Errorf("list school clubs: %w", err)
	}
	defer rows.Close()
	clubs := []ListItem{}
	for rows.Next() {
		var item ListItem
		var gameIDs, gameNames, gameSlugs []string
		var gameCovers []bool
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug, &item.Type, &item.Summary,
			&gameIDs, &gameNames, &gameSlugs, &gameCovers); err != nil {
			return nil, fmt.Errorf("scan school club: %w", err)
		}
		item.Games = games(gameIDs, gameNames, gameSlugs, gameCovers)
		clubs = append(clubs, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate school clubs: %w", err)
	}
	return clubs, nil
}

func games(ids, names, slugs []string, covers []bool) []GameSummary {
	result := make([]GameSummary, 0, len(ids))
	for index := range ids {
		result = append(result, GameSummary{ID: ids[index], Name: names[index], Slug: slugs[index], HasCover: covers[index]})
	}
	return result
}
