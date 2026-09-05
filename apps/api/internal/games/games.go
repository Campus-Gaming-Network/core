// Package games provides game catalog reads.
package games

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Game struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	CoverURL string `json:"cover_url,omitempty"`
}

type Repository interface {
	List(ctx context.Context) ([]Game, error)
	GetBySlug(ctx context.Context, slug string) (Game, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

const gameColumns = `id::text, name, slug, COALESCE(cover_url, '')`

type gameScanner interface {
	Scan(dest ...any) error
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) List(ctx context.Context) ([]Game, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+gameColumns+`
		FROM games
		WHERE deleted_at IS NULL
		ORDER BY name, id
	`)
	if err != nil {
		return nil, fmt.Errorf("list games: %w", err)
	}
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

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Game, error) {
	return scanGame(r.pool.QueryRow(ctx, `
		SELECT `+gameColumns+`
		FROM games
		WHERE slug = $1 AND deleted_at IS NULL
	`, strings.TrimSpace(slug)))
}

func scanGame(scanner gameScanner) (Game, error) {
	var game Game
	err := scanner.Scan(&game.ID, &game.Name, &game.Slug, &game.CoverURL)
	if err != nil {
		return Game{}, err
	}
	return game, nil
}
