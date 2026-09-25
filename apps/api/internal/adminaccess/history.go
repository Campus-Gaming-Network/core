package adminaccess

import (
	"context"
	"slices"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
)

const grantColumns = `id::text,user_id::text,role,granted_by_user_id::text,grant_reason,granted_at,revoked_at,revoked_by_user_id::text,revoke_reason`

func (r *PostgresRepository) GetGrant(ctx context.Context, id string) (Grant, error) {
	if !adminmutation.UUID(id) {
		return Grant{}, adminmutation.ErrNotFound
	}
	g, err := scanGrant(r.pool.QueryRow(ctx, `SELECT `+grantColumns+` FROM site_role_grants WHERE id=$1::uuid`, id))
	return g, adminmutation.Error(err)
}

func (r *PostgresRepository) ListGrants(ctx context.Context, filter adminmutation.Filter) ([]Grant, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if filter.Query != "" || !slices.Contains([]string{"", "active", "revoked"}, filter.State) {
		return nil, apperror.Validation("invalid site grant filter")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, `SELECT `+grantColumns+` FROM site_role_grants
	 WHERE ($1='' OR ($1='active' AND revoked_at IS NULL) OR ($1='revoked' AND revoked_at IS NOT NULL))
	 AND ($2::timestamptz IS NULL OR (NOT $4 AND (granted_at,id)<($2,$3::uuid)) OR ($4 AND (granted_at,id)>($2,$3::uuid)))
	 ORDER BY granted_at `+order+`,id `+order+` LIMIT $5`, filter.State, timestamp, id, before, filter.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Grant, 0, filter.Limit)
	for rows.Next() {
		item, err := scanGrant(rows)
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
