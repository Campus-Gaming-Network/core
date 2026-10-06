package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
)

// fakeGameCovers holds one cover, for the slug "rocket-league".
type fakeGameCovers struct{}

func (fakeGameCovers) Cover(_ context.Context, slug, knownETag string) (games.Cover, error) {
	if slug != "rocket-league" {
		return games.Cover{}, games.ErrCoverNotFound
	}
	cover := games.Cover{ContentType: "image/jpeg", ETag: "abc123", Bytes: []byte("cover-bytes")}
	if knownETag == cover.ETag {
		cover.Bytes = nil
	}
	return cover, nil
}

func TestGameCoverServesBytesRevalidatesAndHidesMissingCovers(t *testing.T) {
	router := &Router{mux: http.NewServeMux(), covers: fakeGameCovers{}}
	router.mux.HandleFunc("/games/{slug}/cover", requireMethod(http.MethodGet, router.handleGameCover))
	cached := http.Header{
		"Cache-Control":          {"public, max-age=86400"},
		"Etag":                   {`"abc123"`},
		"X-Content-Type-Options": {"nosniff"},
	}
	withType := cached.Clone()
	withType.Set("Content-Type", "image/jpeg")

	for _, test := range []struct {
		name        string
		path        string
		ifNoneMatch string
		status      int
		header      http.Header
		body        string
	}{
		{name: "first request", path: "/games/rocket-league/cover", status: 200, header: withType, body: "cover-bytes"},
		{name: "current etag", path: "/games/rocket-league/cover", ifNoneMatch: `"abc123"`, status: 304, header: cached},
		{name: "old etag", path: "/games/rocket-league/cover", ifNoneMatch: `"old"`, status: 200, header: withType, body: "cover-bytes"},
		{name: "no cover", path: "/games/hidden-game/cover", status: 404, header: http.Header{"Content-Type": {"application/json"}}, body: "{\"error\":\"game_cover_not_found\"}\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.ifNoneMatch != "" {
				request.Header.Set("If-None-Match", test.ifNoneMatch)
			}
			response := httptest.NewRecorder()
			router.mux.ServeHTTP(response, request)
			if response.Code != test.status || !reflect.DeepEqual(response.Header(), test.header) || response.Body.String() != test.body {
				t.Fatalf("response = %d %v %q, want %d %v %q", response.Code, response.Header(), response.Body.String(), test.status, test.header, test.body)
			}
		})
	}
}
