package users

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const MinPasswordLength = 8

type Profile struct {
	ID                string       `json:"id"`
	Email             string       `json:"email"`
	EmailVerifiedAt   *time.Time   `json:"email_verified_at,omitempty"`
	VerificationLevel string       `json:"verification_level"`
	Name              string       `json:"name"`
	Bio               string       `json:"bio,omitempty"`
	Timezone          string       `json:"timezone"`
	HomeSchoolID      string       `json:"home_school_id"`
	HomeSchool        *HomeSchool  `json:"home_school,omitempty"`
	SocialLinks       []SocialLink `json:"social_links,omitempty"`
}

type PublicProfile struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	Bio               string       `json:"bio,omitempty"`
	VerificationLevel string       `json:"verification_level"`
	HomeSchoolID      string       `json:"home_school_id"`
	HomeSchool        *HomeSchool  `json:"home_school,omitempty"`
	SocialLinks       []SocialLink `json:"social_links,omitempty"`
}

type HomeSchool struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	City  string `json:"city,omitempty"`
	State string `json:"state,omitempty"`
}

type SocialLink struct {
	ID    string `json:"id,omitempty"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

type Credentials struct {
	Profile      Profile
	PasswordHash string
}

type SignupInput struct {
	Email        string
	Password     string
	Name         string
	HomeSchoolID string
	AgeConfirmed bool
	Timezone     string
}

type CreateParams struct {
	Email          string
	PasswordHash   string
	Name           string
	HomeSchoolID   string
	AgeConfirmedAt time.Time
	Timezone       string
}

type ProfileUpdate struct {
	Name     string
	Bio      string
	Timezone string
}

type Repository interface {
	Create(ctx context.Context, params CreateParams) (Profile, error)
	FindByID(ctx context.Context, id string) (Profile, error)
	FindByEmail(ctx context.Context, email string) (Profile, error)
	UpdateProfile(ctx context.Context, id string, update ProfileUpdate) (Profile, error)
}

type AccountRepository interface {
	Repository
	FindCredentialsByEmail(ctx context.Context, email string) (Credentials, error)
	MarkEmailVerified(ctx context.Context, id string) error
	UpdatePassword(ctx context.Context, id string, passwordHash string) error
	ReplaceSocialLinks(ctx context.Context, id string, links []SocialLink) error
}

func (p Profile) Public() PublicProfile {
	return PublicProfile{
		ID:                p.ID,
		Name:              p.Name,
		Bio:               p.Bio,
		VerificationLevel: p.VerificationLevel,
		HomeSchoolID:      p.HomeSchoolID,
		HomeSchool:        p.HomeSchool,
		SocialLinks:       p.SocialLinks,
	}
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func ValidateSignup(input SignupInput) error {
	email := NormalizeEmail(input.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		return errors.New("email must be valid")
	}
	if len(input.Password) < MinPasswordLength {
		return errors.New("password must be at least 8 characters")
	}
	if name := strings.TrimSpace(input.Name); name == "" || len(name) > 120 {
		return errors.New("name is required and must be 120 characters or fewer")
	}
	if strings.TrimSpace(input.HomeSchoolID) == "" {
		return errors.New("home school is required")
	}
	if !input.AgeConfirmed {
		return errors.New("18+ confirmation is required")
	}
	return nil
}

func ValidateProfileUpdate(update ProfileUpdate, links []SocialLink) error {
	name := strings.TrimSpace(update.Name)
	if name == "" || len(name) > 120 {
		return errors.New("name is required and must be 120 characters or fewer")
	}
	if len(update.Bio) > 2000 {
		return errors.New("bio must be 2,000 characters or fewer")
	}
	timezone := strings.TrimSpace(update.Timezone)
	if timezone == "" {
		return errors.New("timezone is required")
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return errors.New("timezone must be a valid IANA timezone")
	}
	if len(links) > 8 {
		return errors.New("no more than 8 social links are allowed")
	}
	for _, link := range links {
		if label := strings.TrimSpace(link.Label); label == "" || len(label) > 40 {
			return errors.New("social link labels are required and must be 40 characters or fewer")
		}
		if len(link.URL) > 500 {
			return errors.New("social link URLs must be 500 characters or fewer")
		}
		parsed, err := url.Parse(strings.TrimSpace(link.URL))
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
			return errors.New("social link URLs must be valid HTTP or HTTPS URLs")
		}
	}
	return nil
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) Create(ctx context.Context, params CreateParams) (Profile, error) {
	timezone := params.Timezone
	if timezone == "" {
		timezone = "UTC"
	}

	var profile Profile
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, timezone, home_school_id, age_confirmed_at)
		VALUES ($1, $2, $3, $4, $5::uuid, $6)
		RETURNING id::text, email::text, email_verified_at, verification_level,
		          name, COALESCE(bio, ''), timezone, home_school_id::text
	`, NormalizeEmail(params.Email), params.PasswordHash, strings.TrimSpace(params.Name), timezone, params.HomeSchoolID, params.AgeConfirmedAt).Scan(
		&profile.ID,
		&profile.Email,
		&profile.EmailVerifiedAt,
		&profile.VerificationLevel,
		&profile.Name,
		&profile.Bio,
		&profile.Timezone,
		&profile.HomeSchoolID,
	)
	if err != nil {
		return Profile{}, fmt.Errorf("create user: %w", err)
	}
	return profileWithAssociations(ctx, r, profile)
}

func (r *PostgresRepository) FindByID(ctx context.Context, id string) (Profile, error) {
	return r.find(ctx, `u.id = $1::uuid`, id)
}

func (r *PostgresRepository) FindByEmail(ctx context.Context, email string) (Profile, error) {
	return r.find(ctx, `u.email = $1`, NormalizeEmail(email))
}

