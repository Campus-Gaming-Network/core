package teams

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestJoinFindsNoTeamWhenItIsDeletedDuringTheJoin(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool := dbtest.NewSchemaPool(t, "teams")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	insert := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, query+" RETURNING id::text", args...).Scan(&id); err != nil {
			t.Fatalf("insert %q: %v", query, err)
		}
		return id
	}
	schoolID := insert(`INSERT INTO schools (name, slug) VALUES ('Lock School', 'lock-school')`)
	user := func(name string) string {
		return insert(`INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1 || '@example.test', 'hash', $1, $2::uuid, NOW())`, name, schoolID)
	}
	ownerID, joinerID := user("owner"), user("joiner")
	teamID := insert(`INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
		VALUES ($1::uuid, $2::uuid, 'Lock Team', 'lock-team', 'hash')`, ownerID, schoolID)

	// A second connection deletes the team and holds the transaction open.
	deleter, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer deleter.Release()
	var deleterPID int
	if err := deleter.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&deleterPID); err != nil {
		t.Fatal(err)
	}
	deletion, err := deleter.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer deletion.Rollback(ctx)
	if _, err := deletion.Exec(ctx, `UPDATE teams SET deleted_at = NOW() WHERE id = $1::uuid`, teamID); err != nil {
		t.Fatal(err)
	}

	joined := make(chan error, 1)
	go func() {
		_, err := NewPostgresRepository(pool).Join(ctx, "lock-team", joinerID)
		joined <- err
	}()

	// Commit the delete only once the join is waiting on the team row. A join
	// that never waits has raced past the uncommitted delete.
	for {
		select {
		case err := <-joined:
			t.Fatalf("Join() returned %v while the delete was uncommitted, without waiting on the team row", err)
		default:
		}
		var waiting bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)))
		`, deleterPID).Scan(&waiting); err != nil {
			t.Fatalf("wait for the join to block: %v", err)
		}
		if waiting {
			break
		}
	}
	if err := deletion.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	if err := <-joined; !errors.Is(err, ErrTeamNotFound) {
		t.Fatalf("Join() error = %v, want ErrTeamNotFound", err)
	}
	var memberships int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM team_members WHERE team_id = $1::uuid`, teamID).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if memberships != 0 {
		t.Fatalf("memberships = %d, want none", memberships)
	}
}
