package metrics

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestMetricsCountsActiveAccountsAndCreatedRecordsByUTCDay(t *testing.T) {
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

	// One record of each kind on each side of a boundary: the window opening on
	// September 22 and UTC midnight between the 20th and the 21st.
	if _, err := pool.Exec(ctx, `
		WITH ada AS (SELECT id FROM users WHERE email = 'ada@example.test'),
		     ben AS (SELECT id FROM users WHERE email = 'ben@example.test'),
		     club AS (
		       INSERT INTO clubs (school_id, name, slug, type) VALUES ($1::uuid, 'Smash Club', 'smash-club', 'student_club')
		       RETURNING id),
		     joined AS (
		       INSERT INTO club_members (club_id, user_id, role, created_at)
		       SELECT club.id, ada.id, 'member', '2026-10-20T23:59:59Z'::timestamptz FROM club, ada
		       UNION ALL SELECT club.id, ben.id, 'owner', '2026-10-21T00:00:00Z'::timestamptz FROM club, ben),
		     event AS (
		       INSERT INTO events (creator_user_id, host_school_id, title, slug, description,
		         visibility, format, starts_at, ends_at, timezone, created_at)
		       SELECT ada.id, $1::uuid, 'LAN Night', 'lan-night', '', 'public', 'online',
		         '2026-11-01T02:00:00Z'::timestamptz, '2026-11-01T05:00:00Z'::timestamptz, 'UTC', '2026-09-22T00:00:00Z'::timestamptz FROM ada
		       RETURNING id),
		     rsvp AS (
		       INSERT INTO event_rsvps (event_id, user_id, response, created_at)
		       SELECT event.id, ben.id, 'yes', '2026-10-21T00:00:00Z'::timestamptz FROM event, ben)
		INSERT INTO teams (owner_user_id, name, slug, password_hash, created_at)
		SELECT id, 'Knights', 'knights', 'hash', '2026-09-21T23:59:59Z'::timestamptz FROM ada`, homeID); err != nil {
		t.Fatalf("insert activity records: %v", err)
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
	for _, counts := range []DayCounts{
		{Day: "2026-09-22", Active: 1, Signups: 1, EventsCreated: 1},
		{Day: "2026-10-14", Active: 1},
		{Day: "2026-10-19", Active: 1},
		{Day: "2026-10-20", Active: 2, Signups: 2, ClubJoins: 1},
		{Day: "2026-10-21", Active: 1, ClubJoins: 1, RSVPs: 1},
	} {
		for index := range days {
			if days[index].Day == counts.Day {
				days[index] = counts
			}
		}
	}

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
