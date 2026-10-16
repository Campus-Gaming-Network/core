package games

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
	"github.com/jackc/pgx/v5"
)

// Errors the game commands return. Each maps to an API error code.
var (
	// ErrNotLinked refuses a refresh of a game that has no IGDB entry.
	ErrNotLinked = apperror.New(apperror.KindUnprocessable, "game_not_from_igdb", "game was not imported from IGDB")
	// ErrIGDBGameInvalid refuses an IGDB entry whose name cannot be stored.
	ErrIGDBGameInvalid = apperror.New(apperror.KindUnprocessable, "igdb_game_invalid", "IGDB game has no usable name")
	// ErrCoverNotFound reports a game with no stored cover.
	ErrCoverNotFound = apperror.New(apperror.KindNotFound, "game_cover_not_found", "game has no stored cover")
	// ErrGameUnavailable refuses a game a site admin has hidden or deleted.
	ErrGameUnavailable = apperror.New(apperror.KindUnprocessable, "game_unavailable", "game is not available")
	// ErrGameNameInvalid refuses a typed game name that has no usable slug.
	ErrGameNameInvalid = apperror.New(apperror.KindValidation, "invalid_game_name", "game name is not usable")
)

// searchCacheTTL is how long IGDB search results are reused.
const searchCacheTTL = "24 hours"

// StarterGameSlugs are the IGDB slugs the seed command imports so a new
// catalog is not empty.
var StarterGameSlugs = []string{
	"rocket-league", "valorant", "league-of-legends", "overwatch-2",
	"super-smash-bros-ultimate", "counter-strike-2",
}

// IGDBSource is the part of the IGDB client the catalog uses.
type IGDBSource interface {
	Search(ctx context.Context, query string) ([]igdb.Game, error)
	Game(ctx context.Context, id int64) (igdb.Game, error)
	GameBySlug(ctx context.Context, slug string) (igdb.Game, error)
	Cover(ctx context.Context, imageID string) (igdb.Cover, error)
	Thumbnail(ctx context.Context, imageID string) (igdb.Cover, error)
}

// IGDBService brings the IGDB games users pick into the catalog and keeps
// them in sync. Admins never add games: they edit, hide, delete, and refresh
// the ones users brought in.
type IGDBService struct {
	repository *PostgresRepository
	source     IGDBSource
}

// NewIGDBService returns a service that reads IGDB through source and stores
// games in repository.
func NewIGDBService(repository *PostgresRepository, source IGDBSource) *IGDBService {
	return &IGDBService{repository: repository, source: source}
}

// IGDBResult is one IGDB search match.
type IGDBResult struct {
	IGDBID      int64  `json:"igdb_id"`
	Name        string `json:"name"`
	ReleaseYear int    `json:"release_year,omitempty"`
	// GameID is the catalog game already imported from this match, if any.
	GameID string `json:"game_id,omitempty"`
	// Slug and HasCover describe that catalog game, so a picker can show the
	// cover the site serves at /api/games/{slug}/cover.
	Slug     string `json:"slug,omitempty"`
	HasCover bool   `json:"has_cover,omitempty"`
	// CoverImageID names IGDB's cover, which the site serves small at
	// /api/igdb-covers/{id} for a result the catalog has no cover for.
	CoverImageID string `json:"cover_image_id,omitempty"`
}

// searchMatch is a search result with what only the search knows about it.
type searchMatch struct {
	result IGDBResult
	// hidden reports a catalog game a site admin has hidden or deleted.
	hidden bool
}

// Cover is a stored cover image. Bytes is nil when the caller already holds
// the current ETag.
type Cover struct {
	ContentType string
	ETag        string
	Bytes       []byte
}

// SearchForPicker returns IGDB's matches for a name, for signed-in users, and
// marks the ones the catalog already holds. It leaves out matches whose
// catalog game a site admin has hidden or deleted.
func (s *IGDBService) SearchForPicker(ctx context.Context, query string) ([]IGDBResult, error) {
	matches, err := s.search(ctx, query)
	if err != nil {
		return nil, err
	}
	results := make([]IGDBResult, 0, len(matches))
	for _, match := range matches {
		if !match.hidden {
			results = append(results, match.result)
		}
	}
	return results, nil
}

