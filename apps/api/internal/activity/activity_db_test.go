package activity

import (
	"context"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5"
)

func TestPostgresStoreRecordsActiveAccountsOncePerDay(t *testing.T) {
	pool := dbtest.NewMigratedSchemaPool(t, "activity")
	ctx := context.Background()

	var activeID, suspendedID, deletedID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('Activity School', 'activity-school') RETURNING id),
		     account AS (
		       INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, account_status, deleted_at)
		       SELECT a.email, 'x', 'Activity', school.id, NOW(), a.status, a.deleted_at
		       FROM school, (VALUES
		         ('active@example.test', 'active', NULL::timestamptz),
		         ('suspended@example.test', 'suspended', NULL),
		         ('deleted@example.test', 'deleted', NOW())) AS a (email, status, deleted_at)
		       RETURNING id, email)
		SELECT
		  (SELECT id::text FROM account WHERE email = 'active@example.test'),
		  (SELECT id::text FROM account WHERE email = 'suspended@example.test'),
		  (SELECT id::text FROM account WHERE email = 'deleted@example.test')
	`).Scan(&activeID, &suspendedID, &deletedID); err != nil {
		t.Fatalf("insert users: %v", err)
	}

	store := NewPostgresStore(pool)
	for _, write := range []struct{ userID, day string }{
		{activeID, "2026-10-20"},
		{activeID, "2026-10-20"},
		{activeID, "2026-10-21"},
		{suspendedID, "2026-10-20"},
		{deletedID, "2026-10-20"},
	} {
		if err := store.RecordDay(ctx, write.userID, write.day); err != nil {
			t.Fatalf("RecordDay(%s) error = %v", write.day, err)
		}
	}

	rows, err := pool.Query(ctx, `
		SELECT u.email || ' ' || d.day::text
		FROM user_activity_days d JOIN users u ON u.id = d.user_id
		ORDER BY d.day`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"active@example.test 2026-10-20", "active@example.test 2026-10-21"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("activity days = %v, want %v", got, want)
	}
}
