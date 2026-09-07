package users

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryCreateWithVerificationTokenCommitsAndRollsBack(t *testing.T) {
	ctx, pool, schoolID, suffix := setupLifecycleDatabaseTest(t)
	repository := NewPostgresRepository(pool)
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	email := "atomic-signup-" + suffix + "@example.test"
	rawToken := "atomic-signup-raw-token-" + suffix
	tokenHash := []byte("atomic-signup-token-" + suffix)

	profile, err := repository.CreateWithVerificationToken(ctx, CreateParams{
		Email:          email,
		PasswordHash:   "hash",
		Name:           "Atomic Signup",
		HomeSchoolID:   schoolID,
		AgeConfirmedAt: now,
		Timezone:       "UTC",
	}, rawToken, tokenHash, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateWithVerificationToken() error = %v", err)
	}
	if profile.Email != email || profile.HomeSchool == nil || profile.HomeSchool.ID != schoolID {
		t.Fatalf("created profile = %#v, want committed account with hydrated school", profile)
	}
	assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM users WHERE email = $1`, email, 1)
	assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM email_verification_tokens WHERE token_hash = $1`, tokenHash, 1)
	assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM email_outbox WHERE idempotency_key = $1`, emailoutbox.TokenKey(emailoutbox.KindAccountVerification, tokenHash), 1)

	t.Run("duplicate email preserves the existing account and token", func(t *testing.T) {
		_, err := repository.CreateWithVerificationToken(ctx, CreateParams{
			Email:          strings.ToUpper(email),
			PasswordHash:   "different-hash",
			Name:           "Duplicate Signup",
			HomeSchoolID:   schoolID,
			AgeConfirmedAt: now,
			Timezone:       "UTC",
		}, "duplicate-email-raw-token-"+suffix, []byte("duplicate-email-token-"+suffix), now.Add(time.Hour))
		if !IsDuplicateEmail(err) {
			t.Fatalf("duplicate signup error = %v, want duplicate-email error", err)
		}
		assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM users WHERE email = $1`, email, 1)
		assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM email_verification_tokens WHERE user_id = $1::uuid`, profile.ID, 1)
	})

	t.Run("token insertion failure rolls back user creation", func(t *testing.T) {
		rollbackEmail := "rolled-back-signup-" + suffix + "@example.test"
		_, err := repository.CreateWithVerificationToken(ctx, CreateParams{
			Email:          rollbackEmail,
			PasswordHash:   "hash",
			Name:           "Rolled Back Signup",
			HomeSchoolID:   schoolID,
			AgeConfirmedAt: now,
			Timezone:       "UTC",
		}, "rollback-raw-token-"+suffix, tokenHash, now.Add(time.Hour))
		if err == nil {
			t.Fatal("CreateWithVerificationToken() error = nil, want duplicate token hash failure")
		}
		assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM users WHERE email = $1`, rollbackEmail, 0)
		assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM email_outbox WHERE recipient = $1`, rollbackEmail, 0)
	})
}

func TestPostgresRepositoryVerifyEmailByTokenIsAtomicForReplayAndDeletedUser(t *testing.T) {
	ctx, pool, schoolID, suffix := setupLifecycleDatabaseTest(t)
	repository := NewPostgresRepository(pool)
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)

	t.Run("commit and replay", func(t *testing.T) {
		email := "verification-" + suffix + "@example.edu"
		tokenHash := []byte("verification-token-" + suffix)
		profile := createLifecycleAccount(t, ctx, repository, schoolID, email, tokenHash, now)

		if err := repository.VerifyEmailByToken(ctx, tokenHash, now); err != nil {
			t.Fatalf("VerifyEmailByToken() error = %v", err)
		}
		var verifiedAt time.Time
		var verificationLevel string
		if err := pool.QueryRow(ctx, `
			SELECT email_verified_at, verification_level
			FROM users WHERE id = $1::uuid
		`, profile.ID).Scan(&verifiedAt, &verificationLevel); err != nil {
			t.Fatalf("read verified account: %v", err)
		}
		if !verifiedAt.Equal(now) || verificationLevel != "verified" {
			t.Fatalf("verified account = (%v, %q), want (%v, verified)", verifiedAt, verificationLevel, now)
		}
		if err := repository.VerifyEmailByToken(ctx, tokenHash, now.Add(time.Minute)); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("replayed VerifyEmailByToken() error = %v, want pgx.ErrNoRows", err)
		}
	})

	t.Run("deleted user leaves token unconsumed", func(t *testing.T) {
		email := "deleted-verification-" + suffix + "@example.edu"
		tokenHash := []byte("deleted-verification-token-" + suffix)
		profile := createLifecycleAccount(t, ctx, repository, schoolID, email, tokenHash, now)
		if _, err := pool.Exec(ctx, `
			UPDATE users
			SET account_status = 'deleted', deleted_at = $2
			WHERE id = $1::uuid
		`, profile.ID, now); err != nil {
			t.Fatalf("mark user deleted: %v", err)
		}

		if err := repository.VerifyEmailByToken(ctx, tokenHash, now); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("deleted-user VerifyEmailByToken() error = %v, want pgx.ErrNoRows", err)
		}
		var consumedAt *time.Time
		if err := pool.QueryRow(ctx, `
			SELECT consumed_at FROM email_verification_tokens WHERE token_hash = $1
		`, tokenHash).Scan(&consumedAt); err != nil {
			t.Fatalf("read deleted user's token: %v", err)
		}
		if consumedAt != nil {
			t.Fatalf("deleted user's token consumed_at = %v, want nil", consumedAt)
		}
	})

	t.Run("token consumption failure rolls back account transition", func(t *testing.T) {
		email := "rollback-verification-" + suffix + "@example.edu"
		tokenHash := []byte("rollback-verification-token-" + suffix)
		profile := createLifecycleAccount(t, ctx, repository, schoolID, email, tokenHash, now)
		installLifecycleFailureTrigger(t, ctx, pool, "email_verification_tokens", "BEFORE UPDATE", suffix+"token", fmt.Sprintf("encode(NEW.token_hash, 'hex') = '%x'", tokenHash))

		if err := repository.VerifyEmailByToken(ctx, tokenHash, now); err == nil {
			t.Fatal("VerifyEmailByToken() error = nil, want forced token-consumption failure")
		}
		var verifiedAt *time.Time
		var verificationLevel string
		if err := pool.QueryRow(ctx, `
			SELECT email_verified_at, verification_level
			FROM users WHERE id = $1::uuid
		`, profile.ID).Scan(&verifiedAt, &verificationLevel); err != nil {
			t.Fatalf("read rolled-back account: %v", err)
		}
		if verifiedAt != nil || verificationLevel != "basic" {
			t.Fatalf("rolled-back account = (%v, %q), want (nil, basic)", verifiedAt, verificationLevel)
		}
		var consumedAt *time.Time
		if err := pool.QueryRow(ctx, `
			SELECT consumed_at FROM email_verification_tokens WHERE token_hash = $1
		`, tokenHash).Scan(&consumedAt); err != nil {
			t.Fatalf("read rolled-back token: %v", err)
		}
		if consumedAt != nil {
			t.Fatalf("rolled-back token consumed_at = %v, want nil", consumedAt)
		}
	})
}

func TestPostgresRepositoryUpdateProfileWithSocialLinksCommitsAndRollsBack(t *testing.T) {
	ctx, pool, schoolID, suffix := setupLifecycleDatabaseTest(t)
	repository := NewPostgresRepository(pool)
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	profile := createLifecycleAccount(
		t,
		ctx,
		repository,
		schoolID,
		"profile-"+suffix+"@example.test",
		[]byte("profile-token-"+suffix),
		now,
	)

	updated, err := repository.UpdateProfileWithSocialLinks(ctx, profile.ID, ProfileUpdate{
		Name:     "Committed Name",
		Bio:      "Committed bio",
		Timezone: "America/Los_Angeles",
	}, []SocialLink{{Label: "Discord", URL: "https://discord.com/users/committed"}})
	if err != nil {
		t.Fatalf("UpdateProfileWithSocialLinks() error = %v", err)
	}
	if updated.Name != "Committed Name" || len(updated.SocialLinks) != 1 || updated.SocialLinks[0].Label != "Discord" {
		t.Fatalf("updated profile = %#v, want committed fields and links", updated)
	}

	t.Run("social link insertion failure rolls back fields and links", func(t *testing.T) {
		installLifecycleFailureTrigger(t, ctx, pool, "user_social_links", "BEFORE INSERT", suffix+"link", "NEW.label = 'Force rollback'")
		_, err := repository.UpdateProfileWithSocialLinks(ctx, profile.ID, ProfileUpdate{
			Name:     "Rolled Back Name",
			Bio:      "Rolled back bio",
			Timezone: "UTC",
		}, []SocialLink{
			{Label: "Temporary", URL: "https://example.test/temporary"},
			{Label: "Force rollback", URL: "https://example.test/failure"},
		})
		if err == nil {
			t.Fatal("UpdateProfileWithSocialLinks() error = nil, want forced link insertion failure")
		}

		assertLifecycleProfileState(t, ctx, pool, profile.ID, "Committed Name", "Committed bio", "America/Los_Angeles", "Discord")
	})
}

func setupLifecycleDatabaseTest(t *testing.T) (context.Context, *pgxpool.Pool, string, string) {
	t.Helper()
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
		VALUES ('Lifecycle Transaction School', $1)
		RETURNING id::text
	`, "lifecycle-transaction-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE home_school_id = $1::uuid`, schoolID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	return ctx, pool, schoolID, suffix
}

