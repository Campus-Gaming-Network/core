package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/people"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
)

const (
	testEventSlug  = "campus-scrim-night"
	testSchoolSlug = "example-university"
	testTeamSlug   = "varsity-rocket-league"
)

type fakePeopleRepository struct {
	listed []people.Person
	err    error

	calls    int
	eventID  string
	response string
	schoolID string
	teamID   string
	params   people.ListParams
}

func (r *fakePeopleRepository) ListEventAttendees(_ context.Context, eventID string, response string, params people.ListParams) ([]people.Person, error) {
	r.calls++
	r.eventID, r.response, r.params = eventID, response, params
	return r.listed, r.err
}

func (r *fakePeopleRepository) ListSchoolMembers(_ context.Context, schoolID string, params people.ListParams) ([]people.Person, error) {
	r.calls++
	r.schoolID, r.params = schoolID, params
	return r.listed, r.err
}

func (r *fakePeopleRepository) ListTeamMembers(_ context.Context, teamID string, params people.ListParams) ([]people.Person, error) {
	r.calls++
	r.teamID, r.params = teamID, params
	return r.listed, r.err
}

// fakeSchoolDirectory resolves one school by slug, like the catalog does.
type fakeSchoolDirectory struct {
	fakeSchoolRepository
	school schools.School
}

func (d *fakeSchoolDirectory) GetBySlug(_ context.Context, slug string) (schools.School, error) {
	if slug != d.school.Slug {
		return schools.School{}, schools.ErrSchoolNotFound
	}
	return d.school, nil
}

// peopleFixture serves the three people-list routes the way the router does,
// behind the session middleware, over fake event, school, team, and people
// stores.
type peopleFixture struct {
	events  *fakeEventRepository
	teams   *fakeTeamRepository
	people  *fakePeopleRepository
	handler http.Handler
}

