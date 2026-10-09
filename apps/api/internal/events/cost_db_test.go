package events

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryStoresAndFiltersCost(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	const schoolSlug = "cost-school"
	var schoolID string
	var userID string
	var gameID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Cost School', $1) RETURNING id::text
	`, schoolSlug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('cost@example.test', 'hash', 'Cost Organizer', $1::uuid, NOW())
		RETURNING id::text
	`, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Cost Game', 'cost-game') RETURNING id::text
	`).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	repository := NewPostgresRepository(pool)
	input := func(title string, cost string, day int) CreateInput {
		startsAt := time.Date(2031, time.May, day, 19, 0, 0, 0, location)
		return CreateInput{
			Title:         title,
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      AudienceOpen,
			EventType:     EventTypeGameNight,
			Cost:          cost,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      location.String(),
		}
	}
	if _, err := repository.Create(ctx, CreateParams{CreateInput: input("Cost Free", CostFree, 1)}); err != nil {
		t.Fatalf("Create(free) error = %v", err)
	}
	paidInput := input("Cost Paid", CostPaid, 2)
	paidInput.PaymentNote = "Pay at the door."
	paid, err := repository.Create(ctx, CreateParams{CreateInput: paidInput})
	if err != nil {
		t.Fatalf("Create(paid) error = %v", err)
	}
	// A request that names no cost is stored as unspecified, not free.
	if _, err := repository.Create(ctx, CreateParams{CreateInput: input("Cost Unsaid", "", 3)}); err != nil {
		t.Fatalf("Create(unsaid) error = %v", err)
	}
	seriesInput := input("Cost Series", CostFree, 4)
	seriesInput.RecurrenceRule = RecurrenceWeekly
	seriesInput.RecurrenceUntil = seriesInput.StartsAt.AddDate(0, 0, 8)
	if _, err := repository.Create(ctx, CreateParams{CreateInput: seriesInput}); err != nil {
		t.Fatalf("Create(series) error = %v", err)
	}

	listed := func(cost string) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, ListParams{SchoolSlug: schoolSlug, Cost: cost})
		if err != nil {
			t.Fatalf("ListPublic(%q) error = %v", cost, err)
		}
		costs := make([]string, 0, len(events))
		for _, event := range events {
			costs = append(costs, event.Title+"="+event.Cost+"/"+event.PaymentNote)
		}
		return costs
	}
	wantFree := []string{"Cost Series=free/", "Cost Series=free/", "Cost Free=free/"}
	if got := listed(CostFree); !reflect.DeepEqual(got, wantFree) {
		t.Fatalf("ListPublic(free) = %v, want %v", got, wantFree)
	}
	wantAll := []string{
		"Cost Series=free/", "Cost Series=free/", "Cost Unsaid=unspecified/",
		"Cost Paid=paid/Pay at the door.", "Cost Free=free/",
	}
	if got := listed(""); !reflect.DeepEqual(got, wantAll) {
		t.Fatalf("ListPublic() = %v, want %v", got, wantAll)
	}

	updated, err := repository.Update(ctx, UpdateParams{UpdateInput: UpdateInput{
		Slug:         paid.Slug,
		EditorUserID: userID,
		Title:        paid.Title,
		HostSchoolID: schoolID,
		GameIDs:      []string{gameID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		Audience:     AudienceOpen,
		EventType:    EventTypeGameNight,
		Cost:         CostFree,
		StartsAt:     paid.StartsAt,
		EndsAt:       paid.EndsAt,
		Timezone:     paid.Timezone,
	}})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Cost != CostFree {
		t.Fatalf("updated cost = %q, want %q", updated.Cost, CostFree)
	}
}

func TestCostMigrationKeepsPaidEventsAndLeavesTheRestUnspecified(t *testing.T) {
	// The migration runs in a schema of its own so the test can stop at the
	// version before it, insert rows that still have is_paid, and then apply it.
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")

	const migrations = "../../../../db/migrations"
	files, err := migrate.LoadFiles(migrations)
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}
	before := t.TempDir()
	for _, file := range files {
		if file.Version >= 24 {
			continue
		}
		sql, err := os.ReadFile(file.Path)
		if err != nil {
			t.Fatalf("read migration: %v", err)
		}
		if err := os.WriteFile(filepath.Join(before, filepath.Base(file.Path)), sql, 0o600); err != nil {
			t.Fatalf("copy migration: %v", err)
		}
	}
	if err := migrate.Run(ctx, pool, before); err != nil {
		t.Fatalf("migrate to the version before cost: %v", err)
	}

	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Cost Migration School', 'cost-migration-school')
		RETURNING id::text
	`).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('cost-migration@example.test', 'hash', 'Cost Migration Organizer', $1::uuid, NOW())
		RETURNING id::text
	`, schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, visibility, format,
			starts_at, ends_at, is_paid, payment_note
		)
		VALUES
			($1::uuid, $2::uuid, 'Paid Before', 'paid-before', 'public', 'online',
			 '2031-05-01T19:00:00Z', '2031-05-01T20:00:00Z', TRUE, 'Pay at the door.'),
			($1::uuid, $2::uuid, 'Unpaid Before', 'unpaid-before', 'public', 'online',
			 '2031-05-02T19:00:00Z', '2031-05-02T20:00:00Z', FALSE, NULL)
	`, userID, schoolID); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	if err := migrate.Run(ctx, pool, migrations); err != nil {
		t.Fatalf("apply the cost migration: %v", err)
	}

	repository := NewPostgresRepository(pool)
	listed := func(cost string) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, ListParams{Cost: cost})
		if err != nil {
			t.Fatalf("ListPublic(%q) error = %v", cost, err)
		}
		costs := make([]string, 0, len(events))
		for _, event := range events {
			costs = append(costs, event.Title+"="+event.Cost+"/"+event.PaymentNote)
		}
		return costs
	}
	wantAll := []string{"Unpaid Before=unspecified/", "Paid Before=paid/Pay at the door."}
	if got := listed(""); !reflect.DeepEqual(got, wantAll) {
		t.Fatalf("migrated events = %v, want %v", got, wantAll)
	}
	if got := listed(CostFree); len(got) != 0 {
		t.Fatalf("free events after migration = %v, want none", got)
	}
}
