package events

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRepositoryListPublicPagesSoonestFirstWithoutEndedEvents(t *testing.T) {
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
	schoolSlug := "soonest-first-school-" + suffix
	var schoolID string
	var userID string
	var gameID string
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if userID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM events WHERE creator_user_id = $1::uuid`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id = $1::uuid`, userID)
		}
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
		if gameID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM games WHERE id = $1::uuid`, gameID)
		}
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Soonest First School', $1) RETURNING id::text
	`, schoolSlug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Soonest First Organizer', $2::uuid, NOW())
		RETURNING id::text
	`, "soonest-first-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO games (name, slug) VALUES ('Soonest First Game', $1) RETURNING id::text
	`, "soonest-first-game-"+suffix).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	repository := NewPostgresRepository(pool)
	// December has ended and January is under way.
	repository.now = func() time.Time { return time.Date(2031, time.January, 10, 19, 30, 0, 0, location) }
	starts := []time.Time{
		time.Date(2030, time.December, 10, 19, 0, 0, 0, location),
		time.Date(2031, time.January, 10, 19, 0, 0, 0, location),
		time.Date(2031, time.February, 10, 19, 0, 0, 0, location),
		time.Date(2031, time.March, 10, 19, 0, 0, 0, location),
	}
	created := make([]Event, len(starts))
	for index, startsAt := range starts {
		created[index], err = repository.Create(ctx, CreateParams{CreateInput: CreateInput{
			Title:         fmt.Sprintf("Soonest First %s", startsAt.Month()),
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			GameIDs:       []string{gameID},
			Visibility:    VisibilityPublic,
			Format:        FormatOnline,
			Audience:      AudienceOpen,
			EventType:     EventTypeGameNight,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      location.String(),
		}})
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
	}
	january, february, march := created[1], created[2], created[3]
	cursor := func(event Event) *pagecursor.Cursor {
		return &pagecursor.Cursor{Timestamp: event.StartsAt, ID: event.ID}
	}

	for _, test := range []struct {
		name   string
		params ListParams
		want   []string
	}{
		{name: "first page", params: ListParams{Limit: 2}, want: []string{january.ID, february.ID}},
		{name: "next page", params: ListParams{Limit: 2, After: cursor(february)}, want: []string{march.ID}},
		{name: "previous page", params: ListParams{Limit: 2, Before: cursor(march)}, want: []string{january.ID, february.ID}},
		{name: "starts before February", params: ListParams{StartsBefore: &february.StartsAt}, want: []string{january.ID}},
		{name: "starts from February", params: ListParams{StartsAfter: &february.StartsAt}, want: []string{february.ID, march.ID}},
		{name: "starts in February", params: ListParams{StartsAfter: &february.StartsAt, StartsBefore: &march.StartsAt}, want: []string{february.ID}},
	} {
		test.params.SchoolSlug = schoolSlug
		events, err := repository.ListPublic(ctx, test.params)
		if err != nil {
			t.Fatalf("%s: ListPublic() error = %v", test.name, err)
		}
		got := make([]string, 0, len(events))
		for _, event := range events {
			got = append(got, event.ID)
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Fatalf("%s: ListPublic() IDs = %v, want %v", test.name, got, test.want)
		}
	}
}

func TestPostgresRepositoryListInterestedEventsListsUpcomingInterestsSoonestFirst(t *testing.T) {
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
	var schoolID, userID, guestID, gameID string
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if guestID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM event_interests WHERE user_id = $1::uuid`, guestID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id = $1::uuid`, guestID)
		}
		if userID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM event_interests WHERE user_id = $1::uuid`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM events WHERE creator_user_id = $1::uuid`, userID)
			_, _ = pool.Exec(cleanupContext, `DELETE FROM users WHERE id = $1::uuid`, userID)
		}
		if schoolID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
		}
		if gameID != "" {
			_, _ = pool.Exec(cleanupContext, `DELETE FROM games WHERE id = $1::uuid`, gameID)
		}
	})
	if err := pool.QueryRow(ctx, `INSERT INTO schools (name, slug) VALUES ('Interested School', $1) RETURNING id::text`, "interested-school-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Interested Viewer', $2::uuid, NOW()) RETURNING id::text
	`, "interested-"+suffix+"@example.test", schoolID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Interested Guest', $2::uuid, NOW()) RETURNING id::text
	`, "interested-guest-"+suffix+"@example.test", schoolID).Scan(&guestID); err != nil {
		t.Fatalf("insert guest: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO games (name, slug) VALUES ('Interested Game', $1) RETURNING id::text`, "interested-game-"+suffix).Scan(&gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	repository := NewPostgresRepository(pool)
	create := func(title string, month time.Month) Event {
		t.Helper()
		startsAt := time.Date(2031, month, 10, 19, 0, 0, 0, time.UTC)
		event, err := repository.Create(ctx, CreateParams{CreateInput: CreateInput{
			Title: title, CreatorUserID: userID, HostSchoolID: schoolID, GameIDs: []string{gameID},
			Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceOpen, EventType: EventTypeGameNight,
			StartsAt: startsAt, EndsAt: startsAt.Add(2 * time.Hour), Timezone: "UTC",
		}})
		if err != nil {
			t.Fatalf("create %s: %v", title, err)
		}
		return event
	}
	later := create("Interested Later", time.March)
	sooner := create("Interested Sooner", time.February)
	create("Not Interested", time.January)
	ended := create("Interested Ended", time.April)
	for _, event := range []Event{later, sooner, ended} {
		if _, err := repository.SetInterest(ctx, event.Slug, userID, true); err != nil {
			t.Fatalf("set interest on %s: %v", event.Slug, err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET starts_at = NOW() - interval '3 hours', ends_at = NOW() - interval '1 hour' WHERE id = $1::uuid`, ended.ID); err != nil {
		t.Fatalf("end event: %v", err)
	}

	listed, err := repository.ListInterestedEvents(ctx, userID, 10)
	if err != nil {
		t.Fatalf("list interested: %v", err)
	}
	// The creator organizes every event, so each is marked editable for them.
	type row struct {
		Slug       string
		Interested bool
		CanEdit    bool
	}
	got := make([]row, 0, len(listed))
	for _, event := range listed {
		got = append(got, row{event.Slug, event.ViewerInterested, event.ViewerCanEdit})
	}
	if want := []row{{sooner.Slug, true, true}, {later.Slug, true, true}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("interested events = %+v, want %+v (upcoming only, soonest first)", got, want)
	}

	// Someone else interested in the same event does not organize it.
	if _, err := repository.SetInterest(ctx, sooner.Slug, guestID, true); err != nil {
		t.Fatalf("set guest interest: %v", err)
	}
	guestListed, err := repository.ListInterestedEvents(ctx, guestID, 10)
	if err != nil {
		t.Fatalf("list guest interested: %v", err)
	}
	gotGuest := make([]row, 0, len(guestListed))
	for _, event := range guestListed {
		gotGuest = append(gotGuest, row{event.Slug, event.ViewerInterested, event.ViewerCanEdit})
	}
	if want := []row{{sooner.Slug, true, false}}; !reflect.DeepEqual(gotGuest, want) {
		t.Fatalf("guest interested events = %+v, want %+v", gotGuest, want)
	}
}
