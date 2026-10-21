package maintenance

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5"
)

// Activity days are kept for 13 months, counted in UTC dates up to and
// including the cutoff day.
func TestSweeperPurgesActivityDaysOlderThanThirteenMonths(t *testing.T) {
	pool := dbtest.NewMigratedSchemaPool(t, "activity")
	ctx := context.Background()

	var userID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('Activity School', 'activity-school') RETURNING id)
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		SELECT 'activity@example.test', 'x', 'Activity', id, NOW() FROM school
		RETURNING id::text`).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_activity_days (user_id, day) VALUES
			($1::uuid, '2028-12-14'), ($1::uuid, '2028-12-15'), ($1::uuid, '2030-01-15')`, userID); err != nil {
		t.Fatalf("insert activity days: %v", err)
	}

	sweeper := NewSweeper(pool, nil)
	// Late evening in Los Angeles is already the next UTC day.
	sweeper.now = func() time.Time {
		return time.Date(2030, 1, 14, 20, 0, 0, 0, time.FixedZone("PST", -8*60*60))
	}
	result, err := sweeper.Run(ctx)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if result.ActivityDays != 1 {
		t.Fatalf("deleted %d activity days, want 1", result.ActivityDays)
	}

	rows, err := pool.Query(ctx, `SELECT day::text FROM user_activity_days ORDER BY day`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"2028-12-15", "2030-01-15"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("activity days = %v, want %v", got, want)
	}
}
