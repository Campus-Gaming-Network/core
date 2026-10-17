package games

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryPopularCountsUpcomingPublicEventsPerGame(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "popular_games")
	now := time.Date(2026, time.October, 17, 12, 0, 0, 0, time.UTC)

	var userID, homeID, otherID string
	if err := pool.QueryRow(ctx, `
		WITH home AS (INSERT INTO schools (name, slug) VALUES ('Home School', 'home-school') RETURNING id),
		     other AS (INSERT INTO schools (name, slug) VALUES ('Other School', 'other-school') RETURNING id),
		     host AS (
		       INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		       SELECT 'host@example.test', 'hash', 'Host', id, NOW() FROM home
		       RETURNING id
		     )
		SELECT host.id::text, home.id::text, other.id::text FROM host, home, other
	`).Scan(&userID, &homeID, &otherID); err != nil {
		t.Fatalf("insert fixtures: %v", err)
	}
	insertGame := func(name, slug string, active bool) Game {
		t.Helper()
		game := Game{Name: name, Slug: slug}
		if err := pool.QueryRow(ctx, `
			INSERT INTO games (name, slug, is_active) VALUES ($1, $2, $3) RETURNING id::text
		`, name, slug, active).Scan(&game.ID); err != nil {
			t.Fatalf("insert game %s: %v", name, err)
		}
		return game
	}
	rocket := insertGame("Rocket League", "rocket-league", true)
	valorant := insertGame("Valorant", "valorant", true)
	chess := insertGame("Chess", "chess", true)
	away := insertGame("Away Game", "away-game", true)
	ended := insertGame("Ended Game", "ended-game", true)
	secret := insertGame("Secret Game", "secret-game", true)
	hidden := insertGame("Hidden Game", "hidden-game", false)

	eventCount := 0
	insertEvent := func(schoolID, visibility string, endsAt time.Time, listed ...Game) {
		t.Helper()
		eventCount++
		var eventID string
		if err := pool.QueryRow(ctx, `
			INSERT INTO events (creator_user_id, host_school_id, title, slug, description,
				visibility, private_password_hash, format, starts_at, ends_at, timezone)
			VALUES ($1::uuid, $2::uuid, $3, $3, '', $4, CASE WHEN $4 = 'private' THEN 'hash' END,
				'online', $5::timestamptz - INTERVAL '1 hour', $5, 'UTC')
			RETURNING id::text
		`, userID, schoolID, "event-"+string(rune('a'+eventCount)), visibility, endsAt).Scan(&eventID); err != nil {
			t.Fatalf("insert event: %v", err)
		}
		for _, game := range listed {
			if _, err := pool.Exec(ctx, `INSERT INTO event_games (event_id, game_id) VALUES ($1::uuid, $2::uuid)`, eventID, game.ID); err != nil {
				t.Fatalf("list game %s: %v", game.Name, err)
			}
		}
	}
	upcoming := now.Add(24 * time.Hour)
	// An event under way has not ended, so it still counts, as it does on the
	// events list the panel links to.
	underWay := now.Add(30 * time.Minute)
	insertEvent(homeID, "public", upcoming, rocket, valorant, chess)
	insertEvent(homeID, "public", upcoming, valorant, chess)
	insertEvent(homeID, "public", underWay, valorant, hidden)
	insertEvent(homeID, "public", now.Add(-time.Hour), ended, chess)
	insertEvent(homeID, "private", upcoming, secret, rocket)
	insertEvent(otherID, "public", upcoming, away)
	insertEvent(otherID, "public", upcoming, away, rocket)

	repository := NewPostgresRepository(pool)
	popular := func(schoolSlug string) []PopularGame {
		t.Helper()
		got, err := repository.Popular(ctx, schoolSlug, now)
		if err != nil {
			t.Fatalf("Popular(%q) error = %v", schoolSlug, err)
		}
		return got
	}
	ranked := func(counts ...any) []PopularGame {
		result := []PopularGame{}
		for index := 0; index < len(counts); index += 2 {
			result = append(result, PopularGame{Game: counts[index].(Game), UpcomingEvents: counts[index+1].(int)})
		}
		return result
	}

	got := map[string][]PopularGame{
		"home":    popular("home-school"),
		"all":     popular(""),
		"unknown": popular("no-such-school"),
	}
	want := map[string][]PopularGame{
		"home":    ranked(valorant, 3, chess, 2, rocket, 1),
		"all":     ranked(valorant, 3, away, 2, chess, 2, rocket, 2),
		"unknown": ranked(),
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Popular() = %+v, want %+v", got, want)
	}
}
