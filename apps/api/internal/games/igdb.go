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
)

// IGDBSource is the part of the IGDB client the catalog uses.
type IGDBSource interface {
	Search(ctx context.Context, query string) ([]igdb.Game, error)
	Game(ctx context.Context, id int64) (igdb.Game, error)
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
	if !adminmutation.Text(query, 100, true) || len(strings.TrimSpace(query)) < 2 {
		return nil, apperror.Validation("search requires two to 100 characters")
	}
	matches, err := s.source.Search(ctx, query)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(matches))
	for _, match := range matches {
		ids = append(ids, match.ID)
	}
	rows, err := s.repository.pool.Query(ctx, `SELECT igdb_id, id::text FROM games WHERE igdb_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	imported, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (IGDBResult, error) {
		var result IGDBResult
		err := row.Scan(&result.IGDBID, &result.GameID)
		return result, err
	})
	if err != nil {
		return nil, err
	}
	results := make([]IGDBResult, 0, len(matches))
	for _, match := range matches {
		result := IGDBResult{IGDBID: match.ID, Name: match.Name, ReleaseYear: match.ReleaseYear}
		if index := slices.IndexFunc(imported, func(row IGDBResult) bool { return row.IGDBID == match.ID }); index >= 0 {
			result.GameID = imported[index].GameID
		}
		results = append(results, result)
	}
	return results, nil
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

	// IGDB is called before the transaction opens, so no transaction waits on
	// the network. A failed cover download fails the import.
	source, err := s.source.Game(ctx, input.IGDBID)
	if err != nil {
		return AdminGame{}, err
	}
	name := strings.TrimSpace(source.Name)
	if !adminmutation.Text(name, 200, true) {
		return AdminGame{}, ErrIGDBGameInvalid
	}
	var cover *igdb.Cover
	if source.CoverImageID != "" {
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
	slug, err := availableSlug(ctx, tx, source)
	if err != nil {
		return AdminGame{}, err
	}
	var id string
	// A concurrent import of the same entry loses on the unique igdb_id.
	if err := tx.QueryRow(ctx, `INSERT INTO games(igdb_id,name,slug,is_active,last_synced_at)
	 VALUES($1,$2,$3,false,clock_timestamp()) RETURNING id::text`, input.IGDBID, name, slug).Scan(&id); err != nil {
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
	if err := input.Audit(ctx, tx, adminaudit.ActionGameImported, adminaudit.EntityGame, next.ID, adminaudit.EmptyState{}, next.auditState()); err != nil {
		return AdminGame{}, err
	}
	return next, tx.Commit(ctx)
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
