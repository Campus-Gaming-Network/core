package policies

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The instant the first published documents took effect.
var draftEffectiveAt = time.Date(2026, time.October, 6, 0, 0, 0, 0, time.UTC)

func policyTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestCurrentReturnsTheVersionsInEffectAtAnInstant(t *testing.T) {
	repository := NewPostgresRepository(policyTestPool(t))
	ctx := context.Background()

	current, err := repository.Current(ctx, draftEffectiveAt)
	if err != nil {
		t.Fatalf("Current(effective instant) error = %v", err)
	}
	got := [2][2]string{
		{current.Terms.Type, current.Terms.Version},
		{current.Privacy.Type, current.Privacy.Version},
	}
	want := [2][2]string{{TypeTerms, "draft-2026-10-06"}, {TypePrivacy, "draft-2026-10-06"}}
	if got != want {
		t.Fatalf("Current(effective instant) = %v, want %v", got, want)
	}
	if current.Terms.ID == "" || current.Privacy.ID == "" || len(current.Terms.ContentSHA256) != 64 {
		t.Fatalf("Current() = %#v, want document IDs and content hashes", current)
	}

	if _, err := repository.Current(ctx, draftEffectiveAt.Add(-time.Second)); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Current(before any version took effect) error = %v, want ErrUnavailable", err)
	}
}

func TestPublishedDocumentsCannotBeEditedOrRemoved(t *testing.T) {
	pool := policyTestPool(t)
	ctx := context.Background()

	for name, statement := range map[string]string{
		"edit":   `UPDATE policy_documents SET content_sha256 = repeat('0', 64) WHERE version = 'draft-2026-10-06'`,
		"remove": `DELETE FROM policy_documents WHERE version = 'draft-2026-10-06'`,
	} {
		if _, err := pool.Exec(ctx, statement); err == nil {
			t.Fatalf("%s of a published policy document succeeded, want it refused", name)
		}
	}

	var unchanged int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM policy_documents
		WHERE version = 'draft-2026-10-06' AND content_sha256 <> repeat('0', 64)
	`).Scan(&unchanged); err != nil || unchanged != 2 {
		t.Fatalf("unchanged published documents = %d, %v; want 2", unchanged, err)
	}
}
