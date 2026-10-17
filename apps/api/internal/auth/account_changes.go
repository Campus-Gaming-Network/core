package auth

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrInvalidCurrentPassword reports a wrong current password on a signed-in
	// change. It is not an authentication failure: the session stays valid.
	ErrInvalidCurrentPassword = apperror.New(apperror.KindUnprocessable, "invalid_current_password", "current password is incorrect")
	// ErrEmailUnchanged reports a new email that is the account's current one.
	ErrEmailUnchanged = apperror.New(apperror.KindValidation, "email_unchanged", "new email matches the current email")
)

// Audit actions for changes a person makes to their own account. They name no
// values: the audit row says what changed and who changed it, never the
// password or either address.
const (
	auditActionPasswordChanged = "user.password_changed"
	auditActionEmailChanged    = "user.email_changed"
)

// AccountChangeStore persists a signed-in person's password and email changes.
type AccountChangeStore interface {
	ChangePassword(ctx context.Context, userID string, passwordHash string, keepSessionHash []byte, now time.Time) error
	CreateEmailChangeToken(ctx context.Context, userID string, newEmail string, rawToken string, tokenHash []byte, expiresAt time.Time) error
	UseEmailChangeToken(ctx context.Context, tokenHash []byte, now time.Time) error
}

// ChangePassword replaces the password of a signed-in person who proves the
// current one. Every other session ends; the one making the change, named by
// its raw token, stays signed in. Outstanding reset links stop working.
func (s *AccountService) ChangePassword(ctx context.Context, userID string, sessionToken string, currentPassword string, newPassword string) error {
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	if err := s.checkCurrentPassword(ctx, userID, currentPassword); err != nil {
		return err
	}
	passwordHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	return s.Changes.ChangePassword(ctx, userID, passwordHash, HashToken(sessionToken), s.now())
}

// RequestEmailChange emails a confirmation link to newEmail for a signed-in
// person who proves their current password. The address changes only when the
// link is followed. An address another account uses gets the same answer and
// no email, so the request cannot tell anyone which addresses have accounts.
func (s *AccountService) RequestEmailChange(ctx context.Context, userID string, currentPassword string, newEmail string) error {
	newEmail = users.NormalizeEmail(newEmail)
	if _, err := mail.ParseAddress(newEmail); err != nil {
		return apperror.Validation("email must be valid")
	}
	profile, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if users.NormalizeEmail(profile.Email) == newEmail {
		return ErrEmailUnchanged
	}
	if err := s.checkCurrentPassword(ctx, userID, currentPassword); err != nil {
		return err
	}
	token, tokenHash, err := NewToken()
	if err != nil {
		return err
	}
	return s.Changes.CreateEmailChangeToken(ctx, userID, newEmail, token, tokenHash, s.now().Add(s.VerificationTTL))
}

// ConfirmEmailChange applies the change the token was issued for. The token
// works once and expires. It also fails when another account has taken the
// address since the request.
func (s *AccountService) ConfirmEmailChange(ctx context.Context, rawToken string) error {
	if rawToken == "" {
		return ErrInvalidToken
	}
	err := s.Changes.UseEmailChangeToken(ctx, HashToken(rawToken), s.now())
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidToken
	}
	return err
}

func (s *AccountService) checkCurrentPassword(ctx context.Context, userID string, password string) error {
	profile, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	credentials, err := s.Users.FindCredentialsByEmail(ctx, users.NormalizeEmail(profile.Email))
	if err != nil {
		return err
	}
	if credentials.Profile.ID != userID || credentials.Suspended || !ComparePassword(credentials.PasswordHash, password) {
		return ErrInvalidCurrentPassword
	}
	return nil
}

