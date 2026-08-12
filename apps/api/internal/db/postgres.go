// Package db provides PostgreSQL connection helpers.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultMaxConns is the pool ceiling when API_DB_MAX_CONNS is unset. Keep the
// total across all API instances comfortably under the Postgres connection
// limit for the plan in use.
const DefaultMaxConns int32 = 10

// Open creates a pool without requiring the database to be reachable yet.
// Readiness performs the first connectivity check so the API can still expose
// liveness while Postgres is starting.
func Open(ctx context.Context, databaseURL string, maxConns int32) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}

	if maxConns < 1 {
		maxConns = DefaultMaxConns
	}
	poolConfig.MaxConns = maxConns
	poolConfig.MinConns = 1

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}

	return pool, nil
}
