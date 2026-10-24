package auth

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5/pgxpool"
)

// accountChangeFixture is one verified account with two live sessions and a
// second account whose address cannot be taken.
type accountChangeFixture struct {
	pool          *pgxpool.Pool
	service       *AccountService
	userID        string
	thisSession   string
	otherSession  string
	takenEmail    string
	originalEmail string
}

func newAccountChangeFixture(t *testing.T) accountChangeFixture {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "auth")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	var schoolID string
	schoolID = dbtest.InsertSchool(t, pool, "Account School", "account-school")
	passwordHash, err := HashPassword("OldPassword1")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	insertUser := func(email string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, email_verified_at)
			VALUES ($1, $2, 'Account Person', $3::uuid, NOW(), NOW())
			RETURNING id::text
		`, email, passwordHash, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", email, err)
		}
		return id
	}
	fixture := accountChangeFixture{
		pool:          pool,
		userID:        insertUser("player@example.test"),
		takenEmail:    "taken@example.test",
		originalEmail: "player@example.test",
	}
	insertUser(fixture.takenEmail)

	sessions := NewSessionRepository(pool)
	for _, token := range []*string{&fixture.thisSession, &fixture.otherSession} {
		raw, hash, err := NewToken()
		if err != nil {
			t.Fatalf("new session token: %v", err)
		}
		if err := sessions.CreateSession(ctx, fixture.userID, hash, time.Now().Add(time.Hour)); err != nil {
			t.Fatalf("create session: %v", err)
		}
		*token = raw
	}
	fixture.service = NewAccountService(
		users.NewPostgresRepository(pool), schools.NewPostgresRepository(pool),
		sessions, NewTokenRepository(pool), time.Hour, time.Hour, time.Hour,
	)
	return fixture
}

func (f accountChangeFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := f.pool.QueryRow(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("count %q: %v", query, err)
	}
	return count
}

func (f accountChangeFixture) liveSession(t *testing.T, raw string) bool {
	t.Helper()
	return f.count(t, `SELECT COUNT(*) FROM auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL`, HashToken(raw)) == 1
}

func TestAccountServiceChangePassword(t *testing.T) {
	ctx := context.Background()
	fixture := newAccountChangeFixture(t)
	if err := fixture.service.RequestPasswordReset(ctx, fixture.originalEmail); err != nil {
		t.Fatalf("RequestPasswordReset() error = %v", err)
	}

	for name, test := range map[string]struct {
		current string
		next    string
		want    error
	}{
		"wrong current password": {"WrongPassword1", "NewPassword1", ErrInvalidCurrentPassword},
		"short new password":     {"OldPassword1", "short", nil},
	} {
		err := fixture.service.ChangePassword(ctx, fixture.userID, fixture.thisSession, test.current, test.next)
		if err == nil || (test.want != nil && !errors.Is(err, test.want)) {
			t.Fatalf("%s: error = %v, want %v", name, err, test.want)
		}
	}
	if !fixture.liveSession(t, fixture.otherSession) {
		t.Fatal("a refused change ended another session")
	}

	if err := fixture.service.ChangePassword(ctx, fixture.userID, fixture.thisSession, "OldPassword1", "NewPassword1"); err != nil {
		t.Fatalf("ChangePassword() error = %v", err)
	}
	got := map[string]any{
		"this session live":  fixture.liveSession(t, fixture.thisSession),
		"other session live": fixture.liveSession(t, fixture.otherSession),
		"open reset links":   fixture.count(t, `SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1::uuid AND consumed_at IS NULL`, fixture.userID),
		"audit rows":         fixture.count(t, `SELECT COUNT(*) FROM audit_logs WHERE actor_user_id = $1::uuid AND entity_id = $1::uuid AND action = 'user.password_changed'`, fixture.userID),
		"old password works": loginWorks(ctx, fixture.service, fixture.originalEmail, "OldPassword1"),
		"new password works": loginWorks(ctx, fixture.service, fixture.originalEmail, "NewPassword1"),
	}
	want := map[string]any{
		"this session live":  true,
		"other session live": false,
		"open reset links":   0,
		"audit rows":         1,
		"old password works": false,
		"new password works": true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("after change = %v, want %v", got, want)
	}
}

func TestAccountServiceChangeEmail(t *testing.T) {
	ctx := context.Background()
	fixture := newAccountChangeFixture(t)
	outbox := func(kind string) []string {
		t.Helper()
		rows, err := fixture.pool.Query(ctx, `SELECT recipient FROM email_outbox WHERE kind = $1 ORDER BY created_at`, kind)
		if err != nil {
			t.Fatalf("list outbox: %v", err)
		}
		defer rows.Close()
		recipients := []string{}
		for rows.Next() {
			var recipient string
			if err := rows.Scan(&recipient); err != nil {
				t.Fatalf("scan outbox: %v", err)
			}
			recipients = append(recipients, recipient)
		}
		return recipients
	}

	// Refusals: wrong password and the current address. A taken address is
	// accepted like any other but sends nothing and stores no token.
	if err := fixture.service.RequestEmailChange(ctx, fixture.userID, "WrongPassword1", "new@example.test"); !errors.Is(err, ErrInvalidCurrentPassword) {
		t.Fatalf("wrong password: error = %v", err)
	}
	if err := fixture.service.RequestEmailChange(ctx, fixture.userID, "OldPassword1", " Player@Example.test "); !errors.Is(err, ErrEmailUnchanged) {
		t.Fatalf("same address: error = %v", err)
	}
	if err := fixture.service.RequestEmailChange(ctx, fixture.userID, "OldPassword1", fixture.takenEmail); err != nil {
		t.Fatalf("taken address: error = %v, want nil", err)
	}
	if got := fixture.count(t, `SELECT COUNT(*) FROM email_change_tokens`); got != 0 {
		t.Fatalf("tokens after taken address = %d, want 0", got)
	}

	// A real request: the link goes to the new address only, and nothing
	// changes until it is used. Capture the token from the queued email.
	if err := fixture.service.RequestEmailChange(ctx, fixture.userID, "OldPassword1", "New@Example.test"); err != nil {
		t.Fatalf("RequestEmailChange() error = %v", err)
	}
	var token string
	if err := fixture.pool.QueryRow(ctx, `
		SELECT payload ->> 'token' FROM email_outbox WHERE kind = $1
	`, emailoutbox.KindEmailChangeVerification).Scan(&token); err != nil {
		t.Fatalf("read queued token: %v", err)
	}
	profile, err := fixture.service.GetProfile(ctx, fixture.userID)
	if err != nil || profile.Email != fixture.originalEmail {
		t.Fatalf("email before confirming = %q, %v; want unchanged", profile.Email, err)
	}

	if err := fixture.service.ConfirmEmailChange(ctx, token); err != nil {
		t.Fatalf("ConfirmEmailChange() error = %v", err)
	}
	profile, err = fixture.service.GetProfile(ctx, fixture.userID)
	if err != nil {
		t.Fatalf("GetProfile() error = %v", err)
	}
	got := map[string]any{
		"email":         profile.Email,
		"verified":      profile.EmailVerifiedAt != nil,
		"links sent to": outbox(emailoutbox.KindEmailChangeVerification),
		"notices sent":  outbox(emailoutbox.KindEmailChangedNotice),
		"audit rows":    fixture.count(t, `SELECT COUNT(*) FROM audit_logs WHERE entity_id = $1::uuid AND action = 'user.email_changed'`, fixture.userID),
		"reused link":   errors.Is(fixture.service.ConfirmEmailChange(ctx, token), ErrInvalidToken),
		"new login":     loginWorks(ctx, fixture.service, "new@example.test", "OldPassword1"),
	}
	want := map[string]any{
		"email":         "new@example.test",
		"verified":      true,
		"links sent to": []string{"new@example.test"},
		"notices sent":  []string{fixture.originalEmail},
		"audit rows":    1,
		"reused link":   true,
		"new login":     true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("after confirming = %v, want %v", got, want)
	}
}

func TestAccountServiceEmailChangeLinkFailures(t *testing.T) {
	ctx := context.Background()
	fixture := newAccountChangeFixture(t)
	request := func(newEmail string) string {
		t.Helper()
		if err := fixture.service.RequestEmailChange(ctx, fixture.userID, "OldPassword1", newEmail); err != nil {
			t.Fatalf("RequestEmailChange(%s) error = %v", newEmail, err)
		}
		var token string
		if err := fixture.pool.QueryRow(ctx, `
			SELECT payload ->> 'token' FROM email_outbox WHERE recipient = $1
		`, newEmail).Scan(&token); err != nil {
			t.Fatalf("read queued token: %v", err)
		}
		return token
	}

	expired := request("expired@example.test")
	if _, err := fixture.pool.Exec(ctx, `UPDATE email_change_tokens SET expires_at = NOW() - INTERVAL '1 minute'`); err != nil {
		t.Fatalf("expire token: %v", err)
	}
	// A newer request retires the older link.
	superseded := request("first@example.test")
	request("second@example.test")
	// The address is taken by another account after the request.
	raced := request("raced@example.test")
	if _, err := fixture.pool.Exec(ctx, `UPDATE users SET email = 'raced@example.test' WHERE email = $1`, fixture.takenEmail); err != nil {
		t.Fatalf("take address: %v", err)
	}

	for name, token := range map[string]string{
		"expired": expired, "superseded": superseded, "taken since": raced, "unknown": "not-a-token", "empty": "",
	} {
		if err := fixture.service.ConfirmEmailChange(ctx, token); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: error = %v, want ErrInvalidToken", name, err)
		}
	}
	profile, err := fixture.service.GetProfile(ctx, fixture.userID)
	if err != nil || profile.Email != fixture.originalEmail {
		t.Fatalf("email after failed links = %q, %v; want unchanged", profile.Email, err)
	}
}

func loginWorks(ctx context.Context, service *AccountService, email string, password string) bool {
	_, err := service.Login(ctx, email, password)
	return err == nil
}
