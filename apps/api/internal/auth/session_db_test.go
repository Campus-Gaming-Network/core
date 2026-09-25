package auth

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSessionRepositoryFindSessionDoesNotWrite(t *testing.T) {
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
		INSERT INTO schools (name, slug) VALUES ('Session Lookup School', $1)
		RETURNING id::text
	`, "session-lookup-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Session User', $2::uuid, NOW())
		RETURNING id::text
	`, "session-lookup-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth_sessions WHERE user_id = $1::uuid`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	repository := NewSessionRepository(pool)
	tokenHash := HashToken("session-lookup-" + suffix)
	if err := repository.CreateSession(ctx, userID, tokenHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	// xmin changes whenever the row is updated, so an unchanged value proves
	// the lookups wrote nothing.
	readRow := func() (Session, string) {
		t.Helper()
		var session Session
		var version string
		if err := pool.QueryRow(ctx, `
			SELECT id::text, user_id::text, expires_at, xmin::text
			FROM auth_sessions WHERE token_hash = $1
		`, tokenHash).Scan(&session.ID, &session.UserID, &session.ExpiresAt, &version); err != nil {
			t.Fatalf("read session row: %v", err)
		}
		return session, version
	}
	want, versionBefore := readRow()

	for range 3 {
		got, err := repository.FindSession(ctx, tokenHash)
		if err != nil {
			t.Fatalf("FindSession() error = %v", err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("FindSession() = %#v, want %#v", got, want)
		}
	}
	if _, versionAfter := readRow(); versionAfter != versionBefore {
		t.Fatalf("session row version changed from %s to %s; lookups wrote to the row", versionBefore, versionAfter)
	}
}
