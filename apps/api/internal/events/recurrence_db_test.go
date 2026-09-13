package events

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryCreatesMonthlySeriesFromOriginalLocalAnchor(t *testing.T) {
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	suffix := fmt.Sprint(time.Now().UnixNano())
	var schoolID string
	var userID string
	var gameID string
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if userID != "" {
			_, _ = pool.Exec(cleanupContext, `
				DELETE FROM events
				WHERE recurrence_parent_id IN (
					SELECT id FROM events WHERE creator_user_id = $1::uuid
				)
			`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM events WHERE creator_user_id = $1::uuid`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id = $1::uuid`, userID)
		}
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
		if gameID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM games WHERE id = $1::uuid`, gameID)
		}
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Recurrence Test School', $1)
		RETURNING id::text
	`, "recurrence-test-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Recurrence Test Creator', $2::uuid, NOW())
		RETURNING id::text
	`, "recurrence-test-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug)
		VALUES ('Recurrence Test Game', $1)
		RETURNING id::text
	`, "recurrence-test-game-"+suffix).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	startsAt := time.Date(2028, time.January, 31, 19, 0, 0, 0, location)
	endsAt := startsAt.Add(90 * time.Minute)
	recurrenceUntil := time.Date(2029, time.January, 31, 23, 59, 59, int(time.Second-time.Nanosecond), location)

	repository := NewPostgresRepository(pool)
	event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
		Title:           "Monthly Anchor Test",
		CreatorUserID:   userID,
		HostSchoolID:    schoolID,
		GameIDs:         []string{gameID},
		Visibility:      VisibilityPublic,
		Format:          FormatOnline,
		StartsAt:        startsAt,
		EndsAt:          endsAt,
		Timezone:        location.String(),
		RecurrenceRule:  RecurrenceMonthly,
		RecurrenceUntil: recurrenceUntil,
	}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	rows, err := pool.Query(ctx, `
		SELECT starts_at, ends_at, timezone
		FROM events
		WHERE id = $1::uuid OR recurrence_parent_id = $1::uuid
		ORDER BY starts_at
	`, event.ID)
	if err != nil {
		t.Fatalf("query series: %v", err)
	}
	defer rows.Close()

	wantDays := []int{31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31}
	index := 0
	for rows.Next() {
		var start time.Time
		var end time.Time
		var timezone string
		if err := rows.Scan(&start, &end, &timezone); err != nil {
			t.Fatalf("scan series occurrence: %v", err)
		}
		if index >= len(wantDays) {
			t.Fatalf("series has more than %d occurrences", len(wantDays))
		}

		local := start.In(location)
		wantMonth := time.Month(index%12 + 1)
		wantYear := 2028 + index/12
		if local.Year() != wantYear || local.Month() != wantMonth || local.Day() != wantDays[index] || local.Hour() != 19 {
			t.Fatalf("occurrence %d local start = %s, want %04d-%02d-%02d 19:00", index, local, wantYear, wantMonth, wantDays[index])
		}
		if timezone != location.String() {
			t.Fatalf("occurrence %d timezone = %q, want %q", index, timezone, location.String())
		}
		if end.Sub(start) != 90*time.Minute {
			t.Fatalf("occurrence %d duration = %s, want 90m", index, end.Sub(start))
		}
		index++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate series: %v", err)
	}
	if index != len(wantDays) {
		t.Fatalf("series occurrence count = %d, want %d", index, len(wantDays))
	}
}