// ChangePassword stores the new hash, ends every session but keepSessionHash,
// retires outstanding reset links, and records the change, all at once.
func (r *TokenRepository) ChangePassword(ctx context.Context, userID string, passwordHash string, keepSessionHash []byte, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin password change: %w", err)
	}
	defer tx.Rollback(ctx)

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
		UPDATE auth_sessions
		SET revoked_at = $3
		WHERE user_id = $1::uuid
		  AND token_hash <> $2
		  AND revoked_at IS NULL
		  AND deleted_at IS NULL
	`, userID, keepSessionHash, now); err != nil {
		return fmt.Errorf("revoke other sessions after password change: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET consumed_at = $2
		WHERE user_id = $1::uuid AND consumed_at IS NULL AND deleted_at IS NULL
	`, userID, now); err != nil {
		return fmt.Errorf("retire password reset tokens: %w", err)
	}
	if err := insertSelfAudit(ctx, tx, userID, auditActionPasswordChanged); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit password change: %w", err)
	}
	return nil
}

// CreateEmailChangeToken retires the person's earlier email change requests
// and, unless another account already uses newEmail, stores a new token and
// queues the confirmation link to newEmail.
func (r *TokenRepository) CreateEmailChangeToken(ctx context.Context, userID string, newEmail string, rawToken string, tokenHash []byte, expiresAt time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin email change token: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE email_change_tokens
		SET consumed_at = NOW()
		WHERE user_id = $1::uuid AND consumed_at IS NULL
	`, userID); err != nil {
		return fmt.Errorf("retire email change tokens: %w", err)
	}
	var taken bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM users WHERE email = $1::citext)
	`, newEmail).Scan(&taken); err != nil {
		return fmt.Errorf("check new email: %w", err)
	}
	if taken {
		// Commit the retirement so an older link to some other address cannot
		// be used after this request, but send nothing.
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit email change token: %w", err)
		}
		return nil
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO email_change_tokens (user_id, new_email, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3, $4)
	`, userID, newEmail, tokenHash, expiresAt); err != nil {
		return fmt.Errorf("insert email change token: %w", err)
	}
	if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
		Kind: emailoutbox.KindEmailChangeVerification, Recipient: newEmail,
		Payload:        map[string]string{"token": rawToken, "user_id": userID},
		IdempotencyKey: emailoutbox.TokenKey(emailoutbox.KindEmailChangeVerification, tokenHash),
	}); err != nil {
		return fmt.Errorf("enqueue email change verification: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit email change token: %w", err)
	}
	return nil
}

// UseEmailChangeToken moves the account to the token's address, marks the
// address verified, tells the old address, and records the change. It returns
// pgx.ErrNoRows for a missing, used, or expired token, an inactive account, or
// an address another account took after the request.
func (r *TokenRepository) UseEmailChangeToken(ctx context.Context, tokenHash []byte, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin email change: %w", err)
	}
	defer tx.Rollback(ctx)

	var userID string
	var newEmail string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, new_email::text
		FROM email_change_tokens
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND expires_at > $2
		FOR UPDATE
	`, tokenHash, now).Scan(&userID, &newEmail)
	if err != nil {
		return err
	}
	var oldEmail string
	err = tx.QueryRow(ctx, `
		SELECT email::text
		FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
		FOR UPDATE
	`, userID).Scan(&oldEmail)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET email = $2, email_verified_at = $3
		WHERE id = $1::uuid
	`, userID, newEmail, now); err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			return pgx.ErrNoRows
		}
		return fmt.Errorf("update email: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE email_change_tokens SET consumed_at = $2 WHERE token_hash = $1
	`, tokenHash, now); err != nil {
		return fmt.Errorf("consume email change token: %w", err)
	}
	if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
		Kind: emailoutbox.KindEmailChangedNotice, Recipient: oldEmail,
		Payload:        map[string]string{"user_id": userID},
		IdempotencyKey: emailoutbox.TokenKey(emailoutbox.KindEmailChangedNotice, tokenHash),
	}); err != nil {
		return fmt.Errorf("enqueue email changed notice: %w", err)
	}
	if err := insertSelfAudit(ctx, tx, userID, auditActionEmailChanged); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit email change: %w", err)
	}
	return nil
}

// insertSelfAudit records a change a person made to their own account.
func insertSelfAudit(ctx context.Context, tx pgx.Tx, userID string, action string) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
		VALUES ($1::uuid, $2, 'user', $1::uuid)
	`, userID, action); err != nil {
		return fmt.Errorf("record %s: %w", action, err)
	}
	return nil
}
