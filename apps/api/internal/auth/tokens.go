package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TokenStore interface {
	CreateEmailVerificationToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	ConsumeEmailVerificationToken(ctx context.Context, tokenHash []byte, now time.Time) (string, error)
	CreatePasswordResetToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	UsePasswordResetToken(ctx context.Context, tokenHash []byte, now time.Time, passwordHash string) error
}

type TokenRepository struct {
	pool *pgxpool.Pool
}

func NewTokenRepository(pool *pgxpool.Pool) *TokenRepository {
	return &TokenRepository{pool: pool}
}

func (r *TokenRepository) CreateEmailVerificationToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin verification token: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE email_verification_tokens
		SET consumed_at = NOW()
		WHERE user_id = $1::uuid AND consumed_at IS NULL AND deleted_at IS NULL
	`, userID); err != nil {
		return fmt.Errorf("archive verification tokens: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, userID, tokenHash, expiresAt); err != nil {
		return fmt.Errorf("insert verification token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit verification token: %w", err)
	}
	return nil
}

func (r *TokenRepository) ConsumeEmailVerificationToken(ctx context.Context, tokenHash []byte, now time.Time) (string, error) {
	var userID string
	err := r.pool.QueryRow(ctx, `
		UPDATE email_verification_tokens
		SET consumed_at = $2
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND deleted_at IS NULL
		  AND expires_at > $2
		RETURNING user_id::text
	`, tokenHash, now).Scan(&userID)
	return userID, err
}

func (r *TokenRepository) CreatePasswordResetToken(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin password reset token: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET consumed_at = NOW()
		WHERE user_id = $1::uuid AND consumed_at IS NULL AND deleted_at IS NULL
	`, userID); err != nil {
		return fmt.Errorf("archive password reset tokens: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, userID, tokenHash, expiresAt); err != nil {
		return fmt.Errorf("insert password reset token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit password reset token: %w", err)
	}
	return nil
}

func (r *TokenRepository) UsePasswordResetToken(ctx context.Context, tokenHash []byte, now time.Time, passwordHash string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin password reset: %w", err)
	}
	defer tx.Rollback(ctx)

	var userID string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text
		FROM password_reset_tokens
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND deleted_at IS NULL
		  AND expires_at > $2
		FOR UPDATE
	`, tokenHash, now).Scan(&userID)
	if err != nil {
		return err
	}

	commandTag, err := tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $2
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
	`, userID, passwordHash)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET consumed_at = $2
		WHERE token_hash = $1
	`, tokenHash, now); err != nil {
		return fmt.Errorf("consume password reset token: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = $2
		WHERE user_id = $1::uuid AND revoked_at IS NULL AND deleted_at IS NULL
	`, userID, now); err != nil {
		return fmt.Errorf("revoke sessions after password reset: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit password reset: %w", err)
	}
	return nil
}