func newPeopleFixture(event eventstore.Event) *peopleFixture {
	fixture := &peopleFixture{
		events: &fakeEventRepository{detail: event},
		teams:  &fakeTeamRepository{detail: testTeam()},
		people: &fakePeopleRepository{},
	}
	router := &Router{
		cfg: config.Config{SessionCookie: "session", SessionTTL: time.Hour},
		schools: &fakeSchoolDirectory{school: schools.School{
			ID:   "33333333-3333-3333-3333-333333333333",
			Name: "Example University",
			Slug: testSchoolSlug,
		}},
		events: fixture.events,
		teams:  fixture.teams,
		people: fixture.people,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/events/", router.handleEventPath)
	mux.HandleFunc("/schools/", router.handleSchoolPath)
	mux.HandleFunc("/teams/", router.handleTeamPath)
	fixture.handler = auth.WithSession(
		fakeSessionStore{session: auth.Session{
			ID:        "session-id",
			UserID:    testUserID,
			ExpiresAt: time.Now().Add(time.Hour),
		}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(mux)
	return fixture
}

// get sends a GET request. Signed-out requests carry no session cookie.
func (f *peopleFixture) get(target string, signedIn bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, target, nil)
	if signedIn {
		request = authenticatedEventRequest(http.MethodGet, target, "")
	}
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

type peoplePageBody struct {
	People         []people.Person `json:"people"`
	Limit          int             `json:"limit"`
	HasMore        bool            `json:"has_more"`
	HasPrevious    bool            `json:"has_previous"`
	NextCursor     string          `json:"next_cursor"`
	PreviousCursor string          `json:"previous_cursor"`
}

func decodePeoplePage(t *testing.T, response *httptest.ResponseRecorder) peoplePageBody {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var body peoplePageBody
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return body
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status || strings.TrimSpace(response.Body.String()) != `{"error":"`+code+`"}` {
		t.Fatalf("response = %d %s, want %d %s", response.Code, response.Body.String(), status, code)
	}
}

// testPeople returns people in name order, as a list query returns them.
func testPeople(count int) []people.Person {
	names := []string{"Ada", "Bea", "Cy", "Dee", "Eli", "Flo"}
	result := make([]people.Person, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, people.Person{
			ID:                fmt.Sprintf("aaaaaaaa-aaaa-aaaa-aaaa-%012d", index+1),
			Name:              names[index],
			VerificationLevel: "verified",
			SortKey:           strings.ToLower(names[index]),
		})
	}
	return result
}

// withoutSortKey drops the field a response never carries, so a decoded page
// compares equal to the people a store returned.
func withoutSortKey(listed []people.Person) []people.Person {
	result := make([]people.Person, 0, len(listed))
	for _, person := range listed {
		person.SortKey = ""
		result = append(result, person)
	}
	return result
}

func TestPeopleListsRequireAuthentication(t *testing.T) {
	for _, target := range []string{
		"/events/" + testEventSlug + "/attendees",
		"/events/" + testEventSlug + "/attendees?response=maybe",
		"/schools/" + testSchoolSlug + "/members",
		"/teams/" + testTeamSlug + "/members",
	} {
		fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
		fixture.people.listed = testPeople(2)

		response := fixture.get(target, false)

		assertError(t, response, http.StatusUnauthorized, "authentication_required")
		if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
			t.Fatalf("%s: Cache-Control = %q, want private, no-store", target, got)
		}
		if fixture.people.calls != 0 {
			t.Fatalf("%s: the people store was read for a signed-out visitor", target)
		}
	}
}

func TestPeopleListsAreNotCacheableAndVaryBySession(t *testing.T) {
	for target, wantVary := range map[string][]string{
		"/events/" + testEventSlug + "/attendees": {"Cookie, Authorization", "X-CGN-Event-Unlock"},
		"/schools/" + testSchoolSlug + "/members": {"Cookie, Authorization"},
		"/teams/" + testTeamSlug + "/members":     {"Cookie, Authorization"},
	} {
		fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

		response := fixture.get(target, true)

		if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
			t.Fatalf("%s: Cache-Control = %q, want private, no-store", target, got)
		}
		if got := response.Header().Values("Vary"); !reflect.DeepEqual(got, wantVary) {
			t.Fatalf("%s: Vary = %q, want %q", target, got, wantVary)
		}
	}
}

func TestPeopleListsOnlyAnswerGet(t *testing.T) {
	for _, target := range []string{
		"/events/" + testEventSlug + "/attendees",
		"/schools/" + testSchoolSlug + "/members",
		"/teams/" + testTeamSlug + "/members",
	} {
		fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
		request := authenticatedEventRequest(http.MethodPost, target, "")
		response := httptest.NewRecorder()

		fixture.handler.ServeHTTP(response, request)

		assertError(t, response, http.StatusMethodNotAllowed, "method_not_allowed")
		if got := response.Header().Get("Allow"); got != http.MethodGet {
			t.Fatalf("%s: Allow = %q, want GET", target, got)
		}
	}
}

func TestEventAttendeesListsYesRSVPsByDefault(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
	fixture.people.listed = testPeople(2)

	body := decodePeoplePage(t, fixture.get("/events/"+testEventSlug+"/attendees", true))

	want := peoplePageBody{People: withoutSortKey(fixture.people.listed), Limit: 25}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("page = %#v, want %#v", body, want)
	}
	if fixture.people.eventID != "22222222-2222-2222-2222-222222222222" || fixture.people.response != eventstore.RSVPYes {
		t.Fatalf("listed event %q response %q, want the event's yes RSVPs", fixture.people.eventID, fixture.people.response)
	}
	if !reflect.DeepEqual(fixture.people.params, people.ListParams{Limit: 26}) {
		t.Fatalf("params = %#v, want a first page with one lookahead row", fixture.people.params)
	}
}

func TestEventAttendeesListsMaybeRSVPsOnRequest(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

	decodePeoplePage(t, fixture.get("/events/"+testEventSlug+"/attendees?response=maybe", true))

	if fixture.people.response != eventstore.RSVPMaybe {
		t.Fatalf("response = %q, want maybe", fixture.people.response)
	}
}

