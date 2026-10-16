package games

import (
	"context"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositorySearchRanksExactThenPrefixAndMatchesLiterally(t *testing.T) {
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

	// Names no real game has, removed again when the test ends.
	fixtures := []struct {
		name   string
		slug   string
		active bool
	}{
		{"Super Qxzv Arena", "search-test-super-qxzv-arena", true},
		{"Qxzv Arena Deluxe", "search-test-qxzv-arena-deluxe", true},
		{"Qxzv Arena", "search-test-qxzv-arena", true},
		{"Qxzv_Arena", "search-test-qxzv-underscore-arena", true},
		{"Qxzv Arena Hidden", "search-test-qxzv-arena-hidden", false},
	}
	slugs := make([]string, 0, len(fixtures))
	for _, fixture := range fixtures {
		slugs = append(slugs, fixture.slug)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM games WHERE slug = ANY($1)`, slugs); err != nil {
			t.Errorf("remove fixtures: %v", err)
		}
	})
	for _, fixture := range fixtures {
		if _, err := pool.Exec(ctx, `INSERT INTO games (name, slug, is_active) VALUES ($1, $2, $3)`, fixture.name, fixture.slug, fixture.active); err != nil {
			t.Fatalf("insert %s: %v", fixture.name, err)
		}
	}

	repository := NewPostgresRepository(pool)
	names := func(query string, limit int) []string {
		t.Helper()
		found, err := repository.Search(ctx, query, limit)
		if err != nil {
			t.Fatalf("Search(%q) error = %v", query, err)
		}
		result := make([]string, 0, len(found))
		for _, game := range found {
			result = append(result, game.Name)
		}
		return result
	}

	if got, want := names(" qxzv arena ", 10), []string{"Qxzv Arena", "Qxzv Arena Deluxe", "Super Qxzv Arena"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Search(qxzv arena) = %v, want %v", got, want)
	}
	if got, want := names("qxzv_", 10), []string{"Qxzv_Arena"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Search(qxzv_) = %v, want %v", got, want)
	}
	if got, want := names("qxzv arena", 1), []string{"Qxzv Arena"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Search(qxzv arena, limit 1) = %v, want %v", got, want)
	}
}
