package schools

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
)

type AdminGrant struct {
	ID        string     `json:"id"`
	SchoolID  string     `json:"school_id"`
	UserID    string     `json:"user_id"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}
type GrantAdminInput struct {
	adminmutation.Command
	UserID string `json:"user_id"`
}

const adminGrantColumns = `id::text,school_id::text,user_id::text,created_at,updated_at,deleted_at`

func (r *PostgresRepository) GetAdminGrant(ctx context.Context, schoolID, grantID string) (AdminGrant, error) {
	if !adminmutation.UUID(schoolID) || !adminmutation.UUID(grantID) {
		return AdminGrant{}, adminmutation.ErrNotFound
	}
	grant, err := scanAdminGrant(r.pool.QueryRow(ctx, `SELECT `+adminGrantColumns+` FROM school_admins WHERE school_id=$1::uuid AND id=$2::uuid`, schoolID, grantID))
	return grant, adminmutation.Error(err)
}

func scanAdminGrant(row pgx.Row) (AdminGrant, error) {
	var g AdminGrant
	err := row.Scan(&g.ID, &g.SchoolID, &g.UserID, &g.CreatedAt, &g.UpdatedAt, &g.RevokedAt)
	return g, err
}

func (r *PostgresRepository) ListAdminGrants(ctx context.Context, schoolID string, filter adminmutation.Filter) ([]AdminGrant, error) {
	if _, err := r.GetAdmin(ctx, schoolID); err != nil {
		return nil, err
	}
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if filter.Query != "" || !slices.Contains([]string{"", "active", "revoked"}, filter.State) {
		return nil, apperror.Validation("invalid school grant filter")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, `SELECT `+adminGrantColumns+` FROM school_admins WHERE school_id=$1::uuid
	 AND ($2='' OR ($2='active' AND deleted_at IS NULL) OR ($2='revoked' AND deleted_at IS NOT NULL))
	 AND ($3::timestamptz IS NULL OR (NOT $5 AND (created_at,id)<($3,$4::uuid)) OR ($5 AND (created_at,id)>($3,$4::uuid)))
	 ORDER BY created_at `+order+`,id `+order+` LIMIT $6`, schoolID, filter.State, timestamp, id, before, filter.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AdminGrant, 0, filter.Limit)
	for rows.Next() {
		item, err := scanAdminGrant(rows)
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

func (r *PostgresRepository) GrantAdmin(ctx context.Context, schoolID string, input GrantAdminInput) (AdminGrant, error) {
	if !adminmutation.UUID(input.UserID) {
		return AdminGrant{}, apperror.Validation("invalid grant user")
	}
	return r.changeAdminGrant(ctx, schoolID, "", input.UserID, input.Command)
}
func (r *PostgresRepository) RevokeAdmin(ctx context.Context, schoolID, grantID string, command adminmutation.Command) (AdminGrant, error) {
	if !adminmutation.UUID(grantID) {
		return AdminGrant{}, adminmutation.ErrNotFound
	}
	return r.changeAdminGrant(ctx, schoolID, grantID, "", command)
}

func (r *PostgresRepository) changeAdminGrant(ctx context.Context, schoolID, grantID, userID string, command adminmutation.Command) (AdminGrant, error) {
	if !adminmutation.UUID(schoolID) {
		return AdminGrant{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(grantID != ""); err != nil {
		return AdminGrant{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminGrant{}, err
	}
	defer tx.Rollback(ctx)
	// Serialize grant/regrant on the school before taking a user or grant lock.
	school, err := scanAdminSchool(tx.QueryRow(ctx, `SELECT `+adminSchoolColumns+` FROM schools WHERE id=$1::uuid FOR UPDATE`, schoolID))
	if err != nil {
		return AdminGrant{}, err
	}
	if grantID == "" && (!school.IsActive || school.DeletedAt != nil) {
		return AdminGrant{}, adminmutation.ErrTransition
	}
	var current AdminGrant
	if grantID != "" {
		current, err = scanAdminGrant(tx.QueryRow(ctx, `SELECT `+adminGrantColumns+` FROM school_admins WHERE school_id=$1::uuid AND id=$2::uuid FOR UPDATE`, schoolID, grantID))
	} else {
		var eligible bool
		err = tx.QueryRow(ctx, `SELECT deleted_at IS NULL AND account_status='active' AND email_verified_at IS NOT NULL FROM users WHERE id=$1::uuid FOR UPDATE`, userID).Scan(&eligible)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !eligible) {
			return AdminGrant{}, adminmutation.ErrIneligible
		}
		if err != nil {
			return AdminGrant{}, err
		}
		current, err = scanAdminGrant(tx.QueryRow(ctx, `SELECT `+adminGrantColumns+` FROM school_admins WHERE school_id=$1::uuid AND user_id=$2::uuid FOR UPDATE`, schoolID, userID))
	}
	exists := err == nil
	if err != nil && (!errors.Is(err, pgx.ErrNoRows) || grantID != "") {
		return AdminGrant{}, adminmutation.Error(err)
	}
	if exists && !current.UpdatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminGrant{}, adminmutation.ErrConflict
	}
	if !exists && !command.ExpectedUpdatedAt.IsZero() {
		return AdminGrant{}, adminmutation.ErrConflict
	}
	if exists && ((grantID != "" && current.RevokedAt != nil) || (grantID == "" && current.RevokedAt == nil)) {
		return AdminGrant{}, adminmutation.ErrTransition
	}
	var before adminaudit.State = adminaudit.EmptyState{}
	if exists {
		before = current.auditState()
	}
	var next AdminGrant
	action := adminaudit.ActionSchoolGrantGranted
	switch {
	case grantID != "":
		next, err = scanAdminGrant(tx.QueryRow(ctx, `UPDATE school_admins SET deleted_at=clock_timestamp() WHERE id=$1::uuid RETURNING `+adminGrantColumns, grantID))
		action = adminaudit.ActionSchoolGrantRevoked
	case exists:
		next, err = scanAdminGrant(tx.QueryRow(ctx, `UPDATE school_admins SET deleted_at=NULL WHERE id=$1::uuid RETURNING `+adminGrantColumns, current.ID))
	default:
		next, err = scanAdminGrant(tx.QueryRow(ctx, `INSERT INTO school_admins(school_id,user_id) VALUES($1::uuid,$2::uuid) RETURNING `+adminGrantColumns, schoolID, userID))
	}
	if err != nil {
		return AdminGrant{}, adminmutation.Error(err)
	}
	if grantID != "" {
		if err := adminmutation.RevokeSessions(ctx, tx, next.UserID, command, "school_grant_revoked"); err != nil {
			return AdminGrant{}, err
		}
	}
	if err := command.Audit(ctx, tx, action, adminaudit.EntitySchoolGrant, next.ID, before, next.auditState()); err != nil {
		return AdminGrant{}, err
	}
	return next, tx.Commit(ctx)
}

func (grant AdminGrant) auditState() adminaudit.SchoolGrantState {
	return adminaudit.SchoolGrantState{SchoolID: grant.SchoolID, UserID: grant.UserID, RevokedAt: grant.RevokedAt, UpdatedAt: grant.UpdatedAt}
}
