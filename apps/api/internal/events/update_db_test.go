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

func TestPostgresRepositoryUpdateRetainsDeactivatedGames(t *testing.T) {
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
	var gameIDs []string
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if userID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM events WHERE creator_user_id = $1::uuid`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id = $1::uuid`, userID)
		}
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
		_, _ = pool.Exec(cleanupContext, `DELETE FROM games WHERE id::text = ANY($1)`, gameIDs)
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Retired Game Test School', $1)
		RETURNING id::text
	`, "retired-game-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Retired Game Organizer', $2::uuid, NOW())
		RETURNING id::text
	`, "retired-game-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	games := make([]GameSummary, 2)
	for index, name := range []string{"Retired Game", "Never Chosen Game"} {
		games[index] = GameSummary{Name: name, Slug: fmt.Sprintf("retired-game-%d-%s", index, suffix)}
		if err := pool.QueryRow(ctx, `
			INSERT INTO games (name, slug) VALUES ($1, $2) RETURNING id::text
		`, games[index].Name, games[index].Slug).Scan(&games[index].ID); err != nil {
			t.Fatalf("insert game: %v", err)
		}
		gameIDs = append(gameIDs, games[index].ID)
	}
	retired, neverChosen := games[0], games[1]

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	startsAt := time.Date(2030, time.March, 1, 19, 0, 0, 0, location)
	repository := NewPostgresRepository(pool)
	event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
		Title:         "Retired Game Event",
		CreatorUserID: userID,
		HostSchoolID:  schoolID,
		GameIDs:       []string{retired.ID},
		Visibility:    VisibilityPublic,
		Format:        FormatOnline,
		StartsAt:      startsAt,
		EndsAt:        startsAt.Add(time.Hour),
		Timezone:      location.String(),
	}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE games SET is_active = FALSE WHERE id::text = ANY($1)`, gameIDs); err != nil {
		t.Fatalf("deactivate games: %v", err)
	}

	input := UpdateInput{
		Slug:         event.Slug,
		EditorUserID: userID,
		Title:        "Retitled Retired Game Event",
		HostSchoolID: schoolID,
		GameIDs:      []string{retired.ID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		StartsAt:     startsAt,
		EndsAt:       startsAt.Add(time.Hour),
		Timezone:     location.String(),
	}
	updated, err := repository.Update(ctx, UpdateParams{UpdateInput: input})
	if err != nil {
		t.Fatalf("Update() retaining a deactivated game error = %v", err)
	}
	if want := []GameSummary{retired}; !reflect.DeepEqual(updated.Games, want) {
		t.Fatalf("Update() games = %#v, want %#v", updated.Games, want)
	}

	input.GameIDs = []string{retired.ID, neverChosen.ID}
	if _, err := repository.Update(ctx, UpdateParams{UpdateInput: input}); !errors.Is(err, ErrGameNotFound) {
		t.Fatalf("Update() adding a deactivated game error = %v, want %v", err, ErrGameNotFound)
	}
}
