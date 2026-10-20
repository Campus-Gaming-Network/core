package clubs

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
)

// Link types and limits the Admin Console may set.
const (
	LinkWebsite  = "website"
	LinkDiscord  = "discord"
	LinkSocial   = "social"
	maxClubLinks = 10
	maxClubGames = 20
)

// AdminFields is the editable club form. The school is chosen when the club
// is created and never changes; status, links, and confirmation have their own
// named commands.
type AdminFields struct {
	Name      string   `json:"name"`
	Slug      string   `json:"slug"`
	Type      string   `json:"type"`
	Summary   string   `json:"summary"`
	HowToJoin string   `json:"how_to_join"`
	GameIDs   []string `json:"game_ids"`
}

// AdminClub is a club as the Admin Console sees it, hidden ones included.
// IsActive is true for a published club, so the console's shared state badge
// reads it like a school's.
type AdminClub struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	Slug      string        `json:"slug"`
	Type      string        `json:"type"`
	Summary   string        `json:"summary"`
	HowToJoin string        `json:"how_to_join"`
	School    SchoolSummary `json:"school"`
	Games     []GameSummary `json:"games"`
	Links     []Link        `json:"links"`
	IsActive  bool          `json:"is_active"`
	// Claimed reports whether the club has an owner.
	Claimed         bool       `json:"claimed"`
	ConfirmedAt     *time.Time `json:"confirmed_at"`
	ConfirmedSource *string    `json:"confirmed_source"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at"`
}

// AdminCreate creates a club under a school.
type AdminCreate struct {
	adminmutation.Command
	SchoolID string `json:"school_id"`
	AdminFields
}

// AdminEdit replaces a club's editable fields.
type AdminEdit struct {
	adminmutation.Command
	AdminFields
}

// LinksEdit replaces a club's links, in order.
type LinksEdit struct {
	adminmutation.Command
	Links []Link `json:"links"`
}