func createLifecycleAccount(t *testing.T, ctx context.Context, repository *PostgresRepository, schoolID, email string, tokenHash []byte, now time.Time) Profile {
	t.Helper()
	profile, err := repository.CreateWithVerificationToken(ctx, CreateParams{
		Email:          email,
		PasswordHash:   "hash",
		Name:           "Lifecycle User",
		HomeSchoolID:   schoolID,
		AgeConfirmedAt: now,
		Timezone:       "UTC",
	}, "raw-"+string(tokenHash), tokenHash, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("create lifecycle account: %v", err)
	}
	return profile
}

func assertLifecycleRowCount(t *testing.T, pool *pgxpool.Pool, query string, argument any, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(context.Background(), query, argument).Scan(&got); err != nil {
		t.Fatalf("count lifecycle rows: %v", err)
	}
	if got != want {
		t.Fatalf("lifecycle row count = %d, want %d", got, want)
	}
}

func assertLifecycleProfileState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, wantName, wantBio, wantTimezone, wantLinkLabel string) {
	t.Helper()
	var name string
	var bio string
	var timezone string
	if err := pool.QueryRow(ctx, `
		SELECT name, COALESCE(bio, ''), timezone FROM users WHERE id = $1::uuid
	`, userID).Scan(&name, &bio, &timezone); err != nil {
		t.Fatalf("read profile fields: %v", err)
	}
	if name != wantName || bio != wantBio || timezone != wantTimezone {
		t.Fatalf("profile fields = (%q, %q, %q), want (%q, %q, %q)", name, bio, timezone, wantName, wantBio, wantTimezone)
	}

	rows, err := pool.Query(ctx, `
		SELECT label FROM user_social_links
		WHERE user_id = $1::uuid AND deleted_at IS NULL
		ORDER BY sort_order, id
	`, userID)
	if err != nil {
		t.Fatalf("list profile links: %v", err)
	}
	defer rows.Close()
	var labels []string
	for rows.Next() {
		var label string
		if err := rows.Scan(&label); err != nil {
			t.Fatalf("scan profile link: %v", err)
		}
		labels = append(labels, label)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate profile links: %v", err)
	}
	if len(labels) != 1 || labels[0] != wantLinkLabel {
		t.Fatalf("active profile link labels = %#v, want [%q]", labels, wantLinkLabel)
	}
}

