// Package dbtest contains PostgreSQL coordination helpers for database-backed
// tests that run in separate Go test processes against the same database.
package dbtest

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// This stable key spells "CGN_ROLE" in ASCII. Session-level advisory locks
// coordinate otherwise independent package test processes.
const siteRoleGrantTestsLockID int64 = 0x43474e5f524f4c45

// LockSiteRoleGrantTests serializes fixtures that create global site-role
// grants. Bootstrap behavior depends on the absence of every active site-admin
// grant, so those fixtures cannot safely overlap while sharing a database.
func LockSiteRoleGrantTests(ctx context.Context, pool *pgxpool.Pool) (func(context.Context) error, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire site-role test lock connection: %w", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, siteRoleGrantTestsLockID); err != nil {
		conn.Release()
		return nil, fmt.Errorf("lock site-role grant tests: %w", err)
	}

	return func(ctx context.Context) error {
		defer conn.Release()
		if _, err := conn.Exec(ctx, `SELECT pg_advisory_unlock($1)`, siteRoleGrantTestsLockID); err != nil {
			return fmt.Errorf("unlock site-role grant tests: %w", err)
		}
		return nil
	}, nil
}
