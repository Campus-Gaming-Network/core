// Package schools provides the school catalog and follow operations.
package schools

import (
	"context"
	"errors"
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
	ListFollowed(ctx context.Context, userID string) ([]School, error)
}

// ErrSchoolNotFound indicates that an active school does not exist.
var ErrSchoolNotFound = errors.New("school not found")

// NormalizeListParams applies the catalog's pagination and filter defaults.
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

const schoolColumns = `
	s.id::text, s.unitid, s.name, COALESCE(s.alias, ''), s.slug,
	COALESCE(s.city, ''), COALESCE(s.state, ''), COALESCE(s.zip, ''),
	COALESCE(s.website_url, ''), s.latitude, s.longitude,
	s.is_main_campus, s.num_branches
`

type schoolScanner interface {
	Scan(dest ...any) error
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) List(ctx context.Context, params ListParams) ([]School, error) {
	params = NormalizeListParams(params)
	rows, err := r.pool.Query(ctx, `
		SELECT `+schoolColumns+`
		FROM schools s
		WHERE s.deleted_at IS NULL AND s.is_active = TRUE
		  AND ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR COALESCE(s.alias, '') ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR s.state = $2)
		ORDER BY s.name, s.city, s.id
		LIMIT $3 OFFSET $4
	`, params.Query, params.State, params.Limit, params.Offset)
	if err != nil {
		return nil, fmt.Errorf("list schools: %w", err)
	}
	defer rows.Close()

	result := make([]School, 0, params.Limit)
	for rows.Next() {
		school, err := scanSchool(rows)
		if err != nil {
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
	return r.find(ctx, "s.id = $1::uuid", id)
}

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (School, error) {
	return r.find(ctx, "s.slug = $1", strings.TrimSpace(slug))
}

func (r *PostgresRepository) find(ctx context.Context, predicate string, arg any) (School, error) {
	return scanSchool(r.pool.QueryRow(ctx, `
		SELECT `+schoolColumns+`
		FROM schools s
		WHERE `+predicate+` AND s.deleted_at IS NULL AND s.is_active = TRUE
	`, arg))
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

func (r *PostgresRepository) ListFollowed(ctx context.Context, userID string) ([]School, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+schoolColumns+`
		FROM user_school_follows f
		JOIN schools s ON s.id = f.school_id
		WHERE f.user_id = $1::uuid
		  AND f.deleted_at IS NULL
		  AND s.deleted_at IS NULL
		  AND s.is_active = TRUE
		ORDER BY s.name, s.city, s.id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list followed schools: %w", err)
	}
	defer rows.Close()

	result := make([]School, 0)
	for rows.Next() {
		school, err := scanSchool(rows)
		if err != nil {
			return nil, fmt.Errorf("scan followed school: %w", err)
		}
		result = append(result, school)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate followed schools: %w", err)
	}
	return result, nil
}

func scanSchool(scanner schoolScanner) (School, error) {
	var school School
	err := scanner.Scan(
		&school.ID, &school.UnitID, &school.Name, &school.Alias, &school.Slug,
		&school.City, &school.State, &school.Zip, &school.WebsiteURL,
		&school.Latitude, &school.Longitude, &school.IsMainCampus, &school.NumBranches,
	)
	if err != nil {
		return School{}, err
	}
	return school, nil
}
