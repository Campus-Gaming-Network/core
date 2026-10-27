// Package db provides PostgreSQL connection helpers.
package db

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultMaxConns is the pool ceiling when API_DB_MAX_CONNS is unset. Keep the
// total across all API instances comfortably under the Postgres connection
// limit for the plan in use.
const DefaultMaxConns int32 = 10

// Options tunes the connection pool. Zero values keep the pgx defaults, except
// MaxConns, which falls back to DefaultMaxConns.
type Options struct {
	MaxConns int32
	// MaxConnLifetime recycles connections so a failover or a proxy that
	// drops long-lived sockets does not leave dead ones in the pool.
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
	// StatementTimeout makes Postgres cancel any statement that runs longer.
	// Leave it zero for migrations and seeds, which run long statements.
	StatementTimeout time.Duration
}

// Open creates a pool without requiring the database to be reachable yet.
// Readiness performs the first connectivity check so the API can still expose
// liveness while Postgres is starting.
func Open(ctx context.Context, databaseURL string, options Options) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}

	if options.MaxConns < 1 {
		options.MaxConns = DefaultMaxConns
	}
	poolConfig.MaxConns = options.MaxConns
	poolConfig.MinConns = 1
	if options.MaxConnLifetime > 0 {
		poolConfig.MaxConnLifetime = options.MaxConnLifetime
	}
	if options.MaxConnIdleTime > 0 {
		poolConfig.MaxConnIdleTime = options.MaxConnIdleTime
	}
	if options.StatementTimeout > 0 {
		poolConfig.ConnConfig.RuntimeParams["statement_timeout"] =
			strconv.FormatInt(options.StatementTimeout.Milliseconds(), 10)
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}

	return pool, nil
}
