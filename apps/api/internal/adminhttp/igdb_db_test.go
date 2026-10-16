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
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
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
	// thumbnails counts search result thumbnail requests by image ID.
	thumbnails map[string]int
	// status overrides the game endpoint's status when set.
	status int
	// searches counts name searches that reached IGDB.
	searches int
	// imageStatus overrides the image endpoint's status by image ID.
	imageStatus map[string]int
}

var (
	fakeIGDBGameID   = regexp.MustCompile(`where id = (\d+);`)
	fakeIGDBGameSlug = regexp.MustCompile(`where slug = "([^"]*)";`)
)

func newFakeIGDB(t *testing.T) *fakeIGDB {
	t.Helper()
	fake := &fakeIGDB{
		games:      []fakeIGDBGame{{ID: fakeRocketLeagueID, Name: "Rocket League", Slug: "rocket-league"}, {ID: 7, Name: "Coverless: The Game!", Slug: "Not A Slug"}},
		images:     map[string][]byte{"co1": fakeJPEG, "co2": fakePNG},
		downloads:  map[string]int{},
		thumbnails: map[string]int{},
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
		id, slug := fakeIGDBGameID.FindSubmatch(query), fakeIGDBGameSlug.FindSubmatch(query)
		if id == nil && slug == nil {
			fake.searches++
		}
		for _, game := range fake.games {
			if id != nil {
				if string(id[1]) == strconv.FormatInt(game.ID, 10) {
					matches = append(matches, game)
				}
			} else if slug != nil {
				if string(slug[1]) == game.Slug {
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
		if status := fake.imageStatus[imageID]; status != 0 {
			w.WriteHeader(status)
			return
		}
		w.Write(fake.images[imageID])
	})
	// Search result thumbnails come from the same images, counted apart.
	mux.HandleFunc("GET /images/t_cover_small/{file}", func(w http.ResponseWriter, req *http.Request) {
		imageID := strings.TrimSuffix(req.PathValue("file"), ".jpg")
		fake.thumbnails[imageID]++
		if status := fake.imageStatus[imageID]; status != 0 {
			w.WriteHeader(status)
			return
		}
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

// pickGame adds an IGDB game the way a user's event or team form does.
func (f catalogFixture) pickGame(t *testing.T, igdbID int64) games.AdminGame {
	t.Helper()
	game, err := games.NewIGDBService(f.game, f.igdb.client).EnsureFromIGDB(t.Context(), igdbID)
	if err != nil {
		t.Fatal(err)
	}
	return game
}

// hideGame hides a game from users the way an admin does.
func (f catalogFixture) hideGame(t *testing.T, game games.AdminGame) games.AdminGame {
	t.Helper()
	return decodeCatalog[games.AdminGame](t, f.request(t, "PATCH", "/admin/v1/games/"+game.ID,
		games.AdminEdit{Command: f.versioned(game.UpdatedAt), Name: game.Name, Slug: game.Slug}, 200))
}

func (f catalogFixture) errorCode(t *testing.T, method, path string, input any, status int) string {
	t.Helper()
	return decodeCatalog[struct {
		Error string `json:"error"`
	}](t, f.request(t, method, path, input, status)).Error
}

func TestAPickedGameIsStoredWithItsCoverUntilAnAdminHidesIt(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()

	game := f.pickGame(t, fakeRocketLeagueID)
	igdbID := int64(fakeRocketLeagueID)
	want := games.AdminGame{
		Game:     games.Game{ID: game.ID, Name: "Rocket League", Slug: "rocket-league"},
		IsActive: true, CreatedAt: game.CreatedAt, UpdatedAt: game.UpdatedAt,
		IGDBID: &igdbID, LastSyncedAt: game.LastSyncedAt, HasCover: true,
	}
	if !reflect.DeepEqual(game, want) || game.LastSyncedAt == nil {
		t.Fatalf("picked game = %+v, want %+v with a sync time", game, want)
	}

	// The Admin Console shows the stored cover from its own page.
	type adminCover struct {
		ContentType string `json:"content_type"`
		Data        []byte `json:"data"`
	}
	reviewed := decodeCatalog[adminCover](t, f.request(t, "GET", "/admin/v1/games/"+game.ID+"/cover", nil, 200))
	if want := (adminCover{ContentType: "image/jpeg", Data: fakeJPEG}); !reflect.DeepEqual(reviewed, want) {
		t.Fatalf("admin cover = %+v, want %+v", reviewed, want)
	}
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

	// A hidden game's cover is no longer served.
	f.hideGame(t, game)
	if _, err := f.game.Cover(ctx, game.Slug, ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("public cover of a hidden game: error = %v, want %v", err, games.ErrCoverNotFound)
	}
}

func TestAPickLinksAnUnlinkedGameInsteadOfCopyingIt(t *testing.T) {
	f := newCatalogFixture(t)
	manual := f.insertGame(t, "Rocket League (manual)", "rocket-league")
	game := f.pickGame(t, fakeRocketLeagueID)
	igdbID := int64(fakeRocketLeagueID)
	// The stored game keeps its id, name, slug, and visibility and gains the
	// IGDB link and cover.
	want := games.AdminGame{
		Game:     games.Game{ID: manual.ID, Name: "Rocket League (manual)", Slug: "rocket-league"},
		IsActive: true, CreatedAt: manual.CreatedAt, UpdatedAt: game.UpdatedAt,
		IGDBID: &igdbID, LastSyncedAt: game.LastSyncedAt, HasCover: true,
	}
	if !reflect.DeepEqual(game, want) || game.LastSyncedAt == nil {
		t.Fatalf("picked game = %+v, want %+v with a sync time", game, want)
	}
	listed, err := f.game.ListAdmin(t.Context(), adminmutation.Filter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("catalog holds %d games after the pick, want 1", len(listed))
	}
}

func TestAPickDerivesAFreeSlugAndAllowsNoCover(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	// A deleted game keeps its slug, so a pick beside it takes the next one.
	deleted := f.insertGame(t, "Rocket League (old)", "rocket-league")
	if _, err := f.game.DeleteAdmin(ctx, deleted.ID, f.versioned(deleted.UpdatedAt)); err != nil {
		t.Fatal(err)
	}
	if game := f.pickGame(t, fakeRocketLeagueID); game.Slug != "rocket-league-2" {
		t.Fatalf("slug beside a deleted game's = %q, want rocket-league-2", game.Slug)
	}
	// IGDB's slug is unusable here, so one is made from the name.
	coverless := f.pickGame(t, 7)
	if coverless.Slug != "coverless-the-game" || coverless.HasCover {
		t.Fatalf("coverless pick = slug %q, has cover %t", coverless.Slug, coverless.HasCover)
	}
}

func TestAUserPickLinksAGameAUserTypedEarlier(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	typed, err := f.game.EnsureCustom(ctx, "Rocket League")
	if err != nil {
		t.Fatal(err)
	}
	picked, err := games.NewIGDBService(f.game, f.igdb.client).EnsureFromIGDB(ctx, fakeRocketLeagueID)
	if err != nil {
		t.Fatal(err)
	}
	// The typed game becomes the regular, listed catalog game.
	if picked.ID != typed.ID || !picked.IsActive || picked.UserSubmitted || picked.IGDBID == nil {
		t.Fatalf("picked game = %+v, want the typed game %s linked and listed", picked, typed.ID)
	}
}

func TestIGDBFailuresStoreNothing(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	service := games.NewIGDBService(f.game, f.igdb.client)

	if _, err := service.EnsureFromIGDB(ctx, 404); !errors.Is(err, igdb.ErrNotFound) {
		t.Fatalf("pick of an unknown IGDB game: error = %v, want %v", err, igdb.ErrNotFound)
	}
	for status, want := range map[int]error{
		http.StatusTooManyRequests:     igdb.ErrRateLimited,
		http.StatusInternalServerError: igdb.ErrUnavailable,
	} {
		f.igdb.status = status
		if _, err := service.EnsureFromIGDB(ctx, fakeRocketLeagueID); !errors.Is(err, want) {
			t.Fatalf("IGDB status %d on a pick: error = %v, want %v", status, err, want)
		}
		if _, err := service.SearchForPicker(ctx, "rocket"); !errors.Is(err, want) {
			t.Fatalf("IGDB status %d on a search: error = %v, want %v", status, err, want)
		}
	}
	f.handler.dependencies.Catalog.IGDB = nil
	if code := f.errorCode(t, "POST", "/admin/v1/games/10000000-0000-4000-8000-000000000099/refresh", f.command, 503); code != "igdb_not_configured" {
		t.Fatalf("refresh without credentials: error = %q", code)
	}

	var stored int
	if err := f.pool.QueryRow(ctx, `SELECT (SELECT COUNT(*) FROM games) + (SELECT COUNT(*) FROM game_covers)`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 0 {
		t.Fatalf("failed picks left %d rows behind", stored)
	}
}

func TestIGDBRefreshKeepsAdminEditsAndReplacesAChangedCover(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	imported := f.pickGame(t, fakeRocketLeagueID)
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

	manual := f.insertGame(t, "Manual", "manual")
	if code := f.errorCode(t, "POST", fmt.Sprintf("/admin/v1/games/%s/refresh", manual.ID), f.versioned(manual.UpdatedAt), 422); code != "game_not_from_igdb" {
		t.Fatalf("refresh of a manual game: error = %q", code)
	}
}

func TestIGDBSearchIsCachedForADay(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	service := games.NewIGDBService(f.game, f.igdb.client)
	want := []games.IGDBResult{{IGDBID: fakeRocketLeagueID, Name: "Rocket League", CoverImageID: "co1"}}

	// The same search in another case and spacing is one IGDB call.
	for _, query := range []string{"rocket", "  ROCKET ", "Rocket"} {
		results, err := service.SearchForPicker(ctx, query)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(results, want) {
			t.Fatalf("search %q = %+v, want %+v", query, results, want)
		}
	}
	if f.igdb.searches != 1 {
		t.Fatalf("IGDB searches after three equal queries = %d, want 1", f.igdb.searches)
	}

	// A day-old row is refetched.
	if _, err := f.pool.Exec(ctx, `UPDATE igdb_search_cache SET fetched_at = NOW() - INTERVAL '25 hours'`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SearchForPicker(ctx, "rocket"); err != nil {
		t.Fatal(err)
	}
	if f.igdb.searches != 2 {
		t.Fatalf("IGDB searches after the cache expired = %d, want 2", f.igdb.searches)
	}

	// A cached match still reflects the catalog: a game an admin hid is left
	// out, and once shown again it carries the slug and cover the site
	// serves, so the result can show its cover.
	hidden := f.hideGame(t, f.pickGame(t, fakeRocketLeagueID))
	picker, err := service.SearchForPicker(ctx, "rocket")
	if err != nil {
		t.Fatal(err)
	}
	if len(picker) != 0 || f.igdb.searches != 2 {
		t.Fatalf("picker = %+v after %d searches, want none after 2", picker, f.igdb.searches)
	}
	f.request(t, "PATCH", "/admin/v1/games/"+hidden.ID, games.AdminEdit{Command: f.versioned(hidden.UpdatedAt), Name: hidden.Name, Slug: hidden.Slug, IsActive: true}, 200)
	picker, err = service.SearchForPicker(ctx, "rocket")
	if err != nil {
		t.Fatal(err)
	}
	wantPicker := []games.IGDBResult{{IGDBID: fakeRocketLeagueID, Name: "Rocket League", GameID: hidden.ID, Slug: "rocket-league", HasCover: true, CoverImageID: "co1"}}
	if !reflect.DeepEqual(picker, wantPicker) {
		t.Fatalf("picker after showing = %+v, want %+v", picker, wantPicker)
	}
}

func TestSearchResultCoversAreServedOnlyForRecentVisibleResults(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	service := games.NewIGDBService(f.game, f.igdb.client)

	// Nothing is served before a search returns the image.
	if _, err := service.SearchResultCover(ctx, "co1", ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("cover before any search: error = %v, want %v", err, games.ErrCoverNotFound)
	}
	if _, err := service.SearchForPicker(ctx, "rocket"); err != nil {
		t.Fatal(err)
	}
	cover, err := service.SearchResultCover(ctx, "co1", "")
	if err != nil {
		t.Fatal(err)
	}
	if want := (games.Cover{ContentType: "image/jpeg", ETag: "co1", Bytes: fakeJPEG}); !reflect.DeepEqual(cover, want) {
		t.Fatalf("cover = %+v, want %+v", cover, want)
	}
	// A caller holding the image revalidates without a trip to IGDB.
	revalidated, err := service.SearchResultCover(ctx, "co1", "co1")
	if err != nil {
		t.Fatal(err)
	}
	if want := (games.Cover{ETag: "co1"}); !reflect.DeepEqual(revalidated, want) || f.igdb.thumbnails["co1"] != 1 {
		t.Fatalf("revalidated = %+v after %d downloads, want %+v after 1", revalidated, f.igdb.thumbnails["co1"], want)
	}

	// An image no search returned, or one IGDB cannot serve, is not found.
	if _, err := service.SearchResultCover(ctx, "co2", ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("cover no search returned: error = %v, want %v", err, games.ErrCoverNotFound)
	}
	f.igdb.imageStatus = map[string]int{"co1": http.StatusNotFound}
	if _, err := service.SearchResultCover(ctx, "co1", ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("cover IGDB lost: error = %v, want %v", err, games.ErrCoverNotFound)
	}
	f.igdb.imageStatus = map[string]int{"co1": http.StatusBadGateway}
	if _, err := service.SearchResultCover(ctx, "co1", ""); !errors.Is(err, igdb.ErrUnavailable) {
		t.Fatalf("cover while IGDB fails: error = %v, want %v", err, igdb.ErrUnavailable)
	}
	f.igdb.imageStatus = nil

	// A game an admin hid loses its cover, and so does a day-old search.
	hidden := f.hideGame(t, f.pickGame(t, fakeRocketLeagueID))
	if _, err := service.SearchResultCover(ctx, "co1", ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("cover of a hidden game: error = %v, want %v", err, games.ErrCoverNotFound)
	}
	f.request(t, "PATCH", "/admin/v1/games/"+hidden.ID, games.AdminEdit{Command: f.versioned(hidden.UpdatedAt), Name: hidden.Name, Slug: hidden.Slug, IsActive: true}, 200)
	if _, err := service.SearchResultCover(ctx, "co1", ""); err != nil {
		t.Fatalf("cover once shown again: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE igdb_search_cache SET fetched_at = NOW() - INTERVAL '25 hours'`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SearchResultCover(ctx, "co1", ""); !errors.Is(err, games.ErrCoverNotFound) {
		t.Fatalf("cover from an expired search: error = %v, want %v", err, games.ErrCoverNotFound)
	}
}

func TestAUserCreatesAnEventAndATeamForGamesTheCatalogLacked(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	service := games.NewIGDBService(f.game, f.igdb.client)

	// A game picked from IGDB search is imported active, with its cover.
	picked, err := service.EnsureFromIGDB(ctx, fakeRocketLeagueID)
	if err != nil {
		t.Fatal(err)
	}
	igdbID := int64(fakeRocketLeagueID)
	wantPicked := games.AdminGame{
		Game:     games.Game{ID: picked.ID, Name: "Rocket League", Slug: "rocket-league"},
		IsActive: true, CreatedAt: picked.CreatedAt, UpdatedAt: picked.UpdatedAt,
		IGDBID: &igdbID, LastSyncedAt: picked.LastSyncedAt, HasCover: true,
	}
	if !reflect.DeepEqual(picked, wantPicked) {
		t.Fatalf("picked game = %+v, want %+v", picked, wantPicked)
	}
	if again, err := service.EnsureFromIGDB(ctx, fakeRocketLeagueID); err != nil || !reflect.DeepEqual(again, picked) {
		t.Fatalf("second pick = %+v, %v; want the same game", again, err)
	}

	// A typed name becomes an unlisted game, reused by the next person who
	// types it.
	typed, err := f.game.EnsureCustom(ctx, "  Campus   Trivia Night ")
	if err != nil {
		t.Fatal(err)
	}
	wantTyped := games.AdminGame{
		Game:      games.Game{ID: typed.ID, Name: "Campus Trivia Night", Slug: "campus-trivia-night"},
		CreatedAt: typed.CreatedAt, UpdatedAt: typed.UpdatedAt, UserSubmitted: true,
	}
	if !reflect.DeepEqual(typed, wantTyped) {
		t.Fatalf("typed game = %+v, want %+v", typed, wantTyped)
	}
	if again, err := f.game.EnsureCustom(ctx, "campus trivia night"); err != nil || !reflect.DeepEqual(again, typed) {
		t.Fatalf("second typed game = %+v, %v; want the same game", again, err)
	}
	listed, err := f.game.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if want := []games.Game{{ID: picked.ID, Name: "Rocket League", Slug: "rocket-league", HasCover: true}}; !reflect.DeepEqual(listed, want) {
		t.Fatalf("public picker = %+v, want only the IGDB game %+v", listed, want)
	}

	startsAt := time.Date(2030, time.April, 2, 19, 0, 0, 0, time.UTC)
	event, err := events.NewPostgresRepository(f.pool).Create(ctx, events.CreateParams{CreateInput: events.CreateInput{
		Title: "Picker Night", CreatorUserID: catalogActorID, HostSchoolID: catalogSchoolID,
		GameIDs: []string{picked.ID, typed.ID}, Visibility: events.VisibilityPublic, Format: events.FormatOnline, Audience: events.AudienceOpen, EventType: events.EventTypeGameNight,
		StartsAt: startsAt, EndsAt: startsAt.Add(time.Hour), Timezone: "UTC", OnlineURL: "https://example.test/stream",
	}})
	if err != nil {
		t.Fatal(err)
	}
	wantGames := []events.GameSummary{{ID: typed.ID, Name: "Campus Trivia Night", Slug: "campus-trivia-night"}, {ID: picked.ID, Name: "Rocket League", Slug: "rocket-league", HasCover: true}}
	if !reflect.DeepEqual(event.Games, wantGames) {
		t.Fatalf("event games = %+v, want %+v", event.Games, wantGames)
	}
	// The site stops serving a hidden game's cover, so the event stops naming it.
	if _, err := f.pool.Exec(ctx, `UPDATE games SET is_active=FALSE WHERE id=$1::uuid`, picked.ID); err != nil {
		t.Fatal(err)
	}
	reread, err := events.NewPostgresRepository(f.pool).GetBySlug(ctx, event.Slug)
	if err != nil {
		t.Fatal(err)
	}
	wantGames[1].HasCover = false
	if !reflect.DeepEqual(reread.Games, wantGames) {
		t.Fatalf("event games after hiding = %+v, want %+v", reread.Games, wantGames)
	}
	team, err := teams.NewPostgresRepository(f.pool).Create(ctx, teams.CreateParams{CreateInput: teams.CreateInput{
		Name: "Trivia Squad", OwnerUserID: catalogActorID, SchoolID: catalogSchoolID, GameIDs: []string{typed.ID}, Password: "TeamPass8",
	}, PasswordHash: "hash"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []teams.GameSummary{{ID: typed.ID, Name: "Campus Trivia Night", Slug: "campus-trivia-night"}}; !reflect.DeepEqual(team.Games, want) {
		t.Fatalf("team games = %+v, want %+v", team.Games, want)
	}
}

func TestHiddenAndDeletedGamesCannotBeAddedByUsers(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	service := games.NewIGDBService(f.game, f.igdb.client)

	// A game an admin hid cannot be added again, picked or typed.
	f.hideGame(t, f.pickGame(t, fakeRocketLeagueID))
	if _, err := service.EnsureFromIGDB(ctx, fakeRocketLeagueID); !errors.Is(err, games.ErrGameUnavailable) {
		t.Fatalf("pick of a hidden game: error = %v, want %v", err, games.ErrGameUnavailable)
	}
	if _, err := f.game.EnsureCustom(ctx, "Rocket League"); !errors.Is(err, games.ErrGameUnavailable) {
		t.Fatalf("typed name of a hidden game: error = %v, want %v", err, games.ErrGameUnavailable)
	}

	// Deleting a typed game blocks that name.
	typed, err := f.game.EnsureCustom(ctx, "Blocked Game")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.game.DeleteAdmin(ctx, typed.ID, f.versioned(typed.UpdatedAt)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.game.EnsureCustom(ctx, "blocked game"); !errors.Is(err, games.ErrGameUnavailable) {
		t.Fatalf("typed name of a deleted game: error = %v, want %v", err, games.ErrGameUnavailable)
	}
	if _, err := f.game.EnsureCustom(ctx, "!!!"); !errors.Is(err, games.ErrGameNameInvalid) {
		t.Fatalf("name with no letters: error = %v, want %v", err, games.ErrGameNameInvalid)
	}

	// A user's pick is not blocked by a cover that is unusable, missing, or
	// unreachable. The game is imported without it.
	f.igdb.games = append(f.igdb.games,
		fakeIGDBGame{ID: 9, Name: "Bad Cover", Slug: "bad-cover"},
		fakeIGDBGame{ID: 10, Name: "Missing Cover", Slug: "missing-cover"},
		fakeIGDBGame{ID: 11, Name: "Unreachable Cover", Slug: "unreachable-cover"})
	f.igdb.setCover(9, "co9")
	f.igdb.setCover(10, "co10")
	f.igdb.setCover(11, "co11")
	f.igdb.images["co9"] = []byte("<html>not an image</html>")
	f.igdb.imageStatus = map[string]int{"co10": http.StatusNotFound, "co11": http.StatusBadGateway}
	for _, igdbID := range []int64{9, 10, 11} {
		coverless, err := service.EnsureFromIGDB(ctx, igdbID)
		if err != nil {
			t.Fatalf("pick of IGDB game %d: %v", igdbID, err)
		}
		if !coverless.IsActive || coverless.HasCover {
			t.Fatalf("pick of IGDB game %d = active %t, has cover %t; want active without a cover", igdbID, coverless.IsActive, coverless.HasCover)
		}
	}
}

func TestStarterGamesAreImportedOnce(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	service := games.NewIGDBService(f.game, f.igdb.client)
	// The demo seed may have added the game first, without IGDB. The starter
	// import links that game rather than adding a second Rocket League.
	seeded := f.insertGame(t, "Rocket League", "rocket-league")

	// The fake IGDB knows one of the starter slugs.
	for _, want := range []int{1, 0} {
		added, err := service.EnsureStarterGames(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if added != want {
			t.Fatalf("starter games added = %d, want %d", added, want)
		}
	}
	listed, err := f.game.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if want := []games.Game{{ID: seeded.ID, Name: "Rocket League", Slug: "rocket-league", HasCover: true}}; !reflect.DeepEqual(listed, want) {
		t.Fatalf("public picker = %+v, want %+v", listed, want)
	}
}
