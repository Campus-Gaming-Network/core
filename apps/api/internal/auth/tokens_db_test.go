package auth

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTokenRepositoryCommitsTokensWithOutboxAndRollsBackTogether(t *testing.T) {
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	suffix := fmt.Sprint(time.Now().UnixNano())
	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Token Outbox School', $1)
		RETURNING id::text
	`, "token-outbox-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	email := "token-outbox-" + suffix + "@example.test"
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Token User', $2::uuid, NOW())
		RETURNING id::text
	`, email, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM email_outbox WHERE recipient = $1`, email)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	repository := NewTokenRepository(pool)
	verificationHash := []byte("verification-hash-" + suffix)
	if err := repository.CreateEmailVerificationToken(ctx, userID, email, "verification-secret", verificationHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateEmailVerificationToken() error = %v", err)
	}
	assertTokenOutboxPair(t, pool, "email_verification_tokens", verificationHash, emailoutbox.TokenKey(emailoutbox.KindAccountVerification, verificationHash), 1)

	rollbackVerificationHash := []byte("rollback-verification-hash-" + suffix)
	if err := repository.CreateEmailVerificationToken(ctx, userID, "", "rollback-secret", rollbackVerificationHash, time.Now().Add(time.Hour)); err == nil {
		t.Fatal("CreateEmailVerificationToken() error = nil, want invalid outbox envelope")
	}
	assertTokenOutboxPair(t, pool, "email_verification_tokens", rollbackVerificationHash, emailoutbox.TokenKey(emailoutbox.KindAccountVerification, rollbackVerificationHash), 0)
	var verificationConsumed bool
	if err := pool.QueryRow(ctx, `SELECT consumed_at IS NOT NULL FROM email_verification_tokens WHERE token_hash = $1`, verificationHash).Scan(&verificationConsumed); err != nil {
		t.Fatalf("read committed verification token: %v", err)
	}
	if verificationConsumed {
		t.Fatal("failed verification transaction archived the prior token")
	}

	resetHash := []byte("reset-hash-" + suffix)
	if err := repository.CreatePasswordResetToken(ctx, userID, email, "reset-secret", resetHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreatePasswordResetToken() error = %v", err)
	}
	assertTokenOutboxPair(t, pool, "password_reset_tokens", resetHash, emailoutbox.TokenKey(emailoutbox.KindPasswordReset, resetHash), 1)

	rollbackResetHash := []byte("rollback-reset-hash-" + suffix)
	if err := repository.CreatePasswordResetToken(ctx, userID, "", "rollback-reset-secret", rollbackResetHash, time.Now().Add(time.Hour)); err == nil {
		t.Fatal("CreatePasswordResetToken() error = nil, want invalid outbox envelope")
	}
	assertTokenOutboxPair(t, pool, "password_reset_tokens", rollbackResetHash, emailoutbox.TokenKey(emailoutbox.KindPasswordReset, rollbackResetHash), 0)
	var resetConsumed bool
	if err := pool.QueryRow(ctx, `SELECT consumed_at IS NOT NULL FROM password_reset_tokens WHERE token_hash = $1`, resetHash).Scan(&resetConsumed); err != nil {
		t.Fatalf("read committed reset token: %v", err)
	}
	if resetConsumed {
		t.Fatal("failed reset transaction archived the prior token")
	}
}

func assertTokenOutboxPair(t *testing.T, pool *pgxpool.Pool, tokenTable string, tokenHash []byte, idempotencyKey string, want int) {
	t.Helper()
	var tokens int
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE token_hash = $1", tokenTable)
	if err := pool.QueryRow(context.Background(), query, tokenHash).Scan(&tokens); err != nil {
		t.Fatalf("count %s rows: %v", tokenTable, err)
	}
	var messages int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM email_outbox WHERE idempotency_key = $1`, idempotencyKey).Scan(&messages); err != nil {
		t.Fatalf("count outbox rows: %v", err)
	}
	if tokens != want || messages != want {
		t.Fatalf("token/outbox rows = %d/%d, want %d/%d", tokens, messages, want, want)
	}
}
