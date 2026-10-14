package db

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

// allowedTimestampWithoutTimeZone lists "table.column" names that may be
// timestamp without time zone. It is empty: every instant is stored as
// timestamptz. Add an entry only with a comment saying why the column holds a
// zone-less wall-clock value.
var allowedTimestampWithoutTimeZone = map[string]bool{}

// Runs only when API_DATABASE_URL points at a database. It migrates a schema of
// its own and checks structural rules that every migration must keep.
func TestSchemaInvariants(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "invariants")

	// Postgres does not index referencing columns, so a foreign key with no
	// index leading with its columns forces a sequential scan on every
	// cascade, restrict check, and join.
	unindexed := queryStrings(ctx, t, pool, `
		SELECT c.conrelid::regclass::text || ' (' || c.conname || ')'
		FROM pg_constraint c
		WHERE c.contype = 'f'
		  AND c.connamespace = current_schema()::regnamespace
		  AND NOT EXISTS (
		      SELECT 1
		      FROM pg_index i
		      WHERE i.indrelid = c.conrelid
		        AND i.indisvalid
		        AND (SELECT array_agg(k ORDER BY k)
		             FROM unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) AS k)
		          = (SELECT array_agg(k ORDER BY k) FROM unnest(c.conkey) AS k))
		ORDER BY 1`)
	if len(unindexed) != 0 {
		t.Errorf("foreign keys without a leading index = %v, want none", unindexed)
	}

	noPrimaryKey := queryStrings(ctx, t, pool, `
		SELECT r.relname
		FROM pg_class r
		WHERE r.relkind IN ('r', 'p')
		  AND r.relnamespace = current_schema()::regnamespace
		  AND NOT EXISTS (
		      SELECT 1 FROM pg_constraint WHERE conrelid = r.oid AND contype = 'p')
		ORDER BY 1`)
	if len(noPrimaryKey) != 0 {
		t.Errorf("tables without a primary key = %v, want none", noPrimaryKey)
	}

	var unexpected []string
	for _, column := range queryStrings(ctx, t, pool, `
		SELECT table_name || '.' || column_name
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND data_type = 'timestamp without time zone'
		ORDER BY 1`) {
		if !allowedTimestampWithoutTimeZone[column] {
			unexpected = append(unexpected, column)
		}
	}
	if len(unexpected) != 0 {
		t.Errorf("timestamp without time zone columns = %v, want none", unexpected)
	}
}

func queryStrings(ctx context.Context, t *testing.T, pool *pgxpool.Pool, query string) []string {
	t.Helper()
	rows, err := pool.Query(ctx, query)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	values, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("collect rows: %v", err)
	}
	return values
}
