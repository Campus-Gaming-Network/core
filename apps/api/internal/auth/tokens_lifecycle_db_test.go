package auth

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5"
)

// Each token works once, only before it expires, and only by its own hash.
// The clock is the now the caller passes, so the expiry boundary is exact.
func TestTokensAreSingleUseAndExpireAtTheirDeadline(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "auth_tokens")
	var schoolID, userID string
	schoolID = dbtest.InsertSchool(t, pool, "Token School", "token-school")
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('token-user@example.test', 'old-hash', 'Token User', $1::uuid, NOW())
		RETURNING id::text
	`, schoolID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	repository := NewTokenRepository(pool)
	issued := time.Date(2031, time.May, 1, 12, 0, 0, 0, time.UTC)
	expires := issued.Add(time.Hour)
	outcome := func(err error) string {
		switch {
		case err == nil:
			return "accepted"
		case errors.Is(err, pgx.ErrNoRows):
			return "rejected"
		default:
			return err.Error()
		}
	}

	verify := HashToken("verify-token")
	if err := repository.CreateEmailVerificationToken(ctx, userID, "token-user@example.test", "verify-token", verify, expires); err != nil {
		t.Fatal(err)
	}
	consume := func(hash []byte, now time.Time) string {
		consumedBy, err := repository.ConsumeEmailVerificationToken(ctx, hash, now)
		if err == nil && consumedBy != userID {
			return "accepted for " + consumedBy
		}
		return outcome(err)
	}
	verification := []string{
		consume(HashToken("wrong-token"), issued),
		consume(verify, expires),
		consume(verify, expires.Add(-time.Second)),
		consume(verify, issued),
	}

	reset := HashToken("reset-token")
	if err := repository.CreatePasswordResetToken(ctx, userID, "token-user@example.test", "reset-token", reset, expires); err != nil {
		t.Fatal(err)
	}
	use := func(hash []byte, now time.Time, password string) string {
		return outcome(repository.UsePasswordResetToken(ctx, hash, now, password))
	}
	passwordReset := []string{
		use(HashToken("wrong-token"), issued, "wrong-hash"),
		use(reset, expires, "late-hash"),
		use(reset, expires.Add(-time.Second), "new-hash"),
		use(reset, issued, "replayed-hash"),
	}
	var passwordHash string
	if err := pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1::uuid`, userID).Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}

	got := map[string]any{"verification": verification, "reset": passwordReset, "password": passwordHash}
	want := map[string]any{
		// Wrong token, at the deadline, a second before it, then a replay.
		"verification": []string{"rejected", "rejected", "accepted", "rejected"},
		"reset":        []string{"rejected", "rejected", "accepted", "rejected"},
		"password":     "new-hash",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("token outcomes = %v, want %v", got, want)
	}
}