func TestEventAttendeesRejectUnsupportedResponses(t *testing.T) {
	for _, value := range []string{"no", "interested", "going", "YES", "yes,maybe", ""} {
		fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

		response := fixture.get("/events/"+testEventSlug+"/attendees?response="+value, true)

		assertError(t, response, http.StatusBadRequest, "invalid_response")
		if fixture.people.calls != 0 {
			t.Fatalf("response=%q: the people store was read", value)
		}
	}
}

func TestEventAttendeesFollowTheEventPageAccessRules(t *testing.T) {
	const target = "/events/" + testEventSlug + "/attendees"
	private := testEvent(eventstore.VisibilityPrivate)

	t.Run("a locked private event is not found", func(t *testing.T) {
		fixture := newPeopleFixture(private)
		fixture.people.listed = testPeople(2)

		response := fixture.get(target, true)

		assertError(t, response, http.StatusNotFound, "event_not_found")
		if fixture.people.calls != 0 {
			t.Fatal("the people store was read for a locked private event")
		}
	})

	t.Run("a wrong unlock token is not found", func(t *testing.T) {
		fixture := newPeopleFixture(private)
		request := authenticatedEventRequest(http.MethodGet, target, "")
		request.Header.Set("X-CGN-Event-Unlock", "stale-token")
		response := httptest.NewRecorder()

		fixture.handler.ServeHTTP(response, request)

		assertError(t, response, http.StatusNotFound, "event_not_found")
		if !fixture.events.unlockChecked || fixture.people.calls != 0 {
			t.Fatalf("unlock checked = %t, people reads = %d; want the token checked and no list read", fixture.events.unlockChecked, fixture.people.calls)
		}
	})

	t.Run("an unlocked private event is listed", func(t *testing.T) {
		fixture := newPeopleFixture(private)
		fixture.events.unlockValid = true
		fixture.people.listed = testPeople(1)
		request := authenticatedEventRequest(http.MethodGet, target, "")
		request.Header.Set("X-CGN-Event-Unlock", "raw-unlock-token")
		response := httptest.NewRecorder()

		fixture.handler.ServeHTTP(response, request)

		if body := decodePeoplePage(t, response); len(body.People) != 1 {
			t.Fatalf("people = %#v, want the attendee", body.People)
		}
	})

	t.Run("an organizer sees a private event without unlocking it", func(t *testing.T) {
		fixture := newPeopleFixture(private)
		fixture.events.isOrganizer = true
		fixture.people.listed = testPeople(1)

		if body := decodePeoplePage(t, fixture.get(target, true)); len(body.People) != 1 {
			t.Fatalf("people = %#v, want the attendee", body.People)
		}
	})

	t.Run("an unlisted event is listed like its page", func(t *testing.T) {
		fixture := newPeopleFixture(testEvent(eventstore.VisibilityUnlisted))
		fixture.people.listed = testPeople(1)

		if body := decodePeoplePage(t, fixture.get(target, true)); len(body.People) != 1 {
			t.Fatalf("people = %#v, want the attendee", body.People)
		}
	})

	t.Run("a missing or cancelled event is not found", func(t *testing.T) {
		fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

		response := fixture.get("/events/cancelled-scrim/attendees", true)

		assertError(t, response, http.StatusNotFound, "event_not_found")
		if fixture.people.calls != 0 {
			t.Fatal("the people store was read for a missing event")
		}
	})
}

func TestSchoolMembersListsTheSchoolsHomeMembers(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
	fixture.people.listed = testPeople(3)

	body := decodePeoplePage(t, fixture.get("/schools/"+testSchoolSlug+"/members?limit=10", true))

	want := peoplePageBody{People: withoutSortKey(fixture.people.listed), Limit: 10}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("page = %#v, want %#v", body, want)
	}
	if fixture.people.schoolID != "33333333-3333-3333-3333-333333333333" {
		t.Fatalf("listed school %q, want the school behind the slug", fixture.people.schoolID)
	}
}

