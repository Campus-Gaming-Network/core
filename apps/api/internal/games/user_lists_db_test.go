package games

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryUserListsAddMoveRemoveAndCapFavorites(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "user_games")

	var userID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('List School', 'list-school') RETURNING id)
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		SELECT 'lister@example.test', 'hash', 'Lister', id, NOW() FROM school
		RETURNING id::text
	`).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	insertGame := func(name, slug string, active, userSubmitted bool) Game {
		t.Helper()
		game := Game{Name: name, Slug: slug}
		if err := pool.QueryRow(ctx, `
			INSERT INTO games (name, slug, is_active, user_submitted) VALUES ($1, $2, $3, $4) RETURNING id::text
		`, name, slug, active, userSubmitted).Scan(&game.ID); err != nil {
			t.Fatalf("insert game %s: %v", name, err)
		}
		return game
	}
	g := make([]Game, 8)
	for index := range g {
		name := string(rune('A' + index))
		g[index] = insertGame("Game "+name, "game-"+string(rune('a'+index)), true, false)
	}
	hidden := insertGame("Hidden Game", "hidden-game", false, false)
	typed := insertGame("Typed Game", "typed-game", false, true)

	repository := NewPostgresRepository(pool)
	ids := func(games ...Game) []string {
		result := make([]string, 0, len(games))
		for _, game := range games {
			result = append(result, game.ID)
		}
		return result
	}
	check := func(step string, want UserLists) {
		t.Helper()
		got, err := repository.UserLists(ctx, userID)
		if err != nil {
			t.Fatalf("%s: UserLists() error = %v", step, err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: lists = %+v, want %+v", step, got, want)
		}
	}
	add := func(list List, games ...Game) error {
		return repository.AddToList(ctx, userID, list, ids(games...))
	}

	check("empty", UserLists{Favorite: []Game{}, Like: []Game{}, WantToPlay: []Game{}})

	if err := add(ListFavorite, g[0], g[1], g[2], g[3], g[4]); err != nil {
		t.Fatalf("add five favorites: %v", err)
	}
	if err := add(ListLike, g[5], g[6]); err != nil {
		t.Fatalf("add liked games: %v", err)
	}
	full := UserLists{Favorite: []Game{g[0], g[1], g[2], g[3], g[4]}, Like: []Game{g[5], g[6]}, WantToPlay: []Game{}}
	check("five favorites", full)

	// A sixth favorite is rejected, even one moving from another list, and a
	// game already a favorite is left in place.
	if err := add(ListFavorite, g[7]); !errors.Is(err, ErrFavoritesFull) {
		t.Fatalf("sixth favorite error = %v, want ErrFavoritesFull", err)
	}
	if err := add(ListFavorite, g[5]); !errors.Is(err, ErrFavoritesFull) {
		t.Fatalf("sixth favorite from another list error = %v, want ErrFavoritesFull", err)
	}
	if err := add(ListFavorite, g[0]); err != nil {
		t.Fatalf("re-add a favorite: %v", err)
	}
	check("favorites full", full)

	// Adding a game that is in another list moves it to the end of this one.
	if err := add(ListWantToPlay, g[0]); err != nil {
		t.Fatalf("move a favorite: %v", err)
	}
	if err := add(ListFavorite, g[5]); err != nil {
		t.Fatalf("move a liked game: %v", err)
	}
	check("moved between lists", UserLists{Favorite: []Game{g[1], g[2], g[3], g[4], g[5]}, Like: []Game{g[6]}, WantToPlay: []Game{g[0]}})

	if err := repository.MoveInList(ctx, userID, g[5].ID, 0); err != nil {
		t.Fatalf("move to the top: %v", err)
	}
	check("moved to the top", UserLists{Favorite: []Game{g[5], g[1], g[2], g[3], g[4]}, Like: []Game{g[6]}, WantToPlay: []Game{g[0]}})
	if err := repository.MoveInList(ctx, userID, g[1].ID, 99); err != nil {
		t.Fatalf("move past the end: %v", err)
	}
	check("moved to the end", UserLists{Favorite: []Game{g[5], g[2], g[3], g[4], g[1]}, Like: []Game{g[6]}, WantToPlay: []Game{g[0]}})

	if err := repository.RemoveFromLists(ctx, userID, g[3].ID); err != nil {
		t.Fatalf("remove a favorite: %v", err)
	}
	if err := repository.RemoveFromLists(ctx, userID, g[3].ID); !errors.Is(err, ErrListedGameNotFound) {
		t.Fatalf("remove an unlisted game error = %v, want ErrListedGameNotFound", err)
	}
	if err := repository.MoveInList(ctx, userID, g[3].ID, 0); !errors.Is(err, ErrListedGameNotFound) {
		t.Fatalf("move an unlisted game error = %v, want ErrListedGameNotFound", err)
	}
	check("removed", UserLists{Favorite: []Game{g[5], g[2], g[4], g[1]}, Like: []Game{g[6]}, WantToPlay: []Game{g[0]}})

	// A hidden game cannot be listed; a game a user typed in can.
	if err := add(ListLike, typed, hidden); !errors.Is(err, ErrGameUnavailable) {
		t.Fatalf("add a hidden game error = %v, want ErrGameUnavailable", err)
	}
	if err := add(ListLike, typed); err != nil {
		t.Fatalf("add a typed game: %v", err)
	}

	// A deleted game leaves every list and frees its place.
	if _, err := pool.Exec(ctx, `UPDATE games SET deleted_at = NOW() WHERE id = $1::uuid`, g[5].ID); err != nil {
		t.Fatalf("delete game: %v", err)
	}
	check("deleted game hidden", UserLists{Favorite: []Game{g[2], g[4], g[1]}, Like: []Game{g[6], typed}, WantToPlay: []Game{g[0]}})
	if err := add(ListFavorite, g[3], g[7]); err != nil {
		t.Fatalf("fill the freed favorite places: %v", err)
	}
	check("deleted game dropped", UserLists{Favorite: []Game{g[2], g[4], g[1], g[3], g[7]}, Like: []Game{g[6], typed}, WantToPlay: []Game{g[0]}})

	var positions []int
	if err := pool.QueryRow(ctx, `
		SELECT ARRAY_AGG(position ORDER BY position) FROM user_games WHERE user_id = $1::uuid AND list = 'favorite'
	`, userID).Scan(&positions); err != nil {
		t.Fatalf("read positions: %v", err)
	}
	if want := []int{0, 1, 2, 3, 4}; !reflect.DeepEqual(positions, want) {
		t.Fatalf("favorite positions = %v, want %v", positions, want)
	}
}
