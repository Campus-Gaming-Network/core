package metrics

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestMetricsCountsActiveAccountsAndSignupsByUTCDay(t *testing.T) {
	pool := dbtest.NewMigratedSchemaPool(t, "metrics")
	ctx := context.Background()

	var homeID, awayID string
	if err := pool.QueryRow(ctx, `
		WITH home AS (INSERT INTO schools (name, slug) VALUES ('Home U', 'home-u') RETURNING id),
		     away AS (INSERT INTO schools (name, slug) VALUES ('Away U', 'away-u') RETURNING id)
		SELECT home.id::text, away.id::text FROM home, away`).Scan(&homeID, &awayID); err != nil {
		t.Fatalf("insert schools: %v", err)
	}
	// Ada and Ben signed up at either end of one UTC day. The 30-day window
	// as of the 21st opens on September 22: Cy signed up just before it and
	// Di as it opened.
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, created_at) VALUES
			('ada@example.test', 'x', 'Ada', $1::uuid, NOW(), '2026-10-20T23:30:00Z'),
			('ben@example.test', 'x', 'Ben', $1::uuid, NOW(), '2026-10-20T00:00:00Z'),
			('cy@example.test', 'x', 'Cy', $2::uuid, NOW(), '2026-09-21T23:59:59Z'),
			('di@example.test', 'x', 'Di', $2::uuid, NOW(), '2026-09-22T00:00:00Z')`, homeID, awayID); err != nil {
		t.Fatalf("insert users: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_activity_days (user_id, day)
		SELECT u.id, a.day::date FROM users u JOIN (VALUES
			('ada@example.test', '2026-10-20'),
			('ada@example.test', '2026-10-19'),
			('ben@example.test', '2026-10-20'),
			('cy@example.test', '2026-10-14'),
			('cy@example.test', '2026-09-21'),
			('di@example.test', '2026-09-22'),
			('di@example.test', '2026-10-21')) AS a (email, day) ON a.email = u.email`); err != nil {
		t.Fatalf("insert activity days: %v", err)
	}

	// 17:00 in Los Angeles on the 20th is midnight on the 21st in UTC, so the
	// as-of day is the 21st.
	got, err := NewPostgresRepository(pool).Metrics(ctx, time.Date(2026, 10, 20, 17, 0, 0, 0, time.FixedZone("PDT", -7*60*60)))
	if err != nil {
		t.Fatalf("Metrics() error = %v", err)
	}

	days := make([]DayCounts, 0, TrendDays)
	for day := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC); !day.Before(time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC)); day = day.AddDate(0, 0, -1) {
		days = append(days, DayCounts{Day: day.Format(time.DateOnly)})
	}
	set := func(day string, active, signups int) {
		for index := range days {
			if days[index].Day == day {
				days[index].Active, days[index].Signups = active, signups
			}
		}
	}
	set("2026-09-22", 1, 1)
	set("2026-10-14", 1, 0)
	set("2026-10-19", 1, 0)
	set("2026-10-20", 2, 2)
	set("2026-10-21", 1, 0)

	want := Metrics{
		AsOf:   "2026-10-21",
		Active: ActiveCounts{Day: 1, Week: 3, Month: 4},
		Days:   days,
		Schools: []SchoolCount{
			{ID: awayID, Name: "Away U", Active: 2},
			{ID: homeID, Name: "Home U", Active: 2},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Metrics() =\n%+v\nwant\n%+v", got, want)
	}
}
