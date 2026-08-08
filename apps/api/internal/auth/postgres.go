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
	// The join is redundant with revoking sessions on account deletion, but it
	// means a stray unrevoked row can never authenticate a deleted or suspended
	// account.
	err := r.pool.QueryRow(ctx, `
		SELECT s.id::text, s.user_id::text, s.expires_at
		FROM auth_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.deleted_at IS NULL
		  AND s.expires_at > NOW()
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
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
