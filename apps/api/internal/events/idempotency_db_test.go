package events

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryCreateReplaysIdempotencyKey(t *testing.T) {
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
	var gameID string
	userIDs := make([]string, 2)
	t.Cleanup(func() {
		cleanupContext := context.Background()
		_, _ = pool.Exec(cleanupContext, `
			DELETE FROM events
			WHERE recurrence_parent_id IN (
				SELECT id FROM events WHERE creator_user_id::text = ANY($1)
			)
		`, userIDs)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM events WHERE creator_user_id::text = ANY($1)`, userIDs)
		_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id::text = ANY($1)`, userIDs)
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
		if gameID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM games WHERE id = $1::uuid`, gameID)
		}
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Idempotent Event School', $1)
		RETURNING id::text
	`, "idempotent-event-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	for index := range userIDs {
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1, 'hash', 'Idempotent Event Creator', $2::uuid, NOW())
			RETURNING id::text
		`, fmt.Sprintf("idempotent-event-%d-%s@example.test", index, suffix), schoolID).Scan(&userIDs[index]); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	creatorID, otherUserID := userIDs[0], userIDs[1]
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug)
		VALUES ('Idempotent Event Game', $1)
		RETURNING id::text
	`, "idempotent-event-game-"+suffix).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	startsAt := time.Date(2030, time.April, 2, 19, 0, 0, 0, location)
	repository := NewPostgresRepository(pool)

	for _, testCase := range []struct {
		name            string
		recurrenceRule  string
		recurrenceUntil time.Time
		wantRows        int
	}{
		{name: "single event", wantRows: 1},
		{
			name:            "recurring series",
			recurrenceRule:  RecurrenceWeekly,
			recurrenceUntil: startsAt.AddDate(0, 0, 21),
			wantRows:        4,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var key string
			if err := pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&key); err != nil {
				t.Fatalf("generate key: %v", err)
			}
			input := CreateInput{
				Title:           "Idempotent " + testCase.name,
				CreatorUserID:   creatorID,
				HostSchoolID:    schoolID,
				GameIDs:         []string{gameID},
				Visibility:      VisibilityPublic,
				Format:          FormatOnline,
				Audience:        AudienceOpen,
				StartsAt:        startsAt,
				EndsAt:          startsAt.Add(time.Hour),
				Timezone:        location.String(),
				RecurrenceRule:  testCase.recurrenceRule,
				RecurrenceUntil: testCase.recurrenceUntil,
				IdempotencyKey:  key,
			}
			countRows := func() int {
				t.Helper()
				var count int
				if err := pool.QueryRow(ctx, `
					SELECT COUNT(*) FROM events
					WHERE creator_user_id = $1::uuid AND title = $2
				`, creatorID, input.Title).Scan(&count); err != nil {
					t.Fatalf("count events: %v", err)
				}
				return count
			}

			created, err := repository.Create(ctx, CreateParams{CreateInput: input})
			if err != nil {
				t.Fatalf("first Create() error = %v", err)
			}
			replayed, err := repository.Create(ctx, CreateParams{CreateInput: input})
			if err != nil {
				t.Fatalf("replayed Create() error = %v", err)
			}
			if !reflect.DeepEqual(replayed, created) {
				t.Fatalf("replayed event = %#v, want %#v", replayed, created)
			}
			if got := countRows(); got != testCase.wantRows {
				t.Fatalf("event rows after replay = %d, want %d", got, testCase.wantRows)
			}

			otherCreator := input
			otherCreator.CreatorUserID = otherUserID
			if _, err := repository.Create(ctx, CreateParams{CreateInput: otherCreator}); !errors.Is(err, ErrIdempotencyKeyReused) {
				t.Fatalf("Create() by another creator error = %v, want %v", err, ErrIdempotencyKeyReused)
			}

			if _, err := pool.Exec(ctx, `UPDATE events SET deleted_at = NOW() WHERE id = $1::uuid`, created.ID); err != nil {
				t.Fatalf("cancel event: %v", err)
			}
			if _, err := repository.Create(ctx, CreateParams{CreateInput: input}); !errors.Is(err, ErrIdempotencyKeyReused) {
				t.Fatalf("Create() after cancellation error = %v, want %v", err, ErrIdempotencyKeyReused)
			}
			if got := countRows(); got != testCase.wantRows {
				t.Fatalf("event rows after rejected replays = %d, want %d", got, testCase.wantRows)
			}
		})
	}
}