func TestSchoolMembersRequireAnExistingSchool(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

	response := fixture.get("/schools/no-such-school/members", true)

	assertError(t, response, http.StatusNotFound, "school_not_found")
	if fixture.people.calls != 0 {
		t.Fatal("the people store was read for a missing school")
	}
}

func TestTeamMembersCarryEachMembersRole(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
	fixture.people.listed = []people.Person{
		{ID: testUserID, Name: "Team Owner", VerificationLevel: "staff_faculty", RoleIndicators: []string{"school_admin", "staff_faculty"}, Role: teamstore.RoleOwner, SortKey: "0team owner"},
		{ID: testTeamCaptainID, Name: "Team Captain", VerificationLevel: "verified", Role: teamstore.RoleCaptain, SortKey: "1team captain"},
		{ID: testTeamMemberID, Name: "Team Member", VerificationLevel: "basic", Role: teamstore.RoleMember, SortKey: "2team member"},
	}

	response := fixture.get("/teams/"+testTeamSlug+"/members", true)

	var raw map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	want := map[string]any{
		"people": []any{
			map[string]any{"id": testUserID, "name": "Team Owner", "verification_level": "staff_faculty", "role_indicators": []any{"school_admin", "staff_faculty"}, "role": "owner"},
			map[string]any{"id": testTeamCaptainID, "name": "Team Captain", "verification_level": "verified", "role": "captain"},
			map[string]any{"id": testTeamMemberID, "name": "Team Member", "verification_level": "basic", "role": "member"},
		},
		"limit":        float64(25),
		"has_more":     false,
		"has_previous": false,
	}
	if !reflect.DeepEqual(raw, want) {
		t.Fatalf("response = %#v, want %#v", raw, want)
	}
	if fixture.people.teamID != "55555555-5555-5555-5555-555555555555" {
		t.Fatalf("listed team %q, want the team behind the slug", fixture.people.teamID)
	}
	if fixture.teams.listMembersCalled {
		t.Fatal("the owner roster was read to build the people list")
	}
}

func TestTeamMembersRequireAnExistingTeam(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

	response := fixture.get("/teams/no-such-team/members", true)

	assertError(t, response, http.StatusNotFound, "team_not_found")
	if fixture.people.calls != 0 {
		t.Fatal("the people store was read for a missing team")
	}
}

// The owner's roster in the team detail is the captain-management list. It is
// not a people list, so the people store and the opt-out setting do not touch
// it.
func TestTeamDetailOwnerRosterIsNotAPeopleList(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
	fixture.teams.viewerRole = teamstore.RoleOwner
	fixture.teams.members = testTeamMembers()

	response := fixture.get("/teams/"+testTeamSlug, true)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var team teamstore.Team
	if err := json.NewDecoder(response.Body).Decode(&team); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !reflect.DeepEqual(team.Members, testTeamMembers()) {
		t.Fatalf("Members = %#v, want the full owner roster %#v", team.Members, testTeamMembers())
	}
	if !fixture.teams.listMembersCalled || fixture.people.calls != 0 {
		t.Fatalf("roster read = %t, people reads = %d; want the roster only", fixture.teams.listMembersCalled, fixture.people.calls)
	}
}

func TestPeopleListsReturnAnEmptyArrayWhenNobodyIsListed(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

	response := fixture.get("/schools/"+testSchoolSlug+"/members", true)

	if body := strings.TrimSpace(response.Body.String()); body != `{"has_more":false,"has_previous":false,"limit":25,"people":[]}` {
		t.Fatalf("body = %s, want an empty people array", body)
	}
}

