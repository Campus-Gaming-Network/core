package schools

import (
	"context"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
)

// AdminFields is the complete editable catalog form, excluding logo storage,
// lifecycle state and IDs. Those have their own named commands.
type AdminFields struct {
	UnitID       *int64   `json:"unitid"`
	Name         string   `json:"name"`
	Alias        string   `json:"alias"`
	Slug         string   `json:"slug"`
	City         string   `json:"city"`
	State        string   `json:"state"`
	Zip          string   `json:"zip"`
	WebsiteURL   string   `json:"website_url"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	IsMainCampus bool     `json:"is_main_campus"`
	NumBranches  int      `json:"num_branches"`
}

type AdminSchool struct {
	AdminFields
	ID        string     `json:"id"`
	LogoURL   string     `json:"logo_url"`
	IsActive  bool       `json:"is_active"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at"`
}

type AdminEdit struct {
	adminmutation.Command
	AdminFields
}

const adminSchoolColumns = `id::text, unitid, name, COALESCE(alias,''), slug,
 COALESCE(city,''), COALESCE(state,''), COALESCE(zip,''), COALESCE(website_url,''),
 latitude, longitude, is_main_campus, num_branches, COALESCE(logo_url,''), is_active, created_at, updated_at, deleted_at`

func scanAdminSchool(row pgx.Row) (AdminSchool, error) {
	var s AdminSchool
	err := row.Scan(&s.ID, &s.UnitID, &s.Name, &s.Alias, &s.Slug, &s.City, &s.State, &s.Zip,
		&s.WebsiteURL, &s.Latitude, &s.Longitude, &s.IsMainCampus, &s.NumBranches, &s.LogoURL,
		&s.IsActive, &s.CreatedAt, &s.UpdatedAt, &s.DeletedAt)
	return s, adminmutation.Error(err)
}

func (fields AdminFields) Validate() error {
	if !adminmutation.Text(fields.Name, 300, true) || !adminmutation.Text(fields.Alias, 300, false) ||
		!adminmutation.Slug(fields.Slug) || !adminmutation.Text(fields.City, 100, false) ||
		!adminmutation.Text(fields.State, 80, false) || !adminmutation.Text(fields.Zip, 20, false) ||
		!adminmutation.URL(fields.WebsiteURL) || fields.NumBranches < 0 || fields.NumBranches > 10000 ||
		(fields.UnitID != nil && *fields.UnitID <= 0) {
		return apperror.Validation("invalid school fields")
	}
	if (fields.Latitude == nil) != (fields.Longitude == nil) {
		return apperror.Validation("coordinates must be supplied together")
	}
	if fields.Latitude != nil && (math.IsNaN(*fields.Latitude) || math.IsInf(*fields.Latitude, 0) || math.Abs(*fields.Latitude) > 90 ||
		math.IsNaN(*fields.Longitude) || math.IsInf(*fields.Longitude, 0) || math.Abs(*fields.Longitude) > 180) {
		return apperror.Validation("invalid coordinates")
	}
	return nil
}

