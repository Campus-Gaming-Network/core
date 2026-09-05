package users

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// CreateWithVerificationToken creates an account and its first email
// verification token as one unit. The profile is hydrated before commit so a
// returned error never hides a committed account.
func (r *PostgresRepository) CreateWithVerificationToken(ctx context.Context, params CreateParams, tokenHash []byte, expiresAt time.Time) (Profile, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Profile{}, fmt.Errorf("begin signup: %w", err)
	}
	defer tx.Rollback(ctx)

	timezone := params.Timezone
	if timezone == "" {
		timezone = "UTC"
	}

	var profile Profile
	err = tx.QueryRow(ctx, `
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

	if _, err := tx.Exec(ctx, `
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, profile.ID, tokenHash, expiresAt); err != nil {
		return Profile{}, fmt.Errorf("create signup verification token: %w", err)
	}

	profile, err = profileWithAssociations(ctx, tx, profile)
	if err != nil {
		return Profile{}, fmt.Errorf("hydrate signup profile: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Profile{}, fmt.Errorf("commit signup: %w", err)
	}
	return profile, nil
}

// VerifyEmailByToken consumes a live token and applies the corresponding
// account verification transition in one transaction. Deleted and suspended
// users deliberately look the same as invalid or expired tokens.
func (r *PostgresRepository) VerifyEmailByToken(ctx context.Context, tokenHash []byte, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin email verification: %w", err)
	}
	defer tx.Rollback(ctx)

	var userID string
	var email string
	var currentLevel string
	err = tx.QueryRow(ctx, `
		SELECT t.user_id::text, u.email::text, u.verification_level
		FROM email_verification_tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = $1
		  AND t.consumed_at IS NULL
		  AND t.deleted_at IS NULL
		  AND t.expires_at > $2
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
		FOR UPDATE OF t, u
	`, tokenHash, now).Scan(&userID, &email, &currentLevel)
	if err != nil {
		return err
	}

	nextLevel := VerificationLevelAfterEmailVerification(email, currentLevel)
	commandTag, err := tx.Exec(ctx, `
		UPDATE users
		SET email_verified_at = COALESCE(email_verified_at, $2),
		    verification_level = $3
		WHERE id = $1::uuid
		  AND deleted_at IS NULL
		  AND account_status = 'active'
	`, userID, now, nextLevel)
	if err != nil {
		return fmt.Errorf("verify user email: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}

	commandTag, err = tx.Exec(ctx, `
		UPDATE email_verification_tokens
		SET consumed_at = $2
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND deleted_at IS NULL
		  AND expires_at > $2
	`, tokenHash, now)
	if err != nil {
		return fmt.Errorf("consume verification token: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit email verification: %w", err)
	}
	return nil
}

// UpdateProfileWithSocialLinks applies all user-editable profile fields and
// replaces the social-link collection as one unit.
func (r *PostgresRepository) UpdateProfileWithSocialLinks(ctx context.Context, id string, update ProfileUpdate, links []SocialLink) (Profile, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Profile{}, fmt.Errorf("begin profile update: %w", err)
	}
	defer tx.Rollback(ctx)

	var profile Profile
	err = tx.QueryRow(ctx, `
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

	if _, err := tx.Exec(ctx, `
		UPDATE user_social_links
		SET deleted_at = NOW()
		WHERE user_id = $1::uuid AND deleted_at IS NULL
	`, id); err != nil {
		return Profile{}, fmt.Errorf("archive social links: %w", err)
	}

	for index, link := range links {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_social_links (user_id, label, url, sort_order)
			VALUES ($1::uuid, $2, $3, $4)
		`, id, strings.TrimSpace(link.Label), strings.TrimSpace(link.URL), index); err != nil {
			return Profile{}, fmt.Errorf("insert social link: %w", err)
		}
	}

	profile, err = profileWithAssociations(ctx, tx, profile)
	if err != nil {
		return Profile{}, fmt.Errorf("hydrate updated profile: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Profile{}, fmt.Errorf("commit profile update: %w", err)
	}
	return profile, nil
}
