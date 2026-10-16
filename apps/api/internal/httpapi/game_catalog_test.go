package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/jackc/pgx/v5"
)

// fakeGameCatalog holds Rocket League, with a stored cover, and records the
// last search it was asked for.
type fakeGameCatalog struct {
	query string
	limit int
}

var fakeRocketLeague = games.Game{ID: "game-1", Name: "Rocket League", Slug: "rocket-league", CoverURL: "https://images.igdb.com/rl.jpg", HasCover: true}

func (*fakeGameCatalog) List(context.Context) ([]games.Game, error) {
	return []games.Game{fakeRocketLeague}, nil
}

func (catalog *fakeGameCatalog) Search(_ context.Context, query string, limit int) ([]games.Game, error) {
	catalog.query, catalog.limit = query, limit
	return []games.Game{fakeRocketLeague}, nil
}

func (*fakeGameCatalog) GetBySlug(_ context.Context, slug string) (games.Game, error) {
	if slug != fakeRocketLeague.Slug {
		return games.Game{}, pgx.ErrNoRows
	}
	return fakeRocketLeague, nil
}

func TestGamesSearchesByNameAndLooksUpOneGame(t *testing.T) {
	const siteCover = `"cover_url":"https://cgn.example/api/games/rocket-league/cover"`
	const rocketLeague = `{"id":"game-1","name":"Rocket League","slug":"rocket-league",` + siteCover + `}`
	for _, test := range []struct {
		name      string
		path      string
		status    int
		body      string
		wantQuery string
		wantLimit int
	}{
		{name: "whole catalog", path: "/games", status: 200, body: `{"games":[` + rocketLeague + `]}`},
		{name: "search with the default limit", path: "/games?q=+rocket+", status: 200, body: `{"games":[` + rocketLeague + `]}`, wantQuery: "rocket", wantLimit: games.DefaultSearchLimit},
		{name: "search with a limit", path: "/games?q=rocket&limit=5", status: 200, body: `{"games":[` + rocketLeague + `]}`, wantQuery: "rocket", wantLimit: 5},
		{name: "empty query", path: "/games?q=+", status: 400, body: `{"error":"invalid_game_query"}`},
		{name: "long query", path: "/games?q=" + strings.Repeat("a", 101), status: 400, body: `{"error":"invalid_game_query"}`},
		{name: "limit over the maximum", path: "/games?q=rocket&limit=51", status: 400, body: `{"error":"invalid_limit"}`},
		{name: "one game", path: "/games/rocket-league", status: 200, body: rocketLeague},
		{name: "missing game", path: "/games/missing-game", status: 404, body: `{"error":"game_not_found"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			catalog := &fakeGameCatalog{}
			router := &Router{mux: http.NewServeMux(), games: catalog, cfg: config.Config{SiteURL: "https://cgn.example/"}}
			router.mux.HandleFunc("/games", requireMethod(http.MethodGet, router.handleGames))
			router.mux.HandleFunc("/games/{slug}", requireMethod(http.MethodGet, router.handleGame))
			response := httptest.NewRecorder()
			router.mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.status || response.Body.String() != test.body+"\n" {
				t.Fatalf("response = %d %q, want %d %q", response.Code, response.Body.String(), test.status, test.body)
			}
			if catalog.query != test.wantQuery || catalog.limit != test.wantLimit {
				t.Fatalf("search = %q %d, want %q %d", catalog.query, catalog.limit, test.wantQuery, test.wantLimit)
			}
		})
	}
}
