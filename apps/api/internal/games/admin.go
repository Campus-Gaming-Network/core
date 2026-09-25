package games

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

type AdminGame struct {
	Game
	IsActive  bool       `json:"is_active"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at"`
}

type AdminEdit struct {
	adminmutation.Command
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	CoverURL string `json:"cover_url"`
	IsActive bool   `json:"is_active"`
}

const adminGameColumns = `id::text,name,slug,COALESCE(cover_url,''),is_active,created_at,updated_at,deleted_at`

func scanAdminGame(row pgx.Row) (AdminGame, error) {
	var g AdminGame
	err := row.Scan(&g.ID, &g.Name, &g.Slug, &g.CoverURL, &g.IsActive, &g.CreatedAt, &g.UpdatedAt, &g.DeletedAt)
	return g, adminmutation.Error(err)
}

func (r *PostgresRepository) ListAdmin(ctx context.Context, filter adminmutation.Filter) ([]AdminGame, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if !slices.Contains([]string{"", "active", "inactive", "deleted"}, filter.State) {
		return nil, apperror.Validation("invalid game state")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, `SELECT `+adminGameColumns+` FROM games
	 WHERE (lower(name) LIKE $1 OR slug LIKE $1)
	 AND ($2='' OR ($2='active' AND is_active AND deleted_at IS NULL) OR ($2='inactive' AND NOT is_active AND deleted_at IS NULL) OR ($2='deleted' AND deleted_at IS NOT NULL))
	 AND ($3::timestamptz IS NULL OR (NOT $5 AND (created_at,id)<($3,$4::uuid)) OR ($5 AND (created_at,id)>($3,$4::uuid)))
	 ORDER BY created_at `+order+`,id `+order+` LIMIT $6`, adminmutation.Prefix(filter.Query), filter.State, timestamp, id, before, filter.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AdminGame, 0, filter.Limit)
	for rows.Next() {
		item, err := scanAdminGame(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if before {
		slices.Reverse(items)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) GetAdmin(ctx context.Context, id string) (AdminGame, error) {
	if !adminmutation.UUID(id) {
		return AdminGame{}, adminmutation.ErrNotFound
	}
	return scanAdminGame(r.pool.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE id=$1::uuid`, id))
}

func (r *PostgresRepository) CreateAdmin(ctx context.Context, input AdminEdit) (AdminGame, error) {
	return r.writeAdmin(ctx, "", input, false)
}
func (r *PostgresRepository) UpdateAdmin(ctx context.Context, id string, input AdminEdit) (AdminGame, error) {
	if !adminmutation.UUID(id) {
		return AdminGame{}, adminmutation.ErrNotFound
	}
	return r.writeAdmin(ctx, id, input, false)
}
func (r *PostgresRepository) DeleteAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminGame, error) {
	if !adminmutation.UUID(id) {
		return AdminGame{}, adminmutation.ErrNotFound
	}
	return r.writeAdmin(ctx, id, AdminEdit{Command: command}, true)
}

func (r *PostgresRepository) writeAdmin(ctx context.Context, id string, input AdminEdit, remove bool) (AdminGame, error) {
	if err := input.Command.Validate(id != ""); err != nil {
		return AdminGame{}, err
	}
	if !remove && (!adminmutation.Text(input.Name, 200, true) || !adminmutation.Slug(input.Slug) || !adminmutation.URL(input.CoverURL)) {
		return AdminGame{}, apperror.Validation("invalid game fields")
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminGame{}, err
	}
	defer tx.Rollback(ctx)
	var before adminaudit.State = adminaudit.EmptyState{}
	if id != "" {
		current, err := scanAdminGame(tx.QueryRow(ctx, `SELECT `+adminGameColumns+` FROM games WHERE id=$1::uuid FOR UPDATE`, id))
		if err != nil {
			return AdminGame{}, err
		}
		if !current.UpdatedAt.Equal(input.ExpectedUpdatedAt) {
			return AdminGame{}, adminmutation.ErrConflict
		}
		if current.DeletedAt != nil {
			return AdminGame{}, adminmutation.ErrTransition
		}
		before = current.auditState()
	}
	var next AdminGame
	action := adminaudit.ActionGameUpdated
	switch {
	case remove:
		var dependencies bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM event_games WHERE game_id=$1::uuid) OR EXISTS(SELECT 1 FROM team_games WHERE game_id=$1::uuid)`, id).Scan(&dependencies); err != nil {
			return AdminGame{}, err
		}
		if dependencies {
			return AdminGame{}, adminmutation.ErrDependencies
		}
		next, err = scanAdminGame(tx.QueryRow(ctx, `UPDATE games SET is_active=false,deleted_at=clock_timestamp() WHERE id=$1::uuid RETURNING `+adminGameColumns, id))
		action = adminaudit.ActionGameDeleted
	case id == "":
		next, err = scanAdminGame(tx.QueryRow(ctx, `INSERT INTO games(name,slug,cover_url,is_active) VALUES($1,$2,$3,$4) RETURNING `+adminGameColumns, strings.TrimSpace(input.Name), input.Slug, input.CoverURL, input.IsActive))
		action = adminaudit.ActionGameCreated
	default:
		next, err = scanAdminGame(tx.QueryRow(ctx, `UPDATE games SET name=$2,slug=$3,cover_url=$4,is_active=$5 WHERE id=$1::uuid RETURNING `+adminGameColumns, id, strings.TrimSpace(input.Name), input.Slug, input.CoverURL, input.IsActive))
	}
	if err != nil {
		return AdminGame{}, err
	}
	if err := input.Audit(ctx, tx, action, adminaudit.EntityGame, next.ID, before, next.auditState()); err != nil {
		return AdminGame{}, err
	}
	return next, tx.Commit(ctx)
}

func (game AdminGame) auditState() adminaudit.CatalogState {
	return adminaudit.CatalogState{Slug: game.Slug, Active: game.IsActive, DeletedAt: game.DeletedAt, UpdatedAt: game.UpdatedAt}
}
