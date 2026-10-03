package people

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5/pgxpool"
)

// peopleFixture is one school with a mix of accounts that may and may not
// appear in a list, plus an event and a team that all of them belong to. Each
// test builds its own with fresh slugs and emails, so the shared test
// database's other rows do not change the lists.
type peopleFixture struct {
	pool       *pgxpool.Pool
	repository *PostgresRepository
	schoolID   string
	otherID    string
	eventID    string
	teamID     string
	teamSlug   string
	// ids maps a fixture name to its user ID.
	ids map[string]string
}

// Runs only when API_DATABASE_URL points at a migrated database.
func newPeopleFixture(t *testing.T) *peopleFixture {
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

	fixture := &peopleFixture{pool: pool, repository: NewPostgresRepository(pool), ids: map[string]string{}}
	// Cleanups run last in, first out: events and teams, then users, then schools.
	school := func(label string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id::text
		`, "People "+label, "people-"+label+"-"+suffix).Scan(&id); err != nil {
			t.Fatalf("insert school: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, id)
		})
		return id
	}
	fixture.schoolID = school("home")
	fixture.otherID = school("other")

	// state: "ok", "unverified", "suspended", "deleted", or "hidden" (opted out).
	user := func(name string, schoolID string, level string, state string) {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (
				email, password_hash, name, verification_level, home_school_id,
				age_confirmed_at, email_verified_at, account_status, deleted_at, show_in_lists
			)
			VALUES (
				$1, 'hash', $2, $3, $4::uuid, NOW(),
				CASE WHEN $5::text = 'unverified' THEN NULL ELSE NOW() END,
				CASE WHEN $5::text = 'suspended' THEN 'suspended' WHEN $5::text = 'deleted' THEN 'deleted' ELSE 'active' END,
				CASE WHEN $5::text = 'deleted' THEN NOW() END,
				$5::text <> 'hidden'
			)
			RETURNING id::text
		`, fmt.Sprintf("people-%s-%s@example.test", suffix, name), name, level, schoolID, state).Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", name, err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, id)
		})
		fixture.ids[name] = id
	}
	// Names mix case on purpose: the order is case-insensitive.
	user("Zed", fixture.schoolID, "basic", "ok")
	user("adam", fixture.schoolID, "verified", "ok")
	user("Bea", fixture.schoolID, "verified", "ok")
	user("Cy", fixture.schoolID, "staff_faculty", "ok")
	user("Ada", fixture.schoolID, "verified", "ok")
	user("Hidden", fixture.schoolID, "verified", "hidden")
	user("Unverified", fixture.schoolID, "basic", "unverified")
	user("Suspended", fixture.schoolID, "verified", "suspended")
	user("Deleted", fixture.schoolID, "verified", "deleted")
	// A follower's home school is elsewhere, so the school list leaves them out.
	user("Follower", fixture.otherID, "verified", "ok")

	// Cy administers the school, which both the list and the profile show.
	if _, err := pool.Exec(ctx, `
		INSERT INTO school_admins (school_id, user_id) VALUES ($1::uuid, $2::uuid)
	`, fixture.schoolID, fixture.ids["Cy"]); err != nil {
		t.Fatalf("insert school admin: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_school_follows (user_id, school_id) VALUES ($1::uuid, $2::uuid)
	`, fixture.ids["Follower"], fixture.schoolID); err != nil {
		t.Fatalf("insert follow: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO events (creator_user_id, host_school_id, title, slug, visibility, format, starts_at, ends_at)
		VALUES ($1::uuid, $2::uuid, 'People Event', $3, 'public', 'online', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days')
		RETURNING id::text
	`, fixture.ids["Ada"], fixture.schoolID, "people-event-"+suffix).Scan(&fixture.eventID); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM events WHERE id = $1::uuid`, fixture.eventID)
	})
	rsvp := func(name string, response string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO event_rsvps (event_id, user_id, response) VALUES ($1::uuid, $2::uuid, $3)
		`, fixture.eventID, fixture.ids[name], response); err != nil {
			t.Fatalf("insert rsvp %s: %v", name, err)
		}
	}
	for _, name := range []string{"Zed", "adam", "Bea", "Hidden", "Unverified", "Suspended", "Deleted"} {
		rsvp(name, "yes")
	}
	rsvp("Cy", "maybe")
	rsvp("Ada", "no")
	// Interested is a count only, never a list.
	if _, err := pool.Exec(ctx, `
		INSERT INTO event_interests (event_id, user_id) VALUES ($1::uuid, $2::uuid)
	`, fixture.eventID, fixture.ids["Follower"]); err != nil {
		t.Fatalf("insert interest: %v", err)
	}
	// A withdrawn RSVP is soft deleted and must not list.
	rsvp("Follower", "yes")
	if _, err := pool.Exec(ctx, `
		UPDATE event_rsvps SET deleted_at = NOW() WHERE event_id = $1::uuid AND user_id = $2::uuid
	`, fixture.eventID, fixture.ids["Follower"]); err != nil {
		t.Fatalf("withdraw rsvp: %v", err)
	}

	fixture.teamSlug = "people-team-" + suffix
	if err := pool.QueryRow(ctx, `
		INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
		VALUES ($1::uuid, $2::uuid, 'People Team', $3, 'hash')
		RETURNING id::text
	`, fixture.ids["Zed"], fixture.schoolID, fixture.teamSlug).Scan(&fixture.teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM teams WHERE id = $1::uuid`, fixture.teamID)
	})
	member := func(name string, role string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)
		`, fixture.teamID, fixture.ids[name], role); err != nil {
			t.Fatalf("insert team member %s: %v", name, err)
		}
	}
	// The owner sorts last by name, so the role order is visible in the result.
	member("Zed", "owner")
	member("Cy", "captain")
	member("Bea", "member")
	member("adam", "member")
	member("Hidden", "member")
	member("Unverified", "member")
	member("Suspended", "member")
	member("Deleted", "member")
	return fixture
}