func (s *IGDBService) search(ctx context.Context, query string) ([]searchMatch, error) {
	query = strings.ToLower(strings.Join(strings.Fields(query), " "))
	if !adminmutation.Text(query, 100, true) || len(query) < 2 {
		return nil, apperror.Validation("search requires two to 100 characters")
	}
	pool := s.repository.pool
	var matches []igdb.Game
	err := pool.QueryRow(ctx, `SELECT results FROM igdb_search_cache
	 WHERE query=$1 AND fetched_at > NOW() - $2::interval`, query, searchCacheTTL).Scan(&matches)
	if errors.Is(err, pgx.ErrNoRows) {
		if matches, err = s.source.Search(ctx, query); err != nil {
			return nil, err
		}
		// Expired rows are cleared here, so the table holds one day of searches.
		_, err = pool.Exec(ctx, `WITH expired AS (DELETE FROM igdb_search_cache WHERE fetched_at <= NOW() - $3::interval)
		 INSERT INTO igdb_search_cache(query,results) VALUES($1,$2)
		 ON CONFLICT (query) DO UPDATE SET results=EXCLUDED.results, fetched_at=NOW()`, query, matches, searchCacheTTL)
	}
	if err != nil {
		return nil, err
	}

	ids := make([]int64, 0, len(matches))
	for _, match := range matches {
		ids = append(ids, match.ID)
	}
	rows, err := pool.Query(ctx, `SELECT g.igdb_id, g.id::text, g.slug,
	 EXISTS(SELECT 1 FROM game_covers c WHERE c.game_id = g.id),
	 g.is_active AND g.deleted_at IS NULL
	 FROM games g WHERE g.igdb_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	type catalogGame struct {
		id, slug string
		hasCover bool
	}
	catalog := map[int64]catalogGame{}
	hidden := map[int64]bool{}
	var igdbID int64
	var game catalogGame
	var usable bool
	if _, err := pgx.ForEachRow(rows, []any{&igdbID, &game.id, &game.slug, &game.hasCover, &usable}, func() error {
		catalog[igdbID] = game
		hidden[igdbID] = !usable
		return nil
	}); err != nil {
		return nil, err
	}
	results := make([]searchMatch, 0, len(matches))
	for _, match := range matches {
		known := catalog[match.ID]
		results = append(results, searchMatch{
			result: IGDBResult{
				IGDBID: match.ID, Name: match.Name, ReleaseYear: match.ReleaseYear,
				GameID: known.id, Slug: known.slug, HasCover: known.hasCover,
				CoverImageID: match.CoverImageID,
			},
			hidden: hidden[match.ID],
		})
	}
	return results, nil
}

// SearchResultCover returns the small IGDB cover of a game search result, so
// the site can serve it without a page loading an image from IGDB. Only an
// image a search returned in the last day is served, and never one of a game
// a site admin hid or deleted, so the route is not an open IGDB proxy. The
// image ID is the ETag: IGDB never changes the image behind an ID, so a
// caller that already holds it gets a Cover without Bytes and IGDB is not
// called.
func (s *IGDBService) SearchResultCover(ctx context.Context, imageID, knownETag string) (Cover, error) {
	if imageID == "" || len(imageID) > 64 {
		return Cover{}, ErrCoverNotFound
	}
	var listed bool
	if err := s.repository.pool.QueryRow(ctx, `SELECT EXISTS (
	 SELECT 1 FROM igdb_search_cache c, jsonb_array_elements(c.results) r
	 WHERE c.results @> jsonb_build_array(jsonb_build_object('cover_image_id', $1::text))
	 AND c.fetched_at > NOW() - $2::interval
	 AND r->>'cover_image_id' = $1
	 AND NOT EXISTS (SELECT 1 FROM games g WHERE g.igdb_id = (r->>'id')::bigint
	  AND NOT (g.is_active AND g.deleted_at IS NULL)))`, imageID, searchCacheTTL).Scan(&listed); err != nil {
		return Cover{}, err
	}
	if !listed {
		return Cover{}, ErrCoverNotFound
	}
	if knownETag == imageID {
		return Cover{ETag: imageID}, nil
	}
	thumbnail, err := s.source.Thumbnail(ctx, imageID)
	if errors.Is(err, igdb.ErrNotFound) || errors.Is(err, igdb.ErrCoverUnsupported) || errors.Is(err, igdb.ErrCoverTooLarge) {
		return Cover{}, ErrCoverNotFound
	}
	if err != nil {
		return Cover{}, err
	}
	return Cover{ContentType: thumbnail.ContentType, ETag: imageID, Bytes: thumbnail.Bytes}, nil
}

// EnsureFromIGDB returns the catalog game for an IGDB entry a user picked,
// importing it as an active game when the catalog does not hold it. A game a
// site admin has hidden or deleted is refused.
func (s *IGDBService) EnsureFromIGDB(ctx context.Context, igdbID int64) (AdminGame, error) {
	if igdbID < 1 {
		return AdminGame{}, apperror.Validation("igdb game ids must be positive")
	}
	existing, err := scanAdminGame(s.repository.pool.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE igdb_id=$1`, igdbID))
	if errors.Is(err, adminmutation.ErrNotFound) {
		var source igdb.Game
		if source, err = s.source.Game(ctx, igdbID); err != nil {
			return AdminGame{}, err
		}
		existing, err = s.create(ctx, source)
		// Two people can pick the same new game at once. The one that loses
		// the unique igdb_id uses the row the other just created.
		if _, code, ok := apperror.Details(err); ok && code == "admin_record_already_exists" {
			if winner, lookupErr := scanAdminGame(s.repository.pool.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE igdb_id=$1`, igdbID)); lookupErr == nil {
				existing, err = winner, nil
			}
		}
	}
	if err != nil {
		return AdminGame{}, err
	}
	if !existing.IsActive || existing.DeletedAt != nil {
		return AdminGame{}, ErrGameUnavailable
	}
	return existing, nil
}

// EnsureStarterGames imports the starter games the catalog does not hold yet,
// linking a game already stored under the same slug without IGDB (such as a
// demo seed game) instead of copying it, and returns how many it added or
// linked. A slug IGDB does not know is skipped.
func (s *IGDBService) EnsureStarterGames(ctx context.Context) (int, error) {
	added := 0
	for _, slug := range StarterGameSlugs {
		source, err := s.source.GameBySlug(ctx, slug)
		if errors.Is(err, igdb.ErrNotFound) {
			continue
		}
		if err != nil {
			return added, err
		}
		var exists bool
		if err := s.repository.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM games WHERE igdb_id=$1)`, source.ID).Scan(&exists); err != nil {
			return added, err
		}
		if exists {
			continue
		}
		if _, err := s.create(ctx, source); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// create stores an IGDB entry and its cover as an active game. When the
// catalog already holds a game under the entry's slug that no IGDB entry is
// linked to (a demo seed game or one a user typed), that game is linked to
// the entry instead of a second copy being made, so its events and teams
// keep pointing at the one game. A linked game keeps its own name and slug,
// as a refresh does; a game a user typed becomes a regular active catalog
// game, while any other keeps its own visibility. A slug held by a
// different IGDB entry or a deleted game still gets a numeric suffix. IGDB is
// called before the transaction opens, so no transaction waits on the
// network.
func (s *IGDBService) create(ctx context.Context, source igdb.Game) (AdminGame, error) {
	r := s.repository
	name := strings.TrimSpace(source.Name)
	if !adminmutation.Text(name, 200, true) {
		return AdminGame{}, ErrIGDBGameInvalid
	}
	var cover *igdb.Cover
	if source.CoverImageID != "" {
		// A game is stored without a cover that is missing, unreachable, or
		// unusable, so an image cannot block an event or team. A refresh can
		// add it later.
		if downloaded, err := s.source.Cover(ctx, source.CoverImageID); err == nil {
			cover = &downloaded
		}
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminGame{}, err
	}
	defer tx.Rollback(ctx)
	base := baseSlug(source)
	var adopted *AdminGame
	unlinked, err := scanAdminGame(tx.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games
	 WHERE slug=$1 AND igdb_id IS NULL AND deleted_at IS NULL FOR UPDATE`, base))
	switch {
	case err == nil:
		adopted = &unlinked
	case !errors.Is(err, adminmutation.ErrNotFound):
		return AdminGame{}, err
	}
	var id string
	if adopted != nil {
		id = adopted.ID
		// A concurrent import of the same entry loses on the unique igdb_id.
		if _, err := tx.Exec(ctx, `UPDATE games SET igdb_id=$2, last_synced_at=clock_timestamp(),
		 is_active=is_active OR user_submitted, user_submitted=false
		 WHERE id=$1::uuid`, id, source.ID); err != nil {
			return AdminGame{}, adminmutation.Error(err)
		}
	} else {
		slug, err := availableSlug(ctx, tx, base)
		if err != nil {
			return AdminGame{}, err
		}
		// A concurrent import of the same entry loses on the unique igdb_id.
		if err := tx.QueryRow(ctx, `INSERT INTO games(igdb_id,name,slug,is_active,last_synced_at)
		 VALUES($1,$2,$3,TRUE,clock_timestamp()) RETURNING id::text`, source.ID, name, slug).Scan(&id); err != nil {
			return AdminGame{}, adminmutation.Error(err)
		}
	}
	if cover != nil {
		if err := storeCover(ctx, tx, id, *cover); err != nil {
			return AdminGame{}, err
		}
	}
	next, err := scanAdminGame(tx.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE id=$1::uuid`, id))
	if err != nil {
		return AdminGame{}, err
	}
	return next, tx.Commit(ctx)
}

// EnsureCustom returns the game for a name a user typed because the catalog
// and IGDB did not offer it. A new name becomes an unlisted game; a name whose
// slug an available game already holds returns that game.
func (r *PostgresRepository) EnsureCustom(ctx context.Context, name string) (AdminGame, error) {
	name = strings.Join(strings.Fields(name), " ")
	slug := strings.Trim(slugSeparators.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if !adminmutation.Text(name, 100, true) || !adminmutation.Slug(slug) {
		return AdminGame{}, ErrGameNameInvalid
	}
	if _, err := r.pool.Exec(ctx, `INSERT INTO games(name,slug,is_active,user_submitted)
	 VALUES($1,$2,false,true) ON CONFLICT (slug) DO NOTHING`, name, slug); err != nil {
		return AdminGame{}, err
	}
	game, err := scanAdminGame(r.pool.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE slug=$1`, slug))
	if err != nil {
		return AdminGame{}, err
	}
	if game.DeletedAt != nil || (!game.IsActive && !game.UserSubmitted) {
		return AdminGame{}, ErrGameUnavailable
	}
	return game, nil
}

// RefreshFromIGDB re-reads an imported game's IGDB entry. It records the sync
// time and replaces the cover when IGDB's image changed. The name and slug
// are never overwritten, so admin edits survive.
func (s *IGDBService) RefreshFromIGDB(ctx context.Context, id string, command adminmutation.Command) (AdminGame, error) {
	if !adminmutation.UUID(id) {
		return AdminGame{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminGame{}, err
	}
	r := s.repository
	// A stale or ineligible request is refused before IGDB is called.
	current, err := r.GetAdmin(ctx, id)
	if err != nil {
		return AdminGame{}, err
	}
	if err := refreshable(current, command); err != nil {
		return AdminGame{}, err
	}
	var storedImageID string
	if err := r.pool.QueryRow(ctx, `SELECT COALESCE((SELECT source_image_id FROM game_covers WHERE game_id=$1::uuid), '')`, id).Scan(&storedImageID); err != nil {
		return AdminGame{}, err
	}
	source, err := s.source.Game(ctx, *current.IGDBID)
	if err != nil {
		return AdminGame{}, err
	}
	// When IGDB drops its cover, the stored one is kept.
	var cover *igdb.Cover
	if source.CoverImageID != "" && source.CoverImageID != storedImageID {
		downloaded, err := s.source.Cover(ctx, source.CoverImageID)
		if err != nil {
			return AdminGame{}, err
		}
		cover = &downloaded
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminGame{}, err
	}
	defer tx.Rollback(ctx)
	current, err = scanAdminGame(tx.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE id=$1::uuid FOR UPDATE`, id))
	if err != nil {
		return AdminGame{}, err
	}
	if err := refreshable(current, command); err != nil {
		return AdminGame{}, err
	}
	if cover != nil {
		if err := storeCover(ctx, tx, id, *cover); err != nil {
			return AdminGame{}, err
		}
	}
	next, err := scanAdminGame(tx.QueryRow(ctx, `UPDATE games SET last_synced_at=clock_timestamp() WHERE id=$1::uuid RETURNING `+adminGameColumns, id))
	if err != nil {
		return AdminGame{}, err
	}
	if err := command.Audit(ctx, tx, adminaudit.ActionGameRefreshed, adminaudit.EntityGame, next.ID, current.auditState(), next.auditState()); err != nil {
		return AdminGame{}, err
	}
	return next, tx.Commit(ctx)
}

func refreshable(game AdminGame, command adminmutation.Command) error {
	switch {
	case !game.UpdatedAt.Equal(command.ExpectedUpdatedAt):
		return adminmutation.ErrConflict
	case game.DeletedAt != nil:
		return adminmutation.ErrTransition
	case game.IGDBID == nil:
		return ErrNotLinked
	}
	return nil
}

var slugSeparators = regexp.MustCompile(`[^a-z0-9]+`)

// baseSlug is the slug an IGDB entry is stored under: IGDB's own, or one made
// from the name when IGDB's is unusable.
func baseSlug(source igdb.Game) string {
	base := source.Slug
	if len(base) > 100 || !adminmutation.Slug(base) {
		base = strings.Trim(slugSeparators.ReplaceAllString(strings.ToLower(source.Name), "-"), "-")
		if len(base) > 100 {
			base = strings.Trim(base[:100], "-")
		}
	}
	if base == "" {
		base = fmt.Sprintf("igdb-%d", source.ID)
	}
	return base
}

// availableSlug returns base, or base with a numeric suffix when another game
// holds it.
func availableSlug(ctx context.Context, tx pgx.Tx, base string) (string, error) {
	// Slugs hold no LIKE wildcards. Soft-deleted games keep their slugs.
	rows, err := tx.Query(ctx, `SELECT slug FROM games WHERE slug=$1 OR slug LIKE $1 || '-%'`, base)
	if err != nil {
		return "", err
	}
	taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return "", err
	}
	slug := base
	for suffix := 2; slices.Contains(taken, slug); suffix++ {
		slug = fmt.Sprintf("%s-%d", base, suffix)
	}
	return slug, nil
}

