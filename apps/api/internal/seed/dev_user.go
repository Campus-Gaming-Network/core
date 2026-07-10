package seed

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultDevUserName       = "Dev Player"
	defaultDevUserSchoolSlug = "university-of-california-irvine"
	defaultDevUserTimezone   = "America/Los_Angeles"
)

type DevUserInput struct {
	Email               string
	Password            string
	Name                string
	HomeSchoolSlug      string
	Timezone            string
	FollowedSchoolSlugs []string
}

type DevUserResult struct {
	UserID        string
	Email         string
	FollowedCount int
}

func EnsureDevUser(ctx context.Context, pool *pgxpool.Pool, input DevUserInput) (DevUserResult, bool, error) {
	input, enabled, err := normalizeDevUserInput(input)
	if err != nil || !enabled {
		return DevUserResult{}, enabled, err
	}

	homeSchoolID, err := schoolIDBySlug(ctx, pool, input.HomeSchoolSlug)
	if err != nil {
		return DevUserResult{}, true, err
	}

	passwordHash, err := auth.HashPassword(input.Password)
	if err != nil {
		return DevUserResult{}, true, fmt.Errorf("hash dev user password: %w", err)
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (
			email, password_hash, email_verified_at, verification_level,
			name, timezone, home_school_id, age_confirmed_at, account_status
		)
		VALUES ($1, $2, NOW(), 'basic', $3, $4, $5::uuid, NOW(), 'active')
		ON CONFLICT (email)
		DO UPDATE SET
			password_hash = EXCLUDED.password_hash,
			email_verified_at = COALESCE(users.email_verified_at, NOW()),
			verification_level = CASE
				WHEN users.verification_level = 'staff_faculty' THEN users.verification_level
				ELSE 'basic'
			END,
			name = EXCLUDED.name,
			timezone = EXCLUDED.timezone,
			home_school_id = EXCLUDED.home_school_id,
			account_status = 'active',
			deleted_at = NULL
		RETURNING id::text
	`, input.Email, passwordHash, input.Name, input.Timezone, homeSchoolID).Scan(&userID); err != nil {
		return DevUserResult{}, true, fmt.Errorf("upsert dev user: %w", err)
	}

	followedCount := 0
	for _, slug := range input.FollowedSchoolSlugs {
		if slug == input.HomeSchoolSlug {
			continue
		}
		schoolID, err := schoolIDBySlug(ctx, pool, slug)
		if err != nil {
			return DevUserResult{}, true, err
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO user_school_follows (user_id, school_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT (user_id, school_id)
			DO UPDATE SET deleted_at = NULL, updated_at = NOW()
		`, userID, schoolID); err != nil {
			return DevUserResult{}, true, fmt.Errorf("follow dev user school %q: %w", slug, err)
		}
		followedCount++
	}

	return DevUserResult{
		UserID:        userID,
		Email:         input.Email,
		FollowedCount: followedCount,
	}, true, nil
}

func normalizeDevUserInput(input DevUserInput) (DevUserInput, bool, error) {
	input.Email = users.NormalizeEmail(input.Email)
	if input.Email == "" {
		return input, false, nil
	}
	if _, err := mail.ParseAddress(input.Email); err != nil {
		return input, true, errors.New("dev user email must be valid")
	}
	if len(input.Password) < users.MinPasswordLength {
		return input, true, errors.New("dev user password must be at least 8 characters")
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		input.Name = defaultDevUserName
	}
	input.HomeSchoolSlug = normalizeSlug(input.HomeSchoolSlug)
	if input.HomeSchoolSlug == "" {
		input.HomeSchoolSlug = defaultDevUserSchoolSlug
	}
	input.Timezone = strings.TrimSpace(input.Timezone)
	if input.Timezone == "" {
		input.Timezone = defaultDevUserTimezone
	}
	input.FollowedSchoolSlugs = normalizeSlugList(input.FollowedSchoolSlugs)

	return input, true, nil
}

func normalizeSlugList(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		slug := normalizeSlug(value)
		if slug == "" || seen[slug] {
			continue
		}
		seen[slug] = true
		result = append(result, slug)
	}
	return result
}

func normalizeSlug(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func schoolIDBySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		SELECT id::text
		FROM schools
		WHERE slug = $1 AND deleted_at IS NULL AND is_active = TRUE
	`, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("dev user school slug %q not found", slug)
	}
	if err != nil {
		return "", fmt.Errorf("find dev user school %q: %w", slug, err)
	}

	return id, nil
}