func (r *PostgresRepository) ListAdmin(ctx context.Context, filter adminmutation.Filter) ([]AdminSchool, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if !slices.Contains([]string{"", "active", "inactive", "deleted"}, filter.State) {
		return nil, apperror.Validation("invalid school state")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, `SELECT `+adminSchoolColumns+` FROM schools
	 WHERE (lower(name) LIKE $1 OR lower(COALESCE(alias,'')) LIKE $1 OR slug LIKE $1)
	 AND ($2 = '' OR ($2 = 'active' AND is_active AND deleted_at IS NULL)
	 OR ($2 = 'inactive' AND NOT is_active AND deleted_at IS NULL) OR ($2 = 'deleted' AND deleted_at IS NOT NULL))
	 AND ($3::timestamptz IS NULL OR (NOT $5 AND (created_at,id)<($3,$4::uuid)) OR ($5 AND (created_at,id)>($3,$4::uuid)))
	 ORDER BY created_at `+order+`, id `+order+` LIMIT $6`, adminmutation.Prefix(filter.Query), filter.State, timestamp, id, before, filter.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AdminSchool, 0, filter.Limit)
	for rows.Next() {
		item, err := scanAdminSchool(rows)
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

func (r *PostgresRepository) GetAdmin(ctx context.Context, id string) (AdminSchool, error) {
	if !adminmutation.UUID(id) {
		return AdminSchool{}, adminmutation.ErrNotFound
	}
	return scanAdminSchool(r.pool.QueryRow(ctx, `SELECT `+adminSchoolColumns+` FROM schools WHERE id=$1::uuid`, id))
}

func (r *PostgresRepository) CreateAdmin(ctx context.Context, input AdminEdit) (AdminSchool, error) {
	if err := input.Command.Validate(false); err != nil {
		return AdminSchool{}, err
	}
	if err := input.AdminFields.Validate(); err != nil {
		return AdminSchool{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminSchool{}, err
	}
	defer tx.Rollback(ctx)
	s, err := scanAdminSchool(tx.QueryRow(ctx, `INSERT INTO schools
	 (unitid,name,alias,slug,city,state,zip,website_url,latitude,longitude,is_main_campus,num_branches)
	 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+adminSchoolColumns,
		input.UnitID, strings.TrimSpace(input.Name), input.Alias, input.Slug, input.City, input.State, input.Zip,
		input.WebsiteURL, input.Latitude, input.Longitude, input.IsMainCampus, input.NumBranches))
	if err != nil {
		return AdminSchool{}, err
	}
	if err := input.Audit(ctx, tx, adminaudit.ActionSchoolCreated, adminaudit.EntitySchool, s.ID, adminaudit.EmptyState{}, s.auditState()); err != nil {
		return AdminSchool{}, err
	}
	return s, tx.Commit(ctx)
}

func (r *PostgresRepository) UpdateAdmin(ctx context.Context, id string, input AdminEdit) (AdminSchool, error) {
	if err := input.AdminFields.Validate(); err != nil {
		return AdminSchool{}, err
	}
	return r.changeAdmin(ctx, id, input.Command, adminaudit.ActionSchoolUpdated, &input.AdminFields)
}

func (r *PostgresRepository) DeactivateAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminSchool, error) {
	return r.changeAdmin(ctx, id, command, adminaudit.ActionSchoolDeactivated, nil)
}
func (r *PostgresRepository) ReactivateAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminSchool, error) {
	return r.changeAdmin(ctx, id, command, adminaudit.ActionSchoolReactivated, nil)
}
func (r *PostgresRepository) DeleteAdmin(ctx context.Context, id string, command adminmutation.Command) (AdminSchool, error) {
	return r.changeAdmin(ctx, id, command, adminaudit.ActionSchoolDeleted, nil)
}

func (r *PostgresRepository) changeAdmin(ctx context.Context, id string, command adminmutation.Command, action adminaudit.Action, fields *AdminFields) (AdminSchool, error) {
	if !adminmutation.UUID(id) {
		return AdminSchool{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminSchool{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminSchool{}, err
	}
	defer tx.Rollback(ctx)
	current, err := scanAdminSchool(tx.QueryRow(ctx, `SELECT `+adminSchoolColumns+` FROM schools WHERE id=$1::uuid FOR UPDATE`, id))
	if err != nil {
		return AdminSchool{}, err
	}
	if !current.UpdatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminSchool{}, adminmutation.ErrConflict
	}
	if current.DeletedAt != nil {
		return AdminSchool{}, adminmutation.ErrTransition
	}
	var next AdminSchool
	switch action {
	case adminaudit.ActionSchoolUpdated:
		next, err = scanAdminSchool(tx.QueryRow(ctx, `UPDATE schools SET unitid=$2,name=$3,alias=$4,slug=$5,city=$6,state=$7,zip=$8,website_url=$9,
		 latitude=$10,longitude=$11,is_main_campus=$12,num_branches=$13 WHERE id=$1::uuid RETURNING `+adminSchoolColumns,
			id, fields.UnitID, strings.TrimSpace(fields.Name), fields.Alias, fields.Slug, fields.City, fields.State, fields.Zip, fields.WebsiteURL,
			fields.Latitude, fields.Longitude, fields.IsMainCampus, fields.NumBranches))
	case adminaudit.ActionSchoolDeactivated, adminaudit.ActionSchoolReactivated:
		active := action == adminaudit.ActionSchoolReactivated
		if active == current.IsActive {
			return AdminSchool{}, adminmutation.ErrTransition
		}
		next, err = scanAdminSchool(tx.QueryRow(ctx, `UPDATE schools SET is_active=$2 WHERE id=$1::uuid RETURNING `+adminSchoolColumns, id, active))
	case adminaudit.ActionSchoolDeleted:
		var dependencies bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE home_school_id=$1::uuid)
		 OR EXISTS(SELECT 1 FROM events WHERE host_school_id=$1::uuid)
		 OR EXISTS(SELECT 1 FROM teams WHERE school_id=$1::uuid)
		 OR EXISTS(SELECT 1 FROM user_school_follows WHERE school_id=$1::uuid AND deleted_at IS NULL)
		 OR EXISTS(SELECT 1 FROM school_admins WHERE school_id=$1::uuid AND deleted_at IS NULL)`, id).Scan(&dependencies)
		if err != nil {
			return AdminSchool{}, err
		}
		if dependencies {
			return AdminSchool{}, adminmutation.ErrDependencies
		}
		next, err = scanAdminSchool(tx.QueryRow(ctx, `UPDATE schools SET is_active=false,deleted_at=clock_timestamp() WHERE id=$1::uuid RETURNING `+adminSchoolColumns, id))
	}
	if err != nil {
		return AdminSchool{}, err
	}
	if err := command.Audit(ctx, tx, action, adminaudit.EntitySchool, id, current.auditState(), next.auditState()); err != nil {
		return AdminSchool{}, err
	}
	return next, tx.Commit(ctx)
}

func (school AdminSchool) auditState() adminaudit.CatalogState {
	return adminaudit.CatalogState{Slug: school.Slug, Active: school.IsActive, DeletedAt: school.DeletedAt, UpdatedAt: school.UpdatedAt}
}
