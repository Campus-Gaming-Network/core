package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
)

type fakePopularGames struct {
	schoolSlug string
	result     []games.PopularGame
}

func (f *fakePopularGames) Popular(_ context.Context, schoolSlug string, _ time.Time) ([]games.PopularGame, error) {
	f.schoolSlug = schoolSlug
	return f.result, nil
}

func TestPopularGamesPassesTheSchoolAndServesCoversFromTheSite(t *testing.T) {
	store := &fakePopularGames{result: []games.PopularGame{
		{Game: games.Game{ID: "game-1", Name: "Rocket League", Slug: "rocket-league", HasCover: true}, UpcomingEvents: 3},
		{Game: games.Game{ID: "game-2", Name: "Chess", Slug: "chess"}, UpcomingEvents: 1},
	}}
	router := &Router{cfg: config.Config{SiteURL: "https://cgn.example"}, popularGames: store}
	response := httptest.NewRecorder()
	router.handlePopularGames(response, httptest.NewRequest(http.MethodGet, "/popular-games?school=home-school", nil))

	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := map[string]any{"status": response.Code, "school": store.schoolSlug, "body": body}
	want := map[string]any{
		"status": http.StatusOK,
		"school": "home-school",
		"body": map[string]any{"games": []any{
			map[string]any{"id": "game-1", "name": "Rocket League", "slug": "rocket-league", "cover_url": "https://cgn.example/api/games/rocket-league/cover", "upcoming_events": float64(3)},
			map[string]any{"id": "game-2", "name": "Chess", "slug": "chess", "upcoming_events": float64(1)},
		}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("response = %#v, want %#v", got, want)
	}
}
