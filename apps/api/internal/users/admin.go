package users

import (
	"context"
	"slices"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
)

// AdminUser deliberately omits credentials, tokens, biography and social links.
type AdminUser struct {
	ID                string     `json:"id"`
	Email             string     `json:"email"`
	Name              string     `json:"name"`
	HomeSchoolID      string     `json:"home_school_id"`
	EmailVerifiedAt   *time.Time `json:"email_verified_at"`
	VerificationLevel string     `json:"verification_level"`
	AccountStatus     string     `json:"account_status"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	DeletedAt         *time.Time `json:"deleted_at"`
	SiteAdmin         bool       `json:"site_admin"`
	SchoolAdminCount  int        `json:"school_admin_count"`
}

type TrustChange struct {
	adminmutation.Command
	StaffFaculty *bool `json:"staff_faculty"`
}

const adminUserColumns = `u.id::text,u.email::text,u.name,u.home_school_id::text,u.email_verified_at,u.verification_level,
 u.account_status,u.created_at,u.updated_at,u.deleted_at,
 EXISTS(SELECT 1 FROM site_role_grants g WHERE g.user_id=u.id AND g.revoked_at IS NULL),
 (SELECT count(*) FROM school_admins s WHERE s.user_id=u.id AND s.deleted_at IS NULL)`

func scanAdminUser(row pgx.Row) (AdminUser, error) {
	var u AdminUser
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.HomeSchoolID, &u.EmailVerifiedAt, &u.VerificationLevel, &u.AccountStatus,
		&u.CreatedAt, &u.UpdatedAt, &u.DeletedAt, &u.SiteAdmin, &u.SchoolAdminCount)
	return u, adminmutation.Error(err)
}

func (r *PostgresRepository) ListAdmin(ctx context.Context, filter adminmutation.Filter) ([]AdminUser, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if !slices.Contains([]string{"", "active", "suspended", "deleted"}, filter.State) {
		return nil, apperror.Validation("invalid user state")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, `SELECT `+adminUserColumns+` FROM users u
	 WHERE (lower(u.email::text) LIKE $1 OR lower(u.name) LIKE $1)
	 AND ($2='' OR u.account_status=$2)
	 AND ($3::timestamptz IS NULL OR (NOT $5 AND (u.created_at,u.id)<($3,$4::uuid)) OR ($5 AND (u.created_at,u.id)>($3,$4::uuid)))
	 ORDER BY u.created_at `+order+`,u.id `+order+` LIMIT $6`, adminmutation.Prefix(filter.Query), filter.State, timestamp, id, before, filter.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AdminUser, 0, filter.Limit)
	for rows.Next() {
		item, err := scanAdminUser(rows)
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

func (r *PostgresRepository) GetAdmin(ctx context.Context, id string) (AdminUser, error) {
	if !adminmutation.UUID(id) {
		return AdminUser{}, adminmutation.ErrNotFound
	}
	return scanAdminUser(r.pool.QueryRow(ctx, `SELECT `+adminUserColumns+` FROM users u WHERE u.id=$1::uuid`, id))
}

func (r *PostgresRepository) SuspendAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminUser, error) {
	return r.changeAdmin(ctx, id, command, adminaudit.ActionUserSuspended, nil)
}
func (r *PostgresRepository) ReactivateAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminUser, error) {
	return r.changeAdmin(ctx, id, command, adminaudit.ActionUserReactivated, nil)
}
func (r *PostgresRepository) ChangeTrustAdmin(ctx context.Context, id string, input TrustChange) (AdminUser, error) {
	if input.StaffFaculty == nil {
		return AdminUser{}, apperror.Validation("staff_faculty is required")
	}
	return r.changeAdmin(ctx, id, input.Command, adminaudit.ActionTrustChanged, input.StaffFaculty)
}

func (r *PostgresRepository) changeAdmin(ctx context.Context, id string, command adminmutation.Command, action adminaudit.Action, staff *bool) (AdminUser, error) {
	if !adminmutation.UUID(id) {
		return AdminUser{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminUser{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminUser{}, err
	}
	defer tx.Rollback(ctx)
	// Same lock order as grant/revoke and the operator CLI.
	if _, err := tx.Exec(ctx, `LOCK TABLE site_role_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return AdminUser{}, err
	}
	current, err := scanAdminUser(tx.QueryRow(ctx, `SELECT `+adminUserColumns+` FROM users u WHERE u.id=$1::uuid FOR UPDATE OF u`, id))
	if err != nil {
		return AdminUser{}, err
	}
	if !current.UpdatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminUser{}, adminmutation.ErrConflict
	}
	if current.DeletedAt != nil || current.AccountStatus == "deleted" {
		return AdminUser{}, adminmutation.ErrTransition
	}
	status, level := current.AccountStatus, current.VerificationLevel
	switch action {
	case adminaudit.ActionUserSuspended:
		if status != "active" {
			return AdminUser{}, adminmutation.ErrTransition
		}
		if current.SiteAdmin {
			var otherAdmin bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM site_role_grants g JOIN users u ON u.id=g.user_id
			 WHERE g.revoked_at IS NULL AND g.role='site_admin' AND u.id<>$1::uuid AND u.deleted_at IS NULL AND u.account_status='active' AND u.email_verified_at IS NOT NULL)`, id).Scan(&otherAdmin); err != nil {
				return AdminUser{}, err
			}
			if !otherAdmin {
				return AdminUser{}, adminaccess.ErrLastActiveSiteAdmin
			}
		}
		status = "suspended"
	case adminaudit.ActionUserReactivated:
		if status != "suspended" {
			return AdminUser{}, adminmutation.ErrTransition
		}
		status = "active"
	case adminaudit.ActionTrustChanged:
		if status != "active" || current.EmailVerifiedAt == nil {
			return AdminUser{}, adminmutation.ErrIneligible
		}
		if *staff == (level == "staff_faculty") {
			return AdminUser{}, adminmutation.ErrTransition
		}
		if *staff {
			level = "staff_faculty"
		} else {
			level = VerificationLevelAfterEmailVerification(current.Email, "basic")
		}
	}
	next, err := scanAdminUser(tx.QueryRow(ctx, `UPDATE users u SET account_status=$2,verification_level=$3 WHERE id=$1::uuid RETURNING `+adminUserColumns, id, status, level))
	if err != nil {
		return AdminUser{}, err
	}
	if action == adminaudit.ActionUserSuspended || (staff != nil && !*staff) {
		if err := adminmutation.RevokeSessions(ctx, tx, id, command, string(action)); err != nil {
			return AdminUser{}, err
		}
	}
	if err := command.Audit(ctx, tx, action, adminaudit.EntityUser, id,
		adminaudit.AccountState{Status: current.AccountStatus, VerificationLevel: current.VerificationLevel},
		adminaudit.AccountState{Status: next.AccountStatus, VerificationLevel: next.VerificationLevel}); err != nil {
		return AdminUser{}, err
	}
	return next, tx.Commit(ctx)
}
