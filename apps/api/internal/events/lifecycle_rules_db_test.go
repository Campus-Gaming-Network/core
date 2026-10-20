package events

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
)

// lifecycleFixture is a school, a creator, and a game in a fresh schema, and
// a repository whose clock the test sets.
type lifecycleFixture struct {
	repository *PostgresRepository
	schoolID   string
	creatorID  string
	gameID     string
}

func newLifecycleFixture(t *testing.T, schema string) lifecycleFixture {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, schema)
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	var fixture lifecycleFixture
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Lifecycle School', 'lifecycle-school') RETURNING id::text
	`).Scan(&fixture.schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('creator@example.test', 'hash', 'Creator', $1::uuid, NOW())
		RETURNING id::text
	`, fixture.schoolID).Scan(&fixture.creatorID); err != nil {
		t.Fatalf("insert creator: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Lifecycle Game', 'lifecycle-game') RETURNING id::text
	`).Scan(&fixture.gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	fixture.repository = NewPostgresRepository(pool)
	return fixture
}

func (f lifecycleFixture) input(title string, startsAt time.Time) CreateInput {
	return CreateInput{
		Title:         title,
		CreatorUserID: f.creatorID,
		HostSchoolID:  f.schoolID,
		GameIDs:       []string{f.gameID},
		Visibility:    VisibilityPublic,
		Format:        FormatOnline,
		Audience:      AudienceOpen,
		EventType:     EventTypeGameNight,
		StartsAt:      startsAt,
		EndsAt:        startsAt.Add(time.Hour),
		Timezone:      "UTC",
	}
}

func (f lifecycleFixture) create(t *testing.T, title string, startsAt time.Time) Event {
	t.Helper()
	event, err := f.repository.Create(context.Background(), CreateParams{CreateInput: f.input(title, startsAt)})
	if err != nil {
		t.Fatalf("Create(%s) error = %v", title, err)
	}
	return event
}

func TestPostgresRepositoryKeepsACancelledEventPageForADay(t *testing.T) {
	ctx := context.Background()
	fixture := newLifecycleFixture(t, "cancelled_event_page")
	repository := fixture.repository
	event := fixture.create(t, "Cancelled Night", time.Date(2030, time.March, 1, 19, 0, 0, 0, time.UTC))

	// Cancelling stamps the database's NOW(); the test clock starts there.
	repository.now = func() time.Time { return time.Date(2030, time.February, 1, 0, 0, 0, 0, time.UTC) }
	if err := repository.Delete(ctx, event.Slug, fixture.creatorID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	var cancelledAt time.Time
	if err := repository.pool.QueryRow(ctx, `SELECT deleted_at FROM events WHERE slug = $1`, event.Slug).Scan(&cancelledAt); err != nil {
		t.Fatalf("read cancellation time: %v", err)
	}

	if _, err := repository.GetBySlug(ctx, event.Slug); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetBySlug() of a cancelled event error = %v, want no rows", err)
	}
	repository.now = func() time.Time { return cancelledAt.Add(CancelledEventVisibility - time.Minute) }
	page, err := repository.GetPageBySlug(ctx, event.Slug)
	if err != nil {
		t.Fatalf("GetPageBySlug() within a day error = %v", err)
	}
	if page.CancelledAt == nil || !page.CancelledAt.Equal(cancelledAt) {
		t.Fatalf("GetPageBySlug() CancelledAt = %v, want %v", page.CancelledAt, cancelledAt)
	}
	organizers := make([]string, 0, len(page.Organizers))
	for _, organizer := range page.Organizers {
		organizers = append(organizers, organizer.Name+"="+organizer.Role)
	}
	if want := []string{"Creator=creator"}; !reflect.DeepEqual(organizers, want) {
		t.Fatalf("cancelled event organizers = %v, want %v", organizers, want)
	}

	repository.now = func() time.Time { return cancelledAt.Add(CancelledEventVisibility) }
	if _, err := repository.GetPageBySlug(ctx, event.Slug); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetPageBySlug() after a day error = %v, want no rows", err)
	}
}

func TestPostgresRepositoryRefusesToEditOrCancelAnEndedEvent(t *testing.T) {
	ctx := context.Background()
	fixture := newLifecycleFixture(t, "ended_event_rules")
	repository := fixture.repository
	startsAt := time.Date(2030, time.March, 1, 19, 0, 0, 0, time.UTC)
	event := fixture.create(t, "Ended Night", startsAt)
	update := UpdateParams{UpdateInput: UpdateInput{
		Slug:         event.Slug,
		EditorUserID: fixture.creatorID,
		Title:        "Renamed Night",
		HostSchoolID: fixture.schoolID,
		GameIDs:      []string{fixture.gameID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		Audience:     AudienceOpen,
		EventType:    EventTypeGameNight,
		StartsAt:     startsAt,
		EndsAt:       startsAt.Add(time.Hour),
		Timezone:     "UTC",
	}}

	repository.now = func() time.Time { return event.EndsAt }
	if _, err := repository.Update(ctx, update); !errors.Is(err, ErrEventEnded) {
		t.Fatalf("Update() at the end error = %v, want %v", err, ErrEventEnded)
	}
	if err := repository.Delete(ctx, event.Slug, fixture.creatorID); !errors.Is(err, ErrEventEnded) {
		t.Fatalf("Delete() at the end error = %v, want %v", err, ErrEventEnded)
	}

	repository.now = func() time.Time { return event.EndsAt.Add(-time.Minute) }
	if _, err := repository.Update(ctx, update); err != nil {
		t.Fatalf("Update() before the end error = %v", err)
	}
}

func TestPostgresRepositoryListsEveryEventACreatorMade(t *testing.T) {
	ctx := context.Background()
	fixture := newLifecycleFixture(t, "created_events")
	repository := fixture.repository
	first := time.Date(2030, time.March, 1, 19, 0, 0, 0, time.UTC)
	past := fixture.create(t, "Past Night", first)
	middle := fixture.create(t, "Middle Night", first.Add(24*time.Hour))
	cancelled := fixture.create(t, "Cancelled Night", first.Add(48*time.Hour))
	latest := fixture.create(t, "Latest Night", first.Add(72*time.Hour))
	if err := repository.Delete(ctx, cancelled.Slug, fixture.creatorID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	// The first event has ended by now and still lists.
	repository.now = func() time.Time { return first.Add(2 * time.Hour) }

	titles := func(page CreatedPage) []string {
		names := make([]string, 0, len(page.Events))
		for _, event := range page.Events {
			names = append(names, event.Title)
		}
		return names
	}
	firstPage, err := repository.ListCreated(ctx, fixture.creatorID, nil, 2)
	if err != nil {
		t.Fatalf("ListCreated() error = %v", err)
	}
	if got, want := titles(firstPage), []string{latest.Title, middle.Title}; !reflect.DeepEqual(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}
	cursor, err := pagecursor.Decode(firstPage.NextCursor)
	if err != nil {
		t.Fatalf("decode next cursor %q: %v", firstPage.NextCursor, err)
	}
	secondPage, err := repository.ListCreated(ctx, fixture.creatorID, &cursor, 2)
	if err != nil {
		t.Fatalf("ListCreated() second page error = %v", err)
	}
	if got, want := titles(secondPage), []string{past.Title}; !reflect.DeepEqual(got, want) || secondPage.NextCursor != "" {
		t.Fatalf("second page = %v, cursor %q; want %v and no cursor", got, secondPage.NextCursor, want)
	}
	if secondPage.Events[0].Lifecycle != LifecycleEnded {
		t.Fatalf("past event lifecycle = %q, want %q", secondPage.Events[0].Lifecycle, LifecycleEnded)
	}
}
