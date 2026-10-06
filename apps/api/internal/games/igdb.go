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

var (
	// ErrAlreadyImported is returned with the existing game.
	ErrAlreadyImported = apperror.New(apperror.KindConflict, "game_already_imported", "a game with this IGDB ID already exists")
	ErrNotLinked       = apperror.New(apperror.KindUnprocessable, "game_not_from_igdb", "game was not imported from IGDB")
	ErrIGDBGameInvalid = apperror.New(apperror.KindUnprocessable, "igdb_game_invalid", "IGDB game has no usable name")
	ErrCoverNotFound   = apperror.New(apperror.KindNotFound, "game_cover_not_found", "game has no stored cover")
	// ErrGameUnavailable refuses a game a site admin has hidden or deleted.
	ErrGameUnavailable = apperror.New(apperror.KindUnprocessable, "game_unavailable", "game is not available")
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
}

// IGDBService runs the named commands that bring IGDB games into the catalog.
type IGDBService struct {
	repository *PostgresRepository
	source     IGDBSource
}

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
}

type IGDBImport struct {
	adminmutation.Command
	IGDBID int64 `json:"igdb_id"`
}

// Cover is a stored cover image. Bytes is nil when the caller already holds
// the current ETag.
type Cover struct {
	ContentType string
	ETag        string
	Bytes       []byte
}

// SearchIGDB returns IGDB's matches for a name and marks the ones the catalog
// already holds. No cover is downloaded.
func (s *IGDBService) SearchIGDB(ctx context.Context, query string) ([]IGDBResult, error) {
	results, _, err := s.search(ctx, query)
	return results, err
}

// SearchForPicker is SearchIGDB for signed-in users. It leaves out matches
// whose catalog game a site admin has hidden or deleted.
func (s *IGDBService) SearchForPicker(ctx context.Context, query string) ([]IGDBResult, error) {
	results, unavailable, err := s.search(ctx, query)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(results, func(result IGDBResult) bool {
		return slices.Contains(unavailable, result.IGDBID)
	}), nil
}

// search returns the matches and the IGDB IDs of those whose catalog game is
// hidden or deleted.
func (s *IGDBService) search(ctx context.Context, query string) ([]IGDBResult, []int64, error) {
	query = strings.ToLower(strings.Join(strings.Fields(query), " "))
	if !adminmutation.Text(query, 100, true) || len(query) < 2 {
		return nil, nil, apperror.Validation("search requires two to 100 characters")
	}
	pool := s.repository.pool
	var matches []igdb.Game
	err := pool.QueryRow(ctx, `SELECT results FROM igdb_search_cache
	 WHERE query=$1 AND fetched_at > NOW() - $2::interval`, query, searchCacheTTL).Scan(&matches)
	if errors.Is(err, pgx.ErrNoRows) {
		if matches, err = s.source.Search(ctx, query); err != nil {
			return nil, nil, err
		}
		// Expired rows are cleared here, so the table holds one day of searches.
		_, err = pool.Exec(ctx, `WITH expired AS (DELETE FROM igdb_search_cache WHERE fetched_at <= NOW() - $3::interval)
		 INSERT INTO igdb_search_cache(query,results) VALUES($1,$2)
		 ON CONFLICT (query) DO UPDATE SET results=EXCLUDED.results, fetched_at=NOW()`, query, matches, searchCacheTTL)
	}
	if err != nil {
		return nil, nil, err
	}

	ids := make([]int64, 0, len(matches))
	for _, match := range matches {
		ids = append(ids, match.ID)
	}
	rows, err := pool.Query(ctx, `SELECT igdb_id, id::text, is_active AND deleted_at IS NULL FROM games WHERE igdb_id = ANY($1)`, ids)
	if err != nil {
		return nil, nil, err
	}
	catalog := map[int64]string{}
	var unavailable []int64
	var igdbID int64
	var gameID string
	var usable bool
	if _, err := pgx.ForEachRow(rows, []any{&igdbID, &gameID, &usable}, func() error {
		catalog[igdbID] = gameID
		if !usable {
			unavailable = append(unavailable, igdbID)
		}
		return nil
	}); err != nil {
		return nil, nil, err
	}
	results := make([]IGDBResult, 0, len(matches))
	for _, match := range matches {
		results = append(results, IGDBResult{IGDBID: match.ID, Name: match.Name, ReleaseYear: match.ReleaseYear, GameID: catalog[match.ID]})
	}
	return results, unavailable, nil
}

