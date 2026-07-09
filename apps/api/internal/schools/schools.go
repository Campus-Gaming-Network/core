package schools

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type School struct {
	ID           string   `json:"id"`
	UnitID       *int64   `json:"unitid,omitempty"`
	Name         string   `json:"name"`
	Alias        string   `json:"alias,omitempty"`
	Slug         string   `json:"slug"`
	City         string   `json:"city,omitempty"`
	State        string   `json:"state,omitempty"`
	Zip          string   `json:"zip,omitempty"`
	WebsiteURL   string   `json:"website_url,omitempty"`
	Latitude     *float64 `json:"latitude,omitempty"`
	Longitude    *float64 `json:"longitude,omitempty"`
	IsMainCampus bool     `json:"is_main_campus"`
	NumBranches  int      `json:"num_branches"`
}

type ListParams struct {
	Query  string
	State  string
	Limit  int
	Offset int
}

type Repository interface {
	List(ctx context.Context, params ListParams) ([]School, error)
	GetByID(ctx context.Context, id string) (School, error)
	GetBySlug(ctx context.Context, slug string) (School, error)
	ExistsActive(ctx context.Context, id string) (bool, error)
}

type FollowRepository interface {
	Follow(ctx context.Context, userID string, schoolID string) error
	Unfollow(ctx context.Context, userID string, schoolID string) error
	IsFollowing(ctx context.Context, userID string, schoolID string) (bool, error)
}

var ErrSchoolNotFound = fmt.Errorf("school not found")

func NormalizeListParams(params ListParams) ListParams {
	if params.Limit < 1 || params.Limit > 100 {
		params.Limit = 25
	}
	if params.Offset < 0 {
		params.Offset = 0
	}
	params.Query = strings.TrimSpace(params.Query)
	params.State = strings.ToUpper(strings.TrimSpace(params.State))
	return params
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) List(ctx context.Context, params ListParams) ([]School, error) {
	params = NormalizeListParams(params)
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, unitid, name, COALESCE(alias, ''), slug,
		       COALESCE(city, ''), COALESCE(state, ''), COALESCE(zip, ''),
		       COALESCE(website_url, ''), latitude, longitude,
		       is_main_campus, num_branches
		FROM schools
		WHERE deleted_at IS NULL AND is_active = TRUE
		  AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR COALESCE(alias, '') ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR state = $2)
		ORDER BY name, city, id
		LIMIT $3 OFFSET $4
	`, params.Query, params.State, params.Limit, params.Offset)
	if err != nil {
		return nil, fmt.Errorf("list schools: %w", err)
	}
	defer rows.Close()

	result := make([]School, 0, params.Limit)
	for rows.Next() {
		var school School
		if err := rows.Scan(
			&school.ID, &school.UnitID, &school.Name, &school.Alias, &school.Slug,
			&school.City, &school.State, &school.Zip, &school.WebsiteURL,
			&school.Latitude, &school.Longitude, &school.IsMainCampus, &school.NumBranches,
		); err != nil {
			return nil, fmt.Errorf("scan school: %w", err)
		}
		result = append(result, school)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate schools: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, id string) (School, error) {
	return r.find(ctx, "id = $1::uuid", id)
}

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (School, error) {
	return r.find(ctx, "slug = $1", strings.TrimSpace(slug))
}

func (r *PostgresRepository) find(ctx context.Context, predicate string, arg any) (School, error) {
	var school School
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, unitid, name, COALESCE(alias, ''), slug,
		       COALESCE(city, ''), COALESCE(state, ''), COALESCE(zip, ''),
		       COALESCE(website_url, ''), latitude, longitude,
		       is_main_campus, num_branches
		FROM schools
		WHERE `+predicate+` AND deleted_at IS NULL AND is_active = TRUE
	`, arg).Scan(
		&school.ID, &school.UnitID, &school.Name, &school.Alias, &school.Slug,
		&school.City, &school.State, &school.Zip, &school.WebsiteURL,
		&school.Latitude, &school.Longitude, &school.IsMainCampus, &school.NumBranches,
	)
	if err != nil {
		return School{}, err
	}
	return school, nil
}

func (r *PostgresRepository) ExistsActive(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM schools
			WHERE id = $1::uuid AND deleted_at IS NULL AND is_active = TRUE
		)
	`, id).Scan(&exists)
	return exists, err
}

func (r *PostgresRepository) Follow(ctx context.Context, userID string, schoolID string) error {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO user_school_follows (user_id, school_id)
		SELECT $1::uuid, id
		FROM schools
		WHERE id = $2::uuid AND deleted_at IS NULL AND is_active = TRUE
		ON CONFLICT (user_id, school_id)
		DO UPDATE SET deleted_at = NULL, updated_at = NOW()
	`, userID, schoolID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrSchoolNotFound
	}
	return nil
}

func (r *PostgresRepository) Unfollow(ctx context.Context, userID string, schoolID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE user_school_follows
		SET deleted_at = NOW()
		WHERE user_id = $1::uuid AND school_id = $2::uuid AND deleted_at IS NULL
	`, userID, schoolID)
	return err
}

func (r *PostgresRepository) IsFollowing(ctx context.Context, userID string, schoolID string) (bool, error) {
	var following bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_school_follows
			WHERE user_id = $1::uuid AND school_id = $2::uuid AND deleted_at IS NULL
		)
	`, userID, schoolID).Scan(&following)
	return following, err
}
