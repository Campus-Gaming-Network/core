package teams

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
		_, _ = pool.Exec(cleanupContext, `DELETE FROM teams WHERE owner_user_id::text = ANY($1)`, userIDs)
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
		VALUES ('Idempotent Team School', $1)
		RETURNING id::text
	`, "idempotent-team-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	for index := range userIDs {
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1, 'hash', 'Idempotent Team Owner', $2::uuid, NOW())
			RETURNING id::text
		`, fmt.Sprintf("idempotent-team-%d-%s@example.test", index, suffix), schoolID).Scan(&userIDs[index]); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	ownerID, otherUserID := userIDs[0], userIDs[1]
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug)
		VALUES ('Idempotent Team Game', $1)
		RETURNING id::text
	`, "idempotent-team-game-"+suffix).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	var key string
	if err := pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&key); err != nil {
		t.Fatalf("generate key: %v", err)
	}

	repository := NewPostgresRepository(pool)
	params := CreateParams{
		CreateInput: CreateInput{
			Name:           "Idempotent Team",
			OwnerUserID:    ownerID,
			GameIDs:        []string{gameID},
			Password:       "TeamPass8",
			IdempotencyKey: key,
		},
		PasswordHash: "hash",
	}
	countTeams := func() int {
		t.Helper()
		var count int
		if err := pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM teams WHERE owner_user_id::text = ANY($1)
		`, userIDs).Scan(&count); err != nil {
			t.Fatalf("count teams: %v", err)
		}
		return count
	}

	created, err := repository.Create(ctx, params)
	if err != nil {
		t.Fatalf("first Create() error = %v", err)
	}
	replayed, err := repository.Create(ctx, params)
	if err != nil {
		t.Fatalf("replayed Create() error = %v", err)
	}
	if !reflect.DeepEqual(replayed, created) {
		t.Fatalf("replayed team = %#v, want %#v", replayed, created)
	}

	otherOwner := params
	otherOwner.OwnerUserID = otherUserID
	if _, err := repository.Create(ctx, otherOwner); !errors.Is(err, ErrIdempotencyKeyReused) {
		t.Fatalf("Create() by another owner error = %v, want %v", err, ErrIdempotencyKeyReused)
	}

	if _, err := pool.Exec(ctx, `UPDATE teams SET deleted_at = NOW() WHERE id = $1::uuid`, created.ID); err != nil {
		t.Fatalf("delete team: %v", err)
	}
	if _, err := repository.Create(ctx, params); !errors.Is(err, ErrIdempotencyKeyReused) {
		t.Fatalf("Create() after deletion error = %v, want %v", err, ErrIdempotencyKeyReused)
	}
	if got := countTeams(); got != 1 {
		t.Fatalf("team rows = %d, want 1", got)
	}
}