func (f *peopleFixture) names(listed []Person) []string {
	names := make([]string, 0, len(listed))
	for _, person := range listed {
		names = append(names, person.Name)
	}
	return names
}

func TestPostgresRepositoryListsOnlyListableAccountsInNameOrder(t *testing.T) {
	fixture := newPeopleFixture(t)
	ctx := context.Background()

	yes, err := fixture.repository.ListEventAttendees(ctx, fixture.eventID, "yes", ListParams{Limit: 50})
	if err != nil {
		t.Fatalf("ListEventAttendees(yes) error = %v", err)
	}
	if got, want := fixture.names(yes), []string{"adam", "Bea", "Zed"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("yes attendees = %v, want %v: opted-out, unverified, suspended, deleted, and withdrawn RSVPs are left out", got, want)
	}
	maybe, err := fixture.repository.ListEventAttendees(ctx, fixture.eventID, "maybe", ListParams{Limit: 50})
	if err != nil {
		t.Fatalf("ListEventAttendees(maybe) error = %v", err)
	}
	if got, want := fixture.names(maybe), []string{"Cy"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("maybe attendees = %v, want %v", got, want)
	}

	members, err := fixture.repository.ListSchoolMembers(ctx, fixture.schoolID, ListParams{Limit: 50})
	if err != nil {
		t.Fatalf("ListSchoolMembers() error = %v", err)
	}
	if got, want := fixture.names(members), []string{"Ada", "adam", "Bea", "Cy", "Zed"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("school members = %v, want %v: followers are not listed", got, want)
	}
}

