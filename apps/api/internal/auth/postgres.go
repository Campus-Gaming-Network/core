package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SessionRepository struct {
	pool *pgxpool.Pool
}

func NewSessionRepository(pool *pgxpool.Pool) *SessionRepository {
	return &SessionRepository{pool: pool}
}

func (r *SessionRepository) FindSession(ctx context.Context, tokenHash []byte) (Session, error) {
	var session Session
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, expires_at
		FROM auth_sessions
		WHERE token_hash = $1
		  AND revoked_at IS NULL
		  AND deleted_at IS NULL
		  AND expires_at > NOW()
	`, tokenHash).Scan(&session.ID, &session.UserID, &session.ExpiresAt)
	if err != nil {
		return Session{}, err
	}

	_, err = r.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET last_seen_at = NOW()
		WHERE id = $1::uuid
	`, session.ID)
	if err != nil {
		return Session{}, fmt.Errorf("touch auth session: %w", err)
	}

	return session, nil
}

func (r *SessionRepository) CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO auth_sessions (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, userID, tokenHash, expiresAt)
	return err
}

func (r *SessionRepository) RevokeSession(ctx context.Context, tokenHash []byte) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = NOW()
		WHERE token_hash = $1
	`, tokenHash)
	return err
}

func IsNoRows(err error) bool {
	return err == pgx.ErrNoRows
}