// ImportFromIGDB creates an inactive game from an IGDB entry and stores its
// cover. The name, slug, and cover come from IGDB, never from the caller. A
// second import of the same entry returns the existing game with
// ErrAlreadyImported.
func (s *IGDBService) ImportFromIGDB(ctx context.Context, input IGDBImport) (AdminGame, error) {
	if err := input.Command.Validate(false); err != nil {
		return AdminGame{}, err
	}
	if input.IGDBID < 1 {
		return AdminGame{}, apperror.Validation("igdb_id is required")
	}
	r := s.repository
	existing, err := scanAdminGame(r.pool.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE igdb_id=$1`, input.IGDBID))
	if err == nil {
		return existing, ErrAlreadyImported
	}
	if !errors.Is(err, adminmutation.ErrNotFound) {
		return AdminGame{}, err
	}

	source, err := s.source.Game(ctx, input.IGDBID)
	if err != nil {
		return AdminGame{}, err
	}
	return s.create(ctx, source, false, func(tx pgx.Tx, next AdminGame) error {
		return input.Audit(ctx, tx, adminaudit.ActionGameImported, adminaudit.EntityGame, next.ID, adminaudit.EmptyState{}, next.auditState())
	})
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
		existing, err = s.create(ctx, source, true, nil)
	}
	if err != nil {
		return AdminGame{}, err
	}
	if !existing.IsActive || existing.DeletedAt != nil {
		return AdminGame{}, ErrGameUnavailable
	}
	return existing, nil
}

// EnsureStarterGames imports the starter games the catalog does not hold yet
// and returns how many it added. A slug IGDB does not know is skipped.
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
		if _, err := s.create(ctx, source, true, nil); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// create stores an IGDB entry and its cover as a new game. IGDB is called
// before the transaction opens, so no transaction waits on the network. A
// failed cover download fails the import. audit, set for admin imports, runs
// in the same transaction.
func (s *IGDBService) create(ctx context.Context, source igdb.Game, active bool, audit func(pgx.Tx, AdminGame) error) (AdminGame, error) {
	r := s.repository
	name := strings.TrimSpace(source.Name)
	if !adminmutation.Text(name, 200, true) {
		return AdminGame{}, ErrIGDBGameInvalid
	}
	var cover *igdb.Cover
	if source.CoverImageID != "" {
		downloaded, err := s.source.Cover(ctx, source.CoverImageID)
		// An admin import reports any cover failure. A user's pick or a starter
		// game is imported without its cover, so a missing, unreachable, or
		// unusable image cannot block an event or team. A refresh can add it.
		if err != nil && audit != nil {
			return AdminGame{}, err
		}
		if err == nil {
			cover = &downloaded
		}
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminGame{}, err
	}
	defer tx.Rollback(ctx)
	slug, err := availableSlug(ctx, tx, source)
	if err != nil {
		return AdminGame{}, err
	}
	var id string
	// A concurrent import of the same entry loses on the unique igdb_id.
	if err := tx.QueryRow(ctx, `INSERT INTO games(igdb_id,name,slug,is_active,last_synced_at)
	 VALUES($1,$2,$3,$4,clock_timestamp()) RETURNING id::text`, source.ID, name, slug, active).Scan(&id); err != nil {
		return AdminGame{}, adminmutation.Error(err)
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
	if audit != nil {
		if err := audit(tx, next); err != nil {
			return AdminGame{}, err
		}
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

// availableSlug prefers IGDB's slug, falls back to one made from the name,
// and adds a numeric suffix when another game holds it.
func availableSlug(ctx context.Context, tx pgx.Tx, source igdb.Game) (string, error) {
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
