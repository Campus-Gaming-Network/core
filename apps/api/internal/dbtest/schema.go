package dbtest

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationsDir is relative to a package directory under apps/api/internal.
const migrationsDir = "../../../../db/migrations"

var schemaSequence atomic.Int64

// NewSchemaPool returns a pool whose tables live in a schema of their own,
// dropped when the test ends. The schema starts empty; the caller migrates it.
// Tests that list rows, count catalog rows, or reference the whole schools and
// games catalog use it so that fixtures other packages write to the shared
// schema at the same time cannot change the result, and so their own fixtures
// cannot change another package's. It skips the test when API_DATABASE_URL is
// not set.
func NewSchemaPool(t *testing.T, prefix string) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}

	ctx := context.Background()
	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(owner.Close)
	schema := pgx.Identifier{fmt.Sprintf("%s_%d_%d", prefix, os.Getpid(), schemaSequence.Add(1))}.Sanitize()
	if _, err := owner.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		if _, err := owner.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Errorf("drop schema: %v", err)
		}
	})
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse database URL: %v", err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect to schema: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// NewMigratedSchemaPool is NewSchemaPool with every migration applied.
func NewMigratedSchemaPool(t *testing.T, prefix string) *pgxpool.Pool {
	t.Helper()
	pool := NewSchemaPool(t, prefix)
	if err := migrate.Run(context.Background(), pool, migrationsDir); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	return pool
}
