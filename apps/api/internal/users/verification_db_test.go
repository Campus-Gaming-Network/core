package users

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryVerifyEmailByTokenAssignsTrustLevel(t *testing.T) {
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
		INSERT INTO schools (name, slug)
		VALUES ('Verification Transition School', $1)
		RETURNING id::text
	`, "verification-transition-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE home_school_id = $1::uuid`, schoolID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	repository := NewPostgresRepository(pool)
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name         string
		email        string
		currentLevel string
		wantLevel    string
	}{
		{
			name:         "qualifying edu address is promoted",
			email:        "student@esports.school.edu",
			currentLevel: "basic",
			wantLevel:    "verified",
		},
		{
			name:         "non edu address remains basic",
			email:        "student@example.com",
			currentLevel: "basic",
			wantLevel:    "basic",
		},
		{
			name:         "staff faculty grant is preserved",
			email:        "faculty@school.edu",
			currentLevel: "staff_faculty",
			wantLevel:    "staff_faculty",
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var userID string
			email := fmt.Sprintf("verification-%d-%s-%s", index, suffix, test.email)
			if err := pool.QueryRow(ctx, `
				INSERT INTO users (
					email, password_hash, verification_level, name,
					home_school_id, age_confirmed_at
				)
				VALUES ($1, 'hash', $2, 'Verification User', $3::uuid, NOW())
				RETURNING id::text
			`, email, test.currentLevel, schoolID).Scan(&userID); err != nil {
				t.Fatalf("insert user: %v", err)
			}

			tokenHash := []byte(fmt.Sprintf("verification-token-%d-%s", index, suffix))
			if _, err := pool.Exec(ctx, `
				INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
				VALUES ($1::uuid, $2, $3)
			`, userID, tokenHash, now.Add(time.Hour)); err != nil {
				t.Fatalf("insert verification token: %v", err)
			}

			if err := repository.VerifyEmailByToken(ctx, tokenHash, now); err != nil {
				t.Fatalf("VerifyEmailByToken() error = %v", err)
			}

			var verifiedAt time.Time
			var level string
			if err := pool.QueryRow(ctx, `
				SELECT email_verified_at, verification_level
				FROM users
				WHERE id = $1::uuid
			`, userID).Scan(&verifiedAt, &level); err != nil {
				t.Fatalf("read verified user: %v", err)
			}
			if !verifiedAt.Equal(now) {
				t.Fatalf("email_verified_at = %v, want %v", verifiedAt, now)
			}
			if level != test.wantLevel {
				t.Fatalf("verification_level = %q, want %q", level, test.wantLevel)
			}

			var consumedAt time.Time
			if err := pool.QueryRow(ctx, `
				SELECT consumed_at
				FROM email_verification_tokens
				WHERE token_hash = $1
			`, tokenHash).Scan(&consumedAt); err != nil {
				t.Fatalf("read consumed token: %v", err)
			}
			if !consumedAt.Equal(now) {
				t.Fatalf("consumed_at = %v, want %v", consumedAt, now)
			}
		})
	}
}