// An opt-out hides the person from the lists only: their RSVP and membership
// remain, and the owner's roster, which manages captains, still shows them.
func TestOptingOutHidesAPersonFromListsButNotFromTheirRecords(t *testing.T) {
	fixture := newPeopleFixture(t)
	ctx := context.Background()

	var rsvps int
	if err := fixture.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM event_rsvps
		WHERE event_id = $1::uuid AND user_id = $2::uuid AND deleted_at IS NULL
	`, fixture.eventID, fixture.ids["Hidden"]).Scan(&rsvps); err != nil || rsvps != 1 {
		t.Fatalf("opted-out RSVP count = %d, %v; want the RSVP kept", rsvps, err)
	}
	roster, err := teamstore.NewPostgresRepository(fixture.pool).ListMembers(ctx, fixture.teamSlug)
	if err != nil {
		t.Fatalf("ListMembers() error = %v", err)
	}
	found := false
	for _, member := range roster {
		found = found || member.UserID == fixture.ids["Hidden"]
	}
	if !found {
		t.Fatalf("owner roster = %#v, want the opted-out member kept for captain management", roster)
	}
}

func TestPostgresRepositoryListsTeamMembersOwnerFirstThenCaptainsThenMembers(t *testing.T) {
	fixture := newPeopleFixture(t)

	listed, err := fixture.repository.ListTeamMembers(context.Background(), fixture.teamID, ListParams{Limit: 50})
	if err != nil {
		t.Fatalf("ListTeamMembers() error = %v", err)
	}

	got := make([]string, 0, len(listed))
	for _, person := range listed {
		got = append(got, person.Role+":"+person.Name)
	}
	if want := []string{"owner:Zed", "captain:Cy", "member:adam", "member:Bea"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("team members = %v, want %v", got, want)
	}
}

// The list shows the same trust indicators as each person's profile.
func TestListedPeopleCarryTheirProfilesVerificationAndRoleIndicators(t *testing.T) {
	fixture := newPeopleFixture(t)
	ctx := context.Background()

	listed, err := fixture.repository.ListSchoolMembers(ctx, fixture.schoolID, ListParams{Limit: 50})
	if err != nil {
		t.Fatalf("ListSchoolMembers() error = %v", err)
	}
	profiles := users.NewPostgresRepository(fixture.pool)
	for _, person := range listed {
		profile, err := profiles.FindByID(ctx, person.ID)
		if err != nil {
			t.Fatalf("FindByID(%s) error = %v", person.Name, err)
		}
		want := Person{
			ID:                profile.ID,
			Name:              profile.Name,
			VerificationLevel: profile.VerificationLevel,
			RoleIndicators:    profile.RoleIndicators,
			SortKey:           person.SortKey,
		}
		// No indicators is an empty list in one place and none in the other.
		if len(want.RoleIndicators) == 0 {
			want.RoleIndicators = nil
		}
		if len(person.RoleIndicators) == 0 {
			person.RoleIndicators = nil
		}
		if !reflect.DeepEqual(person, want) {
			t.Fatalf("listed %s = %#v, want the profile's %#v", person.Name, person, want)
		}
	}
	if got := listed[3]; got.Name != "Cy" || !reflect.DeepEqual(got.RoleIndicators, []string{"school_admin", "staff_faculty"}) {
		t.Fatalf("listed Cy = %#v, want both indicators", got)
	}
}

// Walking forward by cursor, then backward, visits every listable person once
// and in order, for the plain name order and the team's role-then-name order.
func TestPostgresRepositoryPagesForwardAndBackwardByKeyCursor(t *testing.T) {
	fixture := newPeopleFixture(t)
	ctx := context.Background()

	lists := map[string]func(ListParams) ([]Person, error){
		"school": func(params ListParams) ([]Person, error) {
			return fixture.repository.ListSchoolMembers(ctx, fixture.schoolID, params)
		},
		"team": func(params ListParams) ([]Person, error) {
			return fixture.repository.ListTeamMembers(ctx, fixture.teamID, params)
		},
	}
	for name, list := range lists {
		everyone, err := list(ListParams{Limit: 50})
		if err != nil {
			t.Fatalf("%s: list everyone: %v", name, err)
		}

		// Pages of two, each fetched with one lookahead row like the handler does.
		var forward []Person
		var after *pagecursor.KeyCursor
		for pages := 0; ; pages++ {
			if pages > len(everyone) {
				t.Fatalf("%s: forward paging did not finish", name)
			}
			rows, err := list(ListParams{Limit: 3, After: after})
			if err != nil {
				t.Fatalf("%s: forward page: %v", name, err)
			}
			page := rows
			if len(rows) > 2 {
				page = rows[:2]
			}
			forward = append(forward, page...)
			if len(rows) <= 2 {
				break
			}
			last := page[len(page)-1]
			after = &pagecursor.KeyCursor{Key: last.SortKey, ID: last.ID}
		}
		if !reflect.DeepEqual(forward, everyone) {
			t.Fatalf("%s: forward pages = %v, want %v", name, fixture.names(forward), fixture.names(everyone))
		}

		// Reading back from the last person returns the rows before them, in order.
		last := everyone[len(everyone)-1]
		back, err := list(ListParams{Limit: 3, Before: &pagecursor.KeyCursor{Key: last.SortKey, ID: last.ID}})
		if err != nil {
			t.Fatalf("%s: backward page: %v", name, err)
		}
		if want := everyone[len(everyone)-4 : len(everyone)-1]; !reflect.DeepEqual(back, want) {
			t.Fatalf("%s: backward page = %v, want %v", name, fixture.names(back), fixture.names(want))
		}
	}
}

func TestPostgresRepositoryRejectsTwoCursors(t *testing.T) {
	fixture := newPeopleFixture(t)
	cursor := &pagecursor.KeyCursor{Key: "ada", ID: fixture.ids["Ada"]}

	_, err := fixture.repository.ListSchoolMembers(context.Background(), fixture.schoolID, ListParams{Limit: 3, After: cursor, Before: cursor})

	if err != pagecursor.ErrInvalid {
		t.Fatalf("ListSchoolMembers() error = %v, want %v", err, pagecursor.ErrInvalid)
	}
}