func TestPeopleListsPageByNameWithOpaqueCursors(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
	all := testPeople(6)
	const target = "/schools/" + testSchoolSlug + "/members"

	// First page: the store returns the limit plus a lookahead row.
	fixture.people.listed = all
	first := decodePeoplePage(t, fixture.get(target+"?limit=5", true))
	if !reflect.DeepEqual(first.People, withoutSortKey(all[:5])) || !first.HasMore || first.HasPrevious || first.PreviousCursor != "" {
		t.Fatalf("first page = %#v, want five people with only a next page", first)
	}
	next, err := pagecursor.DecodeKey(first.NextCursor)
	if err != nil || next != (pagecursor.KeyCursor{Key: "eli", ID: all[4].ID}) {
		t.Fatalf("next cursor = %#v, %v; want the fifth person", next, err)
	}

	// Following the cursor resumes after the fifth person.
	fixture.people.listed = all[5:]
	second := decodePeoplePage(t, fixture.get(target+"?limit=5&after="+first.NextCursor, true))
	if !reflect.DeepEqual(fixture.people.params, people.ListParams{Limit: 6, After: &next}) {
		t.Fatalf("params = %#v, want the first page's boundary as After", fixture.people.params)
	}
	if !reflect.DeepEqual(second.People, withoutSortKey(all[5:])) || second.HasMore || !second.HasPrevious || second.NextCursor != "" {
		t.Fatalf("second page = %#v, want the last person with only a previous page", second)
	}
	previous, err := pagecursor.DecodeKey(second.PreviousCursor)
	if err != nil || previous != (pagecursor.KeyCursor{Key: "flo", ID: all[5].ID}) {
		t.Fatalf("previous cursor = %#v, %v; want the sixth person", previous, err)
	}

	// Going back reads the rows before the sixth person; the lookahead row
	// leads, and is dropped from the page.
	fixture.people.listed = all[2:5]
	back := decodePeoplePage(t, fixture.get(target+"?limit=2&before="+second.PreviousCursor, true))
	if !reflect.DeepEqual(fixture.people.params, people.ListParams{Limit: 3, Before: &previous}) {
		t.Fatalf("params = %#v, want the previous cursor as Before", fixture.people.params)
	}
	if !reflect.DeepEqual(back.People, withoutSortKey(all[3:5])) || !back.HasMore || !back.HasPrevious {
		t.Fatalf("previous page = %#v, want the two people before the sixth with pages on both sides", back)
	}
	if backNext, err := pagecursor.DecodeKey(back.NextCursor); err != nil || backNext.ID != all[4].ID {
		t.Fatalf("previous page next cursor = %#v, %v; want the last person on the page", backNext, err)
	}
}

func TestPeopleListsRejectInvalidPagination(t *testing.T) {
	timestampCursor := pagecursor.Encode(time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC), "22222222-2222-2222-2222-222222222222")
	keyCursor := pagecursor.EncodeKey("ada", "22222222-2222-2222-2222-222222222222")
	for query, code := range map[string]string{
		"limit=0":             "invalid_limit",
		"limit=101":           "invalid_limit",
		"limit=many":          "invalid_limit",
		"after=not-a-cursor":  "invalid_cursor",
		"before=not-a-cursor": "invalid_cursor",
		"after=" + keyCursor + "&before=" + keyCursor: "invalid_cursor",
		"after=" + timestampCursor:                    "invalid_cursor",
	} {
		for _, path := range []string{
			"/events/" + testEventSlug + "/attendees",
			"/schools/" + testSchoolSlug + "/members",
			"/teams/" + testTeamSlug + "/members",
		} {
			fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))

			response := fixture.get(path+"?"+query, true)

			assertError(t, response, http.StatusBadRequest, code)
			if fixture.people.calls != 0 {
				t.Fatalf("%s?%s: the people store was read", path, query)
			}
		}
	}
}

func TestPeopleListsMapStoreFailuresToServerErrors(t *testing.T) {
	fixture := newPeopleFixture(testEvent(eventstore.VisibilityPublic))
	fixture.people.err = context.DeadlineExceeded

	response := fixture.get("/teams/"+testTeamSlug+"/members", true)

	assertError(t, response, http.StatusInternalServerError, "people_unavailable")
}
