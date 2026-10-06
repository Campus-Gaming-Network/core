package igdb

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

// jpeg is the smallest byte sequence http.DetectContentType reads as a JPEG.
var jpeg = []byte{0xFF, 0xD8, 0xFF, 0xE0}

// fakeIGDB serves the token, game, and image endpoints from one test server.
type fakeIGDB struct {
	server *httptest.Server
	// tokens counts issued tokens; each token is "token-<n>".
	tokens int
	// rejected is a token the game endpoint answers with 401.
	rejected string
	// gameStatus overrides the game endpoint's status when set.
	gameStatus int
	queries    []string
	cover      []byte
}

func newFakeIGDB(t *testing.T) (*fakeIGDB, Config) {
	t.Helper()
	fake := &fakeIGDB{cover: jpeg}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, req *http.Request) {
		if req.FormValue("client_id") != "client" || req.FormValue("client_secret") != "secret" || req.FormValue("grant_type") != "client_credentials" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		fake.tokens++
		fmt.Fprintf(w, `{"access_token":"token-%d","expires_in":3600}`, fake.tokens)
	})
	mux.HandleFunc("POST /v4/games", func(w http.ResponseWriter, req *http.Request) {
		token := req.Header.Get("Authorization")
		if req.Header.Get("Client-ID") != "client" || token == "Bearer "+fake.rejected {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if fake.gameStatus != 0 {
			w.WriteHeader(fake.gameStatus)
			return
		}
		query, _ := io.ReadAll(req.Body)
		fake.queries = append(fake.queries, string(query))
		io.WriteString(w, `[{"id":11198,"name":"Rocket League","slug":"rocket-league","cover":{"id":1,"image_id":"co5w0w"},"first_release_date":1436227200},{"id":7,"name":"No Cover","slug":"no-cover","themes":[{"id":1,"slug":"action"}]},{"id":8,"name":"Adults Only","slug":"adults-only","themes":[{"id":1,"slug":"action"},{"id":42,"slug":"erotic"}]}]`)
	})
	mux.HandleFunc("GET /images/t_cover_big/{file}", func(w http.ResponseWriter, req *http.Request) {
		w.Write(fake.cover)
	})
	fake.server = httptest.NewServer(mux)
	t.Cleanup(fake.server.Close)
	return fake, Config{
		ClientID: "client", ClientSecret: "secret",
		APIURL: fake.server.URL + "/v4", TokenURL: fake.server.URL + "/token", ImageURL: fake.server.URL + "/images",
	}
}

func TestSearchDecodesGamesEscapesTheQueryAndDropsAdultGames(t *testing.T) {
	fake, config := newFakeIGDB(t)
	games, err := NewClient(config).Search(t.Context(), ` rocket "league" `)
	if err != nil {
		t.Fatal(err)
	}
	want := []Game{
		{ID: 11198, Name: "Rocket League", Slug: "rocket-league", CoverImageID: "co5w0w", ReleaseYear: 2015},
		{ID: 7, Name: "No Cover", Slug: "no-cover"},
	}
	if !reflect.DeepEqual(games, want) {
		t.Fatalf("games = %+v, want %+v", games, want)
	}
	wantQueries := []string{`search "rocket \"league\""; fields name,slug,cover.image_id,first_release_date,themes.slug; limit 20;`}
	if !reflect.DeepEqual(fake.queries, wantQueries) {
		t.Fatalf("queries = %q, want %q", fake.queries, wantQueries)
	}
}

func TestTokenIsReusedUntilItNearsExpiryOrIsRejected(t *testing.T) {
	fake, config := newFakeIGDB(t)
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	config.Now = func() time.Time { return now }
	client := NewClient(config)

	for range 2 {
		if _, err := client.Game(t.Context(), 11198); err != nil {
			t.Fatal(err)
		}
	}
	if fake.tokens != 1 {
		t.Fatalf("tokens issued after two calls = %d, want 1", fake.tokens)
	}

	// The fake's tokens last an hour; inside the refresh margin a new one is fetched.
	now = now.Add(time.Hour - time.Minute)
	if _, err := client.Game(t.Context(), 11198); err != nil {
		t.Fatal(err)
	}
	if fake.tokens != 2 {
		t.Fatalf("tokens issued near expiry = %d, want 2", fake.tokens)
	}

	// A token revoked early is replaced once and the query retried.
	fake.rejected = "token-2"
	if _, err := client.Game(t.Context(), 11198); err != nil {
		t.Fatal(err)
	}
	if fake.tokens != 3 {
		t.Fatalf("tokens issued after a 401 = %d, want 3", fake.tokens)
	}
}

func TestUpstreamStatusesBecomeTypedErrors(t *testing.T) {
	for status, want := range map[int]error{
		http.StatusTooManyRequests:     ErrRateLimited,
		http.StatusInternalServerError: ErrUnavailable,
	} {
		fake, config := newFakeIGDB(t)
		fake.gameStatus = status
		if _, err := NewClient(config).Search(t.Context(), "rocket"); !errors.Is(err, want) {
			t.Errorf("status %d: error = %v, want %v", status, err, want)
		}
	}
}

func TestCoverAcceptsOnlySmallImages(t *testing.T) {
	fake, config := newFakeIGDB(t)
	client := NewClient(config)

	cover, err := client.Cover(t.Context(), "co5w0w")
	if err != nil {
		t.Fatal(err)
	}
	if want := (Cover{ImageID: "co5w0w", ContentType: "image/jpeg", Bytes: jpeg}); !reflect.DeepEqual(cover, want) {
		t.Fatalf("cover = %+v, want %+v", cover, want)
	}

	fake.cover = append(bytes.Clone(jpeg), make([]byte, MaxCoverBytes)...)
	if _, err := client.Cover(t.Context(), "co5w0w"); !errors.Is(err, ErrCoverTooLarge) {
		t.Fatalf("oversize cover: error = %v, want %v", err, ErrCoverTooLarge)
	}

	fake.cover = []byte("<html>not an image</html>")
	if _, err := client.Cover(t.Context(), "co5w0w"); !errors.Is(err, ErrCoverUnsupported) {
		t.Fatalf("html cover: error = %v, want %v", err, ErrCoverUnsupported)
	}

	if _, err := client.Cover(t.Context(), "../secret"); !errors.Is(err, ErrCoverUnsupported) {
		t.Fatalf("path-like image id: error = %v, want %v", err, ErrCoverUnsupported)
	}
}
