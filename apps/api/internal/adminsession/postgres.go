package adminsession

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateSession(ctx context.Context, params CreateParams) error {
	commandTag, err := r.pool.Exec(ctx, `
		INSERT INTO admin_sessions (
			user_id, grant_id, token_hash, csrf_token_hash, authn_method,
			access_issuer, access_subject, access_email,
			authenticated_at, step_up_at, last_seen_at,
			idle_expires_at, absolute_expires_at
		)
		SELECT account.id, role_grant.id, $3, $4, $5, $6, $7, $8,
		       $9, $10, $11, $12, $13
		FROM users AS account
		JOIN site_role_grants AS role_grant
		  ON role_grant.id = $2::uuid
		 AND role_grant.user_id = account.id
		 AND role_grant.role = 'site_admin'
		 AND role_grant.revoked_at IS NULL
		WHERE account.id = $1::uuid
		  AND account.email = $8
		  AND account.email_verified_at IS NOT NULL
		  AND account.account_status = 'active'
		  AND account.deleted_at IS NULL
	`, params.UserID, params.GrantID, params.TokenHash, params.CSRFTokenHash,
		params.AuthnMethod, params.AccessIssuer, params.AccessSubject, params.AccessEmail,
		params.AuthenticatedAt, params.StepUpAt, params.LastSeenAt,
		params.IdleExpiresAt, params.AbsoluteExpiresAt)
	if err != nil {
		return fmt.Errorf("create admin session: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return ErrUnauthenticated
	}
	return nil
}

func (r *PostgresRepository) FindAndTouchSession(
	ctx context.Context,
	tokenHash []byte,
	now time.Time,
	idleExpiresAt time.Time,
) (Session, error) {
	var session Session
	err := r.pool.QueryRow(ctx, `
		UPDATE admin_sessions AS session
		SET last_seen_at = $2,
		    idle_expires_at = LEAST($3, session.absolute_expires_at)
		FROM users AS account, site_role_grants AS role_grant
		WHERE session.token_hash = $1
		  AND session.user_id = account.id
		  AND session.grant_id = role_grant.id
		  AND role_grant.user_id = session.user_id
		  AND role_grant.role = 'site_admin'
		  AND role_grant.revoked_at IS NULL
		  AND account.email = session.access_email
		  AND account.email_verified_at IS NOT NULL
		  AND account.deleted_at IS NULL
		  AND account.account_status = 'active'
		  AND session.revoked_at IS NULL
		  AND session.idle_expires_at > $2
		  AND session.absolute_expires_at > $2
		RETURNING session.id::text, session.user_id::text,
		          session.grant_id::text, session.authn_method, session.access_issuer,
		          session.access_subject, session.access_email::text,
		          session.csrf_token_hash, session.authenticated_at, session.step_up_at,
		          session.last_seen_at, session.idle_expires_at,
		          session.absolute_expires_at
	`, tokenHash, now, idleExpiresAt).Scan(
		&session.ID, &session.UserID, &session.GrantID, &session.AuthnMethod,
		&session.AccessIssuer, &session.AccessSubject, &session.AccessEmail,
		&session.CSRFTokenHash, &session.AuthenticatedAt, &session.StepUpAt, &session.LastSeenAt,
		&session.IdleExpiresAt, &session.AbsoluteExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrUnauthenticated
	}
	if err != nil {
		return Session{}, fmt.Errorf("find admin session: %w", err)
	}
	return session, nil
}

func (r *PostgresRepository) RevokeSession(
	ctx context.Context,
	tokenHash []byte,
	revokedAt time.Time,
	reason string,
) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE admin_sessions
		SET revoked_at = $2, revocation_reason = $3
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, tokenHash, revokedAt, reason)
	if err != nil {
		return fmt.Errorf("revoke admin session: %w", err)
	}
	return nil
}
