package adminhttp

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
)

const fakeRocketLeagueID = 11198

// fakeJPEG and fakePNG are the shortest bodies read as each image type.
var (
	fakeJPEG = []byte{0xFF, 0xD8, 0xFF, 0xE0}
	fakePNG  = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
)

type fakeIGDBGame struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Cover *struct {
		ImageID string `json:"image_id"`
	} `json:"cover,omitempty"`
}

// fakeIGDB is an in-process IGDB: the token, game, and image endpoints the
// real client calls. Tests change games and images to model IGDB changing.
type fakeIGDB struct {
	client *igdb.Client
	games  []fakeIGDBGame
	images map[string][]byte
	// downloads counts cover requests by image ID.
	downloads map[string]int
	// status overrides the game endpoint's status when set.
	status int
}

var fakeIGDBGameID = regexp.MustCompile(`where id = (\d+);`)

func newFakeIGDB(t *testing.T) *fakeIGDB {
	t.Helper()
	fake := &fakeIGDB{
		games:     []fakeIGDBGame{{ID: fakeRocketLeagueID, Name: "Rocket League", Slug: "rocket-league"}, {ID: 7, Name: "Coverless: The Game!", Slug: "Not A Slug"}},
		images:    map[string][]byte{"co1": fakeJPEG, "co2": fakePNG},
		downloads: map[string]int{},
	}
	fake.setCover(fakeRocketLeagueID, "co1")
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, req *http.Request) {
		io.WriteString(w, `{"access_token":"fake-token","expires_in":3600}`)
	})
	mux.HandleFunc("POST /v4/games", func(w http.ResponseWriter, req *http.Request) {
		if fake.status != 0 {
			w.WriteHeader(fake.status)
			return
		}
		query, _ := io.ReadAll(req.Body)
		matches := []fakeIGDBGame{}
		for _, game := range fake.games {
			if id := fakeIGDBGameID.FindSubmatch(query); id != nil {
				if string(id[1]) == strconv.FormatInt(game.ID, 10) {
					matches = append(matches, game)
				}
			} else if strings.Contains(strings.ToLower(string(query)), strings.ToLower(`search "`+game.Name[:4])) {
				matches = append(matches, game)
			}
		}
		json.NewEncoder(w).Encode(matches)
	})
	mux.HandleFunc("GET /images/t_cover_big/{file}", func(w http.ResponseWriter, req *http.Request) {
		imageID := strings.TrimSuffix(req.PathValue("file"), ".jpg")
		fake.downloads[imageID]++
		w.Write(fake.images[imageID])
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	fake.client = igdb.NewClient(igdb.Config{
		ClientID: "client", ClientSecret: "secret",
		APIURL: server.URL + "/v4", TokenURL: server.URL + "/token", ImageURL: server.URL + "/images",
	})
	return fake
}

func (fake *fakeIGDB) setCover(gameID int64, imageID string) {
	for index := range fake.games {
		if fake.games[index].ID == gameID {
			fake.games[index].Cover = &struct {
				ImageID string `json:"image_id"`
			}{imageID}
		}
	}
}

func (f catalogFixture) importGame(t *testing.T, igdbID int64) games.AdminGame {
	t.Helper()
	return decodeCatalog[games.AdminGame](t, f.request(t, "POST", "/admin/v1/game-imports", games.IGDBImport{Command: f.command, IGDBID: igdbID}, 201))
}

func (f catalogFixture) errorCode(t *testing.T, method, path string, input any, status int) string {
	t.Helper()
	return decodeCatalog[struct {
		Error string `json:"error"`
	}](t, f.request(t, method, path, input, status)).Error
}

func TestIGDBImportCreatesAnInactiveGameWithItsCover(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()

	type searchPage struct {
		Games []games.IGDBResult `json:"games"`
	}
	found := decodeCatalog[searchPage](t, f.request(t, "GET", "/admin/v1/igdb-games?q=rocket", nil, 200))
	if want := (searchPage{Games: []games.IGDBResult{{IGDBID: fakeRocketLeagueID, Name: "Rocket League"}}}); !reflect.DeepEqual(found, want) {
		t.Fatalf("search = %+v, want %+v", found, want)
	}

	game := f.importGame(t, fakeRocketLeagueID)
	igdbID := int64(fakeRocketLeagueID)
	want := games.AdminGame{
		Game:      games.Game{ID: game.ID, Name: "Rocket League", Slug: "rocket-league"},
		CreatedAt: game.CreatedAt, UpdatedAt: game.UpdatedAt,
		IGDBID: &igdbID, LastSyncedAt: game.LastSyncedAt, HasCover: true,
	}
	if !reflect.DeepEqual(game, want) || game.LastSyncedAt == nil {
		t.Fatalf("imported game = %+v, want %+v with a sync time", game, want)
	}

	// A second import returns the existing game and creates nothing.
	repeat := decodeCatalog[struct {
		Error   string          `json:"error"`
		Current games.AdminGame `json:"current"`
	}](t, f.request(t, "POST", "/admin/v1/game-imports", games.IGDBImport{Command: f.command, IGDBID: fakeRocketLeagueID}, 409))
	if repeat.Error != "game_already_imported" || !reflect.DeepEqual(repeat.Current, game) {
		t.Fatalf("repeat import = %+v, want the existing game", repeat)
	}
	found = decodeCatalog[searchPage](t, f.request(t, "GET", "/admin/v1/igdb-games?q=rocket", nil, 200))
	if want := (searchPage{Games: []games.IGDBResult{{IGDBID: fakeRocketLeagueID, Name: "Rocket League", GameID: game.ID}}}); !reflect.DeepEqual(found, want) {
		t.Fatalf("search after import = %+v, want %+v", found, want)
	}

	// An admin can review the cover before the game is public.
	type adminCover struct {
		ContentType string `json:"content_type"`
		Data        []byte `json:"data"`
	}
	reviewed := decodeCatalog[adminCover](t, f.request(t, "GET", "/admin/v1/games/"+game.ID+"/cover", nil, 200))
	if want := (adminCover{ContentType: "image/jpeg", Data: fakeJPEG}); !reflect.DeepEqual(reviewed, want) {
		t.Fatalf("admin cover = %+v, want %+v", reviewed, want)
	}
	if _, err := f.game.Cover(ctx, game.Slug, ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("public cover of an inactive game: error = %v, want %v", err, games.ErrCoverNotFound)
	}
	f.request(t, "PATCH", "/admin/v1/games/"+game.ID, games.AdminEdit{Command: f.versioned(game.UpdatedAt), Name: game.Name, Slug: game.Slug, IsActive: true}, 200)
	cover, err := f.game.Cover(ctx, game.Slug, "")
	if err != nil {
		t.Fatal(err)
	}
	if want := (games.Cover{ContentType: "image/jpeg", ETag: cover.ETag, Bytes: fakeJPEG}); !reflect.DeepEqual(cover, want) || cover.ETag == "" {
		t.Fatalf("public cover = %+v, want %+v with an ETag", cover, want)
	}
	revalidated, err := f.game.Cover(ctx, game.Slug, cover.ETag)
	if err != nil {
		t.Fatal(err)
	}
	if want := (games.Cover{ContentType: "image/jpeg", ETag: cover.ETag}); !reflect.DeepEqual(revalidated, want) {
		t.Fatalf("revalidated cover = %+v, want %+v", revalidated, want)
	}
}

func TestIGDBImportDerivesAFreeSlugAndAllowsNoCover(t *testing.T) {
	f := newCatalogFixture(t)
	if _, err := f.game.CreateAdmin(t.Context(), games.AdminEdit{Command: f.command, Name: "Rocket League (manual)", Slug: "rocket-league", IsActive: true}); err != nil {
		t.Fatal(err)
	}
	if game := f.importGame(t, fakeRocketLeagueID); game.Slug != "rocket-league-2" {
		t.Fatalf("slug beside a taken one = %q, want rocket-league-2", game.Slug)
	}
	// IGDB's slug is unusable here, so one is made from the name.
	coverless := f.importGame(t, 7)
	if coverless.Slug != "coverless-the-game" || coverless.HasCover {
		t.Fatalf("coverless import = slug %q, has cover %t", coverless.Slug, coverless.HasCover)
	}
}

func TestIGDBFailuresImportNothing(t *testing.T) {
	f := newCatalogFixture(t)
	importInput := games.IGDBImport{Command: f.command, IGDBID: fakeRocketLeagueID}

	f.igdb.images["co1"] = []byte("<html>not an image</html>")
	if code := f.errorCode(t, "POST", "/admin/v1/game-imports", importInput, 422); code != "igdb_cover_unusable" {
		t.Fatalf("unusable cover: error = %q", code)
	}
	if code := f.errorCode(t, "POST", "/admin/v1/game-imports", games.IGDBImport{Command: f.command, IGDBID: 404}, 404); code != "igdb_game_not_found" {
		t.Fatalf("unknown IGDB game: error = %q", code)
	}
	for status, want := range map[int]struct {
		status int
		code   string
	}{
		http.StatusTooManyRequests:     {503, "igdb_rate_limited"},
		http.StatusInternalServerError: {502, "igdb_unavailable"},
	} {
		f.igdb.status = status
		if code := f.errorCode(t, "POST", "/admin/v1/game-imports", importInput, want.status); code != want.code {
			t.Fatalf("IGDB status %d on import: error = %q, want %q", status, code, want.code)
		}
		if code := f.errorCode(t, "GET", "/admin/v1/igdb-games?q=rocket", nil, want.status); code != want.code {
			t.Fatalf("IGDB status %d on search: error = %q, want %q", status, code, want.code)
		}
	}
	f.handler.dependencies.Catalog.IGDB = nil
	for _, request := range []mutationRequest{
		{"GET", "/admin/v1/igdb-games?q=rocket", nil},
		{"POST", "/admin/v1/game-imports", importInput},
	} {
		if code := f.errorCode(t, request.method, request.path, request.body, 503); code != "igdb_not_configured" {
			t.Fatalf("%s without credentials: error = %q", request.path, code)
		}
	}

	var stored int
	if err := f.pool.QueryRow(t.Context(), `SELECT (SELECT COUNT(*) FROM games) + (SELECT COUNT(*) FROM game_covers)`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 0 {
		t.Fatalf("failed imports left %d rows behind", stored)
	}
}

func TestIGDBRefreshKeepsAdminEditsAndReplacesAChangedCover(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	imported := f.importGame(t, fakeRocketLeagueID)
	edited := decodeCatalog[games.AdminGame](t, f.request(t, "PATCH", "/admin/v1/games/"+imported.ID,
		games.AdminEdit{Command: f.versioned(imported.UpdatedAt), Name: "RL (campus rules)", Slug: "rl-campus", IsActive: true}, 200))
	path := "/admin/v1/games/" + imported.ID + "/refresh"

	// IGDB renames the game but keeps its cover.
	f.igdb.games[0].Name, f.igdb.games[0].Slug = "Rocket League Renamed", "rocket-league-renamed"
	refreshed := decodeCatalog[games.AdminGame](t, f.request(t, "POST", path, f.versioned(edited.UpdatedAt), 200))
	want := edited
	want.UpdatedAt, want.LastSyncedAt = refreshed.UpdatedAt, refreshed.LastSyncedAt
	if !reflect.DeepEqual(refreshed, want) || !refreshed.LastSyncedAt.After(*edited.LastSyncedAt) || !refreshed.UpdatedAt.After(edited.UpdatedAt) {
		t.Fatalf("refreshed game = %+v, want %+v with later sync and version times", refreshed, want)
	}

	// A new IGDB image replaces the stored cover.
	f.igdb.setCover(fakeRocketLeagueID, "co2")
	refreshed = decodeCatalog[games.AdminGame](t, f.request(t, "POST", path, f.versioned(refreshed.UpdatedAt), 200))
	cover, err := f.game.Cover(ctx, "rl-campus", "")
	if err != nil {
		t.Fatal(err)
	}
	if want := (games.Cover{ContentType: "image/png", ETag: cover.ETag, Bytes: fakePNG}); !reflect.DeepEqual(cover, want) {
		t.Fatalf("cover after an image change = %+v, want %+v", cover, want)
	}
	if want := map[string]int{"co1": 1, "co2": 1}; !reflect.DeepEqual(f.igdb.downloads, want) {
		t.Fatalf("cover downloads = %v, want %v", f.igdb.downloads, want)
	}

	// A stale version is refused with the current record.
	stale := decodeCatalog[struct {
		Error   string          `json:"error"`
		Current games.AdminGame `json:"current"`
	}](t, f.request(t, "POST", path, f.versioned(edited.UpdatedAt), 409))
	if stale.Error != "admin_record_conflict" || !reflect.DeepEqual(stale.Current, refreshed) {
		t.Fatalf("stale refresh = %+v, want a conflict with %+v", stale, refreshed)
	}

	manual, err := f.game.CreateAdmin(ctx, games.AdminEdit{Command: f.command, Name: "Manual", Slug: "manual", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	if code := f.errorCode(t, "POST", fmt.Sprintf("/admin/v1/games/%s/refresh", manual.ID), f.versioned(manual.UpdatedAt), 422); code != "game_not_from_igdb" {
		t.Fatalf("refresh of a manual game: error = %q", code)
	}
}