func installLifecycleFailureTrigger(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table, timing, suffix, condition string) {
	t.Helper()
	identifier := "cgn004_fail_" + strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' {
			return r
		}
		return '_'
	}, suffix)
	functionName := identifier + "_fn"

	functionSQL := fmt.Sprintf(`
		CREATE FUNCTION %s() RETURNS trigger
		LANGUAGE plpgsql AS $$
		BEGIN
			IF %s THEN
				RAISE EXCEPTION 'forced CGN-004 transaction failure';
			END IF;
			RETURN NEW;
		END
		$$
	`, functionName, condition)
	if _, err := pool.Exec(ctx, functionSQL); err != nil {
		t.Fatalf("create failure trigger function: %v", err)
	}
	triggerSQL := fmt.Sprintf(`
		CREATE TRIGGER %s
		%s ON %s
		FOR EACH ROW EXECUTE FUNCTION %s()
	`, identifier, timing, table, functionName)
	if _, err := pool.Exec(ctx, triggerSQL); err != nil {
		_, _ = pool.Exec(ctx, "DROP FUNCTION "+functionName+"()")
		t.Fatalf("create failure trigger: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON %s", identifier, table))
		_, _ = pool.Exec(context.Background(), "DROP FUNCTION IF EXISTS "+functionName+"()")
	})
}