// Validate checks the form without touching the database and trims it.
func (fields *AdminFields) Validate() error {
	fields.Name = strings.TrimSpace(fields.Name)
	fields.Summary = strings.TrimSpace(fields.Summary)
	fields.HowToJoin = strings.TrimSpace(fields.HowToJoin)
	if !adminmutation.Text(fields.Name, 120, true) || !adminmutation.Slug(fields.Slug) ||
		(fields.Type != TypeStudentClub && fields.Type != TypeUniversityProgram) ||
		!adminmutation.Text(fields.Summary, 2000, false) || !adminmutation.Text(fields.HowToJoin, 2000, false) {
		return apperror.Validation("invalid club fields")
	}
	if len(fields.GameIDs) > maxClubGames {
		return apperror.Validation("a club lists at most 20 games")
	}
	seen := map[string]bool{}
	ids := make([]string, 0, len(fields.GameIDs))
	for _, id := range fields.GameIDs {
		if !adminmutation.UUID(id) {
			return apperror.Validation("invalid club game")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	fields.GameIDs = ids
	return nil
}

func validateLinks(links []Link) error {
	if len(links) > maxClubLinks {
		return apperror.Validation("a club has at most 10 links")
	}
	for _, link := range links {
		if (link.Type != LinkWebsite && link.Type != LinkDiscord && link.Type != LinkSocial) ||
			!adminmutation.Text(link.Label, 60, true) || link.URL == "" || len(link.URL) > 500 || !adminmutation.URL(link.URL) {
			return apperror.Validation("invalid club link")
		}
	}
	return nil
}

const adminClubColumns = `c.id::text, c.name, c.slug, c.type, c.summary, c.how_to_join,
	s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
	c.status = 'published', ` + claimedColumn + `, c.confirmed_at, c.confirmed_source, c.created_at, c.updated_at, c.deleted_at`

func scanAdminClub(row pgx.Row) (AdminClub, error) {
	var club AdminClub
	err := row.Scan(&club.ID, &club.Name, &club.Slug, &club.Type, &club.Summary, &club.HowToJoin,
		&club.School.ID, &club.School.Name, &club.School.Slug, &club.School.City, &club.School.State,
		&club.IsActive, &club.Claimed, &club.ConfirmedAt, &club.ConfirmedSource, &club.CreatedAt, &club.UpdatedAt, &club.DeletedAt)
	return club, adminmutation.Error(err)
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// withDetails adds the club's games and links.
func withDetails(ctx context.Context, db queryer, club AdminClub) (AdminClub, error) {
	rows, err := db.Query(ctx, `
		SELECT g.id::text, g.name, g.slug,
		       g.is_active AND EXISTS (SELECT 1 FROM game_covers gc WHERE gc.game_id = g.id)
		FROM club_games cg JOIN games g ON g.id = cg.game_id AND g.deleted_at IS NULL
		WHERE cg.club_id = $1::uuid ORDER BY g.name, g.id
	`, club.ID)
	if err != nil {
		return AdminClub{}, err
	}
	club.Games = []GameSummary{}
	for rows.Next() {
		var game GameSummary
		if err := rows.Scan(&game.ID, &game.Name, &game.Slug, &game.HasCover); err != nil {
			rows.Close()
			return AdminClub{}, err
		}
		club.Games = append(club.Games, game)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return AdminClub{}, err
	}
	links, err := db.Query(ctx, `SELECT type, label, url FROM club_links WHERE club_id = $1::uuid ORDER BY position, id`, club.ID)
	if err != nil {
		return AdminClub{}, err
	}
	defer links.Close()
	club.Links = []Link{}
	for links.Next() {
		var link Link
		if err := links.Scan(&link.Type, &link.Label, &link.URL); err != nil {
			return AdminClub{}, err
		}
		club.Links = append(club.Links, link)
	}
	return club, links.Err()
}

// ListAdmin searches club names and slugs, optionally within one school.
// The state filter reads "active" as published and "inactive" as hidden.
func (r *PostgresRepository) ListAdmin(ctx context.Context, filter adminmutation.Filter) ([]AdminClub, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if !slices.Contains([]string{"", "active", "inactive"}, filter.State) {
		return nil, apperror.Validation("invalid club state")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, `SELECT `+adminClubColumns+` FROM clubs c JOIN schools s ON s.id = c.school_id
	 WHERE c.deleted_at IS NULL AND (lower(c.name) LIKE $1 OR c.slug LIKE $1)
	 AND ($2 = '' OR ($2 = 'active' AND c.status = 'published') OR ($2 = 'inactive' AND c.status = 'hidden'))
	 AND ($3::timestamptz IS NULL OR (NOT $5 AND (c.created_at, c.id) < ($3, $4::uuid)) OR ($5 AND (c.created_at, c.id) > ($3, $4::uuid)))
	 AND ($7 = '' OR c.school_id = NULLIF($7, '')::uuid)
	 ORDER BY c.created_at `+order+`, c.id `+order+` LIMIT $6`,
		adminmutation.Contains(filter.Query), filter.State, timestamp, id, before, filter.Limit, filter.School)
	if err != nil {
		return nil, err
	}
	items := make([]AdminClub, 0, filter.Limit)
	for rows.Next() {
		item, err := scanAdminClub(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Each row carries its games and links, as the detail does; a page holds
	// at most 101 clubs.
	for index, item := range items {
		if items[index], err = withDetails(ctx, r.pool, item); err != nil {
			return nil, err
		}
	}
	if before {
		slices.Reverse(items)
	}
	return items, nil
}

// GetAdmin returns a club with its games and links, or adminmutation.ErrNotFound.
func (r *PostgresRepository) GetAdmin(ctx context.Context, id string) (AdminClub, error) {
	if !adminmutation.UUID(id) {
		return AdminClub{}, adminmutation.ErrNotFound
	}
	club, err := scanAdminClub(r.pool.QueryRow(ctx, `SELECT `+adminClubColumns+` FROM clubs c JOIN schools s ON s.id = c.school_id WHERE c.id = $1::uuid`, id))
	if err != nil {
		return AdminClub{}, err
	}
	return withDetails(ctx, r.pool, club)
}

// CreateAdmin creates a published, unclaimed club under an active school and
// audits it in one transaction.
func (r *PostgresRepository) CreateAdmin(ctx context.Context, input AdminCreate) (AdminClub, error) {
	if err := input.Command.Validate(false); err != nil {
		return AdminClub{}, err
	}
	if err := input.AdminFields.Validate(); err != nil {
		return AdminClub{}, err
	}
	if !adminmutation.UUID(input.SchoolID) {
		return AdminClub{}, apperror.Validation("choose a school")
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminClub{}, err
	}
	defer tx.Rollback(ctx)
	var schoolActive bool
	err = tx.QueryRow(ctx, `SELECT is_active AND deleted_at IS NULL FROM schools WHERE id = $1::uuid`, input.SchoolID).Scan(&schoolActive)
	if err != nil {
		return AdminClub{}, adminmutation.Error(err)
	}
	if !schoolActive {
		return AdminClub{}, adminmutation.ErrTransition
	}
	if err := claimSlug(ctx, tx, input.Slug, ""); err != nil {
		return AdminClub{}, err
	}
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO clubs (school_id, name, slug, type, summary, how_to_join)
		VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id::text
	`, input.SchoolID, input.Name, input.Slug, input.Type, input.Summary, input.HowToJoin).Scan(&id); err != nil {
		return AdminClub{}, adminmutation.Error(err)
	}
	if err := setGames(ctx, tx, id, input.GameIDs); err != nil {
		return AdminClub{}, err
	}
	club, err := loadForUpdate(ctx, tx, id)
	if err != nil {
		return AdminClub{}, err
	}
	if err := input.Audit(ctx, tx, adminaudit.ActionClubCreated, adminaudit.EntityClub, id, adminaudit.EmptyState{}, club.auditState()); err != nil {
		return AdminClub{}, err
	}
	return club, tx.Commit(ctx)
}

// UpdateAdmin replaces a club's fields and games. A new slug keeps the old
// one as a redirect.
func (r *PostgresRepository) UpdateAdmin(ctx context.Context, id string, input AdminEdit) (AdminClub, error) {
	if err := input.AdminFields.Validate(); err != nil {
		return AdminClub{}, err
	}
	return r.change(ctx, id, input.Command, adminaudit.ActionClubUpdated, func(tx pgx.Tx, current AdminClub) error {
		if input.Slug != current.Slug {
			if err := claimSlug(ctx, tx, input.Slug, id); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO club_slug_redirects (old_slug, club_id) VALUES ($1, $2::uuid)
				ON CONFLICT (old_slug) DO UPDATE SET club_id = EXCLUDED.club_id
			`, current.Slug, id); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE clubs SET name = $2, slug = $3, type = $4, summary = $5, how_to_join = $6 WHERE id = $1::uuid
		`, id, input.Name, input.Slug, input.Type, input.Summary, input.HowToJoin); err != nil {
			return adminmutation.Error(err)
		}
		return setGames(ctx, tx, id, input.GameIDs)
	}, func(current, next AdminClub) ([]string, error) {
		return adminmutation.EditedFields(current.form(), next.form())
	})
}

// ReplaceLinks replaces a club's links with the given ones, in order.
func (r *PostgresRepository) ReplaceLinks(ctx context.Context, id string, input LinksEdit) (AdminClub, error) {
	for index := range input.Links {
		input.Links[index].Label = strings.TrimSpace(input.Links[index].Label)
		input.Links[index].URL = strings.TrimSpace(input.Links[index].URL)
	}
	if err := validateLinks(input.Links); err != nil {
		return AdminClub{}, err
	}
	return r.change(ctx, id, input.Command, adminaudit.ActionClubLinksReplaced, func(tx pgx.Tx, _ AdminClub) error {
		if _, err := tx.Exec(ctx, `DELETE FROM club_links WHERE club_id = $1::uuid`, id); err != nil {
			return err
		}
		for position, link := range input.Links {
			if _, err := tx.Exec(ctx, `
				INSERT INTO club_links (club_id, type, label, url, position) VALUES ($1::uuid, $2, $3, $4, $5)
			`, id, link.Type, link.Label, link.URL, position); err != nil {
				return err
			}
		}
		return touch(ctx, tx, id)
	}, nil)
}

// HideAdmin takes a published club off the public site.
func (r *PostgresRepository) HideAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminClub, error) {
	return r.setStatus(ctx, id, command, adminaudit.ActionClubHidden, "hidden")
}

// UnhideAdmin publishes a hidden club again.
func (r *PostgresRepository) UnhideAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminClub, error) {
	return r.setStatus(ctx, id, command, adminaudit.ActionClubUnhidden, "published")
}

func (r *PostgresRepository) setStatus(ctx context.Context, id string, command adminmutation.Command, action adminaudit.Action, status string) (AdminClub, error) {
	return r.change(ctx, id, command, action, func(tx pgx.Tx, current AdminClub) error {
		if current.IsActive == (status == "published") {
			return adminmutation.ErrTransition
		}
		_, err := tx.Exec(ctx, `UPDATE clubs SET status = $2 WHERE id = $1::uuid`, id, status)
		return err
	}, nil)
}

// MarkCheckedAdmin records that a site admin re-checked the club's public
// source just now.
func (r *PostgresRepository) MarkCheckedAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminClub, error) {
	return r.change(ctx, id, command, adminaudit.ActionClubChecked, func(tx pgx.Tx, _ AdminClub) error {
		_, err := tx.Exec(ctx, `UPDATE clubs SET confirmed_at = clock_timestamp(), confirmed_source = 'cgn' WHERE id = $1::uuid`, id)
		return err
	}, nil)
}

// change applies one named command under a row lock. It rejects a stale
// version and a deleted club, then audits the before and after states in the
// same transaction.
func (r *PostgresRepository) change(
	ctx context.Context, id string, command adminmutation.Command, action adminaudit.Action,
	apply func(pgx.Tx, AdminClub) error, edited func(current, next AdminClub) ([]string, error),
) (AdminClub, error) {
	if !adminmutation.UUID(id) {
		return AdminClub{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminClub{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminClub{}, err
	}
	defer tx.Rollback(ctx)
	current, err := loadForUpdate(ctx, tx, id)
	if err != nil {
		return AdminClub{}, err
	}
	if !current.UpdatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminClub{}, adminmutation.ErrConflict
	}
	if current.DeletedAt != nil {
		return AdminClub{}, adminmutation.ErrTransition
	}
	if err := apply(tx, current); err != nil {
		return AdminClub{}, err
	}
	next, err := loadForUpdate(ctx, tx, id)
	if err != nil {
		return AdminClub{}, err
	}
	var editedFields []string
	if edited != nil {
		if editedFields, err = edited(current, next); err != nil {
			return AdminClub{}, err
		}
	}
	if err := command.AuditEdit(ctx, tx, action, adminaudit.EntityClub, id, current.auditState(), next.auditState(), editedFields); err != nil {
		return AdminClub{}, err
	}
	return next, tx.Commit(ctx)
}

func loadForUpdate(ctx context.Context, tx pgx.Tx, id string) (AdminClub, error) {
	club, err := scanAdminClub(tx.QueryRow(ctx, `SELECT `+adminClubColumns+` FROM clubs c JOIN schools s ON s.id = c.school_id WHERE c.id = $1::uuid FOR UPDATE OF c`, id))
	if err != nil {
		return AdminClub{}, err
	}
	return withDetails(ctx, tx, club)
}

// claimSlug frees slug for clubID: a redirect that holds it goes, since a
// live club's slug wins over an old link. A slug another club uses now is a
// conflict.
func claimSlug(ctx context.Context, tx pgx.Tx, slug string, clubID string) error {
	var taken bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM clubs WHERE slug = $1 AND id::text <> $2)`, slug, clubID).Scan(&taken); err != nil {
		return err
	}
	if taken {
		return apperror.New(apperror.KindConflict, "admin_record_already_exists", "record already exists")
	}
	_, err := tx.Exec(ctx, `DELETE FROM club_slug_redirects WHERE old_slug = $1`, slug)
	return err
}

// setGames replaces a club's games with active, live ones.
func setGames(ctx context.Context, tx pgx.Tx, id string, gameIDs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM club_games WHERE club_id = $1::uuid`, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO club_games (club_id, game_id)
		SELECT $1::uuid, g.id FROM games g WHERE g.id::text = ANY($2) AND g.deleted_at IS NULL
	`, id, gameIDs)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != len(gameIDs) {
		return apperror.New(apperror.KindUnprocessable, "club_game_not_found", "a chosen game is not in the catalog")
	}
	return nil
}

// touch moves updated_at forward for a change made only in child tables.
func touch(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `UPDATE clubs SET updated_at = clock_timestamp() WHERE id = $1::uuid`, id)
	return err
}

// form is the edit form as the club now stores it, for the audit's list of
// changed fields.
func (club AdminClub) form() AdminFields {
	ids := make([]string, 0, len(club.Games))
	for _, game := range club.Games {
		ids = append(ids, game.ID)
	}
	slices.Sort(ids)
	return AdminFields{Name: club.Name, Slug: club.Slug, Type: club.Type, Summary: club.Summary, HowToJoin: club.HowToJoin, GameIDs: ids}
}

func (club AdminClub) auditState() adminaudit.CatalogState {
	return adminaudit.CatalogState{Slug: club.Slug, Active: club.IsActive, DeletedAt: club.DeletedAt, UpdatedAt: club.UpdatedAt}
}