func (r *PostgresRepository) find(ctx context.Context, predicate string, arg any) (Profile, error) {
	var profile Profile
	err := r.pool.QueryRow(ctx, `
		SELECT u.id::text, u.email::text, u.email_verified_at, u.verification_level,
		       u.name, COALESCE(u.bio, ''), u.timezone, u.home_school_id::text
		FROM users u
		WHERE `+predicate+`
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
	`, arg).Scan(
		&profile.ID,
		&profile.Email,
		&profile.EmailVerifiedAt,
		&profile.VerificationLevel,
		&profile.Name,
		&profile.Bio,
		&profile.Timezone,
		&profile.HomeSchoolID,
	)
	if err != nil {
		return Profile{}, err
	}
	return profileWithAssociations(ctx, r, profile)
}

func (r *PostgresRepository) UpdateProfile(ctx context.Context, id string, update ProfileUpdate) (Profile, error) {
	var profile Profile
	err := r.pool.QueryRow(ctx, `
		UPDATE users
		SET name = $2, bio = NULLIF($3, ''), timezone = $4
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
		RETURNING id::text, email::text, email_verified_at, verification_level,
		          name, COALESCE(bio, ''), timezone, home_school_id::text
	`, id, strings.TrimSpace(update.Name), strings.TrimSpace(update.Bio), strings.TrimSpace(update.Timezone)).Scan(
		&profile.ID,
		&profile.Email,
		&profile.EmailVerifiedAt,
		&profile.VerificationLevel,
		&profile.Name,
		&profile.Bio,
		&profile.Timezone,
		&profile.HomeSchoolID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Profile{}, pgx.ErrNoRows
		}
		return Profile{}, fmt.Errorf("update profile: %w", err)
	}
	return profileWithAssociations(ctx, r, profile)
}

func (r *PostgresRepository) FindCredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	var credentials Credentials
	err := r.pool.QueryRow(ctx, `
		SELECT u.id::text, u.email::text, u.password_hash, u.email_verified_at,
		       u.verification_level, u.name, COALESCE(u.bio, ''), u.timezone,
		       u.home_school_id::text
		FROM users u
		WHERE u.email = $1
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
	`, NormalizeEmail(email)).Scan(
		&credentials.Profile.ID,
		&credentials.Profile.Email,
		&credentials.PasswordHash,
		&credentials.Profile.EmailVerifiedAt,
		&credentials.Profile.VerificationLevel,
		&credentials.Profile.Name,
		&credentials.Profile.Bio,
		&credentials.Profile.Timezone,
		&credentials.Profile.HomeSchoolID,
	)
	if err != nil {
		return Credentials{}, err
	}
	profile, err := profileWithAssociations(ctx, r, credentials.Profile)
	if err != nil {
		return Credentials{}, err
	}
	credentials.Profile = profile
	return credentials, nil
}

func (r *PostgresRepository) MarkEmailVerified(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE users
		SET email_verified_at = COALESCE(email_verified_at, NOW()),
		    verification_level = CASE
				WHEN verification_level = 'basic' THEN 'basic'
				ELSE verification_level
			END
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
	`, id)
	return err
}

func (r *PostgresRepository) UpdatePassword(ctx context.Context, id string, passwordHash string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE users
		SET password_hash = $2
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
	`, id, passwordHash)
	return err
}

func (r *PostgresRepository) ReplaceSocialLinks(ctx context.Context, id string, links []SocialLink) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin social links update: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE user_social_links
		SET deleted_at = NOW()
		WHERE user_id = $1::uuid AND deleted_at IS NULL
	`, id); err != nil {
		return fmt.Errorf("archive social links: %w", err)
	}

	for index, link := range links {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_social_links (user_id, label, url, sort_order)
			VALUES ($1::uuid, $2, $3, $4)
		`, id, strings.TrimSpace(link.Label), strings.TrimSpace(link.URL), index); err != nil {
			return fmt.Errorf("insert social link: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit social links update: %w", err)
	}
	return nil
}

func profileWithAssociations(ctx context.Context, repository *PostgresRepository, profile Profile) (Profile, error) {
	homeSchool, err := repository.getHomeSchool(ctx, profile.HomeSchoolID)
	if err != nil {
		return Profile{}, err
	}
	profile.HomeSchool = homeSchool

	links, err := repository.listSocialLinks(ctx, profile.ID)
	if err != nil {
		return Profile{}, err
	}
	profile.SocialLinks = links
	return profile, nil
}

func (r *PostgresRepository) getHomeSchool(ctx context.Context, id string) (*HomeSchool, error) {
	var school HomeSchool
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, name, slug, COALESCE(city, ''), COALESCE(state, '')
		FROM schools
		WHERE id = $1::uuid AND deleted_at IS NULL
	`, id).Scan(&school.ID, &school.Name, &school.Slug, &school.City, &school.State)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get home school: %w", err)
	}
	return &school, nil
}

func (r *PostgresRepository) listSocialLinks(ctx context.Context, id string) ([]SocialLink, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, label, url
		FROM user_social_links
		WHERE user_id = $1::uuid AND deleted_at IS NULL
		ORDER BY sort_order, id
	`, id)
	if err != nil {
		return nil, fmt.Errorf("list social links: %w", err)
	}
	defer rows.Close()

	links := make([]SocialLink, 0)
	for rows.Next() {
		var link SocialLink
		if err := rows.Scan(&link.ID, &link.Label, &link.URL); err != nil {
			return nil, fmt.Errorf("scan social link: %w", err)
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate social links: %w", err)
	}
	return links, nil
}

func IsDuplicateEmail(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "users_email_key"
}