func storeCover(ctx context.Context, tx pgx.Tx, gameID string, cover igdb.Cover) error {
	// The ETag is a content hash, so the cover route can answer If-None-Match
	// without reading the bytes.
	sum := sha256.Sum256(cover.Bytes)
	_, err := tx.Exec(ctx, `INSERT INTO game_covers(game_id,content_type,bytes,source_image_id,etag)
	 VALUES($1::uuid,$2,$3,$4,$5)
	 ON CONFLICT (game_id) DO UPDATE SET content_type=EXCLUDED.content_type, bytes=EXCLUDED.bytes,
	   source_image_id=EXCLUDED.source_image_id, etag=EXCLUDED.etag, fetched_at=clock_timestamp()`,
		gameID, cover.ContentType, cover.Bytes, cover.ImageID, hex.EncodeToString(sum[:16]))
	return err
}

// Cover returns the stored cover of an active game by slug. Hidden and
// deleted games have no public cover. The bytes are left out when knownETag
// is current.
func (r *PostgresRepository) Cover(ctx context.Context, slug, knownETag string) (Cover, error) {
	return scanCover(r.pool.QueryRow(ctx, `
		SELECT c.content_type, c.etag, CASE WHEN c.etag = $2 THEN NULL ELSE c.bytes END
		FROM game_covers c JOIN games g ON g.id = c.game_id
		WHERE g.slug = $1 AND g.deleted_at IS NULL AND g.is_active = TRUE
	`, slug, knownETag))
}

// AdminCover returns the stored cover of any game, including a hidden one an
// admin is reviewing before activation.
func (r *PostgresRepository) AdminCover(ctx context.Context, id string) (Cover, error) {
	if !adminmutation.UUID(id) {
		return Cover{}, ErrCoverNotFound
	}
	return scanCover(r.pool.QueryRow(ctx, `SELECT content_type, etag, bytes FROM game_covers WHERE game_id=$1::uuid`, id))
}

func scanCover(row pgx.Row) (Cover, error) {
	var cover Cover
	err := row.Scan(&cover.ContentType, &cover.ETag, &cover.Bytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return Cover{}, ErrCoverNotFound
	}
	return cover, err
}
