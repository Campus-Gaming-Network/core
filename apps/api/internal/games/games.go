// Package games provides public catalog reads and named administrative commands.
package games

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Game is a catalog game as the public API shows it.
type Game struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	CoverURL string `json:"cover_url,omitempty"`
	// HasCover reports a stored cover, which the API serves in place of
	// CoverURL.
	HasCover bool `json:"-"`
}

// Repository is the public, read-only view of the game catalog.
type Repository interface {
	List(ctx context.Context) ([]Game, error)
	Search(ctx context.Context, query string, limit int) ([]Game, error)
	GetBySlug(ctx context.Context, slug string) (Game, error)
}

// MaximumSearchQueryLength is the longest name a search accepts, in characters.
const MaximumSearchQueryLength = 100

// DefaultSearchLimit and MaximumSearchLimit bound how many matches a search returns.
const (
	DefaultSearchLimit = 20
	MaximumSearchLimit = 50
)

// PostgresRepository stores the game catalog in Postgres.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

const gameColumns = `id::text, name, slug, COALESCE(cover_url, ''),
	EXISTS(SELECT 1 FROM game_covers WHERE game_covers.game_id = games.id)`

type gameScanner interface {
	Scan(dest ...any) error
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// List returns every active game by name.
func (r *PostgresRepository) List(ctx context.Context) ([]Game, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+gameColumns+`
		FROM games
		WHERE deleted_at IS NULL AND is_active = TRUE
		ORDER BY name, id
	`)
	if err != nil {
		return nil, fmt.Errorf("list games: %w", err)
	}
	return collectGames(rows)
}

// Search lists up to limit active games whose name contains query, ignoring
// case: an exact name first, then names that start with the query, then the
// rest, each by name. The query matches literally; % and _ are not wildcards.
func (r *PostgresRepository) Search(ctx context.Context, query string, limit int) ([]Game, error) {
	query = strings.TrimSpace(query)
	escaped := likeEscaper.Replace(query)
	rows, err := r.pool.Query(ctx, `
		SELECT `+gameColumns+`
		FROM games
		WHERE deleted_at IS NULL AND is_active = TRUE
			AND name ILIKE '%' || $1 || '%' ESCAPE '\'
		ORDER BY lower(name) = lower($2) DESC,
			name ILIKE $1 || '%' ESCAPE '\' DESC,
			name, id
		LIMIT $3
	`, escaped, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search games: %w", err)
	}
	return collectGames(rows)
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func collectGames(rows pgx.Rows) ([]Game, error) {
	defer rows.Close()

	result := make([]Game, 0)
	for rows.Next() {
		game, err := scanGame(rows)
		if err != nil {
			return nil, fmt.Errorf("scan game: %w", err)
		}
		result = append(result, game)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate games: %w", err)
	}
	return result, nil
}

// GetBySlug returns an active game by slug. A hidden or deleted game is not
// found.
func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Game, error) {
	return scanGame(r.pool.QueryRow(ctx, `
		SELECT `+gameColumns+`
		FROM games
		WHERE slug = $1 AND deleted_at IS NULL AND is_active = TRUE
	`, strings.TrimSpace(slug)))
}

func scanGame(scanner gameScanner) (Game, error) {
	var game Game
	if err := scanner.Scan(&game.ID, &game.Name, &game.Slug, &game.CoverURL, &game.HasCover); err != nil {
		return Game{}, err
	}
	return game, nil
}

// MaximumPopularGames is how many games a popular-games list shows.
const MaximumPopularGames = 8

// PopularGame is a catalog game with the number of upcoming public events
// that list it.
type PopularGame struct {
	Game
	UpcomingEvents int `json:"upcoming_events"`
}

// Popular returns up to MaximumPopularGames active games ranked by how many
// public events that have not ended by now list them, most first, then by
// name. A nonempty schoolSlug counts only events that school hosts. A game
// with no such event is left out, so the list may be empty.
func (r *PostgresRepository) Popular(ctx context.Context, schoolSlug string, now time.Time) ([]PopularGame, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+gameColumns+`, counts.upcoming_events
		FROM (
			SELECT eg.game_id, COUNT(*)::int AS upcoming_events
			FROM event_games eg
			JOIN events e ON e.id = eg.event_id
			JOIN schools s ON s.id = e.host_school_id
			WHERE e.deleted_at IS NULL
			  AND e.visibility = 'public'
			  AND e.ends_at > $1
			  AND ($2 = '' OR s.slug = $2)
			GROUP BY eg.game_id
		) counts
		JOIN games ON games.id = counts.game_id
		WHERE games.deleted_at IS NULL AND games.is_active = TRUE
		ORDER BY counts.upcoming_events DESC, games.name, games.id
		LIMIT $3
	`, now, strings.TrimSpace(schoolSlug), MaximumPopularGames)
	if err != nil {
		return nil, fmt.Errorf("list popular games: %w", err)
	}
	defer rows.Close()
	result := []PopularGame{}
	for rows.Next() {
		var game PopularGame
		if err := rows.Scan(&game.ID, &game.Name, &game.Slug, &game.CoverURL, &game.HasCover, &game.UpcomingEvents); err != nil {
			return nil, fmt.Errorf("scan popular game: %w", err)
		}
		result = append(result, game)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate popular games: %w", err)
	}
	return result, nil
}
