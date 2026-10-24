package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
)

func TestHandleEventsReturnsPublicEventsWithFilters(t *testing.T) {
	repository := &fakeEventRepository{listed: []eventstore.Event{
		testEvent(eventstore.VisibilityPublic),
	}}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events?game=rocket-league&school=example-university&format=online&audience=open&type=lan&cost=free&limit=5", nil)
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listPublicCalled {
		t.Fatal("ListPublic was not called")
	}
	if repository.listParams.GameSlug != "rocket-league" || repository.listParams.SchoolSlug != "example-university" {
		t.Fatalf("list params = %#v, want game and school filters", repository.listParams)
	}
	if repository.listParams.Format != eventstore.FormatOnline {
		t.Fatalf("format = %q, want %q", repository.listParams.Format, eventstore.FormatOnline)
	}
	if repository.listParams.Audience != eventstore.AudienceOpen {
		t.Fatalf("audience = %q, want %q", repository.listParams.Audience, eventstore.AudienceOpen)
	}
	if repository.listParams.EventType != eventstore.EventTypeLAN {
		t.Fatalf("event type = %q, want %q", repository.listParams.EventType, eventstore.EventTypeLAN)
	}
	if repository.listParams.Cost != eventstore.CostFree {
		t.Fatalf("cost = %q, want %q", repository.listParams.Cost, eventstore.CostFree)
	}
	if repository.listParams.Limit != 6 || repository.listParams.After != nil || repository.listParams.Before != nil {
		t.Fatalf("list params = %#v, want a six-row first-page fetch", repository.listParams)
	}
	var payload struct {
		Events      []eventstore.Event `json:"events"`
		Limit       int                `json:"limit"`
		HasMore     bool               `json:"has_more"`
		HasPrevious bool               `json:"has_previous"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Events) != 1 || payload.Events[0].Slug != "campus-scrim-night" {
		t.Fatalf("events = %#v, want public event payload", payload.Events)
	}
	if payload.Limit != 5 || payload.HasMore || payload.HasPrevious {
		t.Fatalf("pagination = %#v, want a single first page", payload)
	}
}

func TestHandleEventsRejectsInvalidPagination(t *testing.T) {
	router := &Router{events: &fakeEventRepository{}}
	request := httptest.NewRequest(http.MethodGet, "/events?limit=not-a-number", nil)
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestHandleEventsReadsTheStartRange(t *testing.T) {
	weekStart := time.Date(2031, time.January, 10, 12, 0, 0, 0, time.UTC)
	weekEnd := weekStart.AddDate(0, 0, 7)
	for _, test := range []struct {
		query      string
		wantAfter  *time.Time
		wantBefore *time.Time
	}{
		{query: "", wantAfter: nil, wantBefore: nil},
		{query: "starts_before=2031-01-17T12:00:00Z", wantAfter: nil, wantBefore: &weekEnd},
		{query: "starts_after=2031-01-10T12:00:00Z&starts_before=2031-01-17T12:00:00Z", wantAfter: &weekStart, wantBefore: &weekEnd},
	} {
		repository := &fakeEventRepository{}
		router := &Router{events: repository}
		response := httptest.NewRecorder()

		router.handleEvents(response, httptest.NewRequest(http.MethodGet, "/events?"+test.query, nil))

		if response.Code != http.StatusOK {
			t.Fatalf("%q: status = %d, want %d", test.query, response.Code, http.StatusOK)
		}
		got := [2]*time.Time{repository.listParams.StartsAfter, repository.listParams.StartsBefore}
		if !reflect.DeepEqual(got, [2]*time.Time{test.wantAfter, test.wantBefore}) {
			t.Fatalf("%q: start range = %v, want %v and %v", test.query, got, test.wantAfter, test.wantBefore)
		}
	}

	for _, query := range []string{
		"starts_after=tomorrow",
		"starts_before=2031-01-17",
		"starts_after=2031-01-17T12:00:00Z&starts_before=2031-01-17T12:00:00Z",
		"starts_after=2031-01-18T12:00:00Z&starts_before=2031-01-17T12:00:00Z",
	} {
		repository := &fakeEventRepository{}
		router := &Router{events: repository}
		response := httptest.NewRecorder()

		router.handleEvents(response, httptest.NewRequest(http.MethodGet, "/events?"+query, nil))

		if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\"invalid_time_range\"}\n" {
			t.Fatalf("%q: response = %d %s, want 400 invalid_time_range", query, response.Code, response.Body.String())
		}
		if repository.listPublicCalled {
			t.Fatalf("%q: ListPublic was called for an invalid range", query)
		}
	}
}

func TestHandleEventsReadsKeywordAndDates(t *testing.T) {
	type search struct{ Query, From, To string }
	for _, test := range []struct {
		query string
		want  search
	}{
		{query: "", want: search{}},
		{query: "q=+Smash+Night+&from=2031-05-01&to=2031-05-01", want: search{Query: "Smash Night", From: "2031-05-01", To: "2031-05-01"}},
		{query: "from=2031-05-01", want: search{From: "2031-05-01"}},
		{query: "to=2031-05-31&q=" + strings.Repeat("é", maxEventQueryLength), want: search{Query: strings.Repeat("é", maxEventQueryLength), To: "2031-05-31"}},
	} {
		repository := &fakeEventRepository{}
		response := httptest.NewRecorder()
		(&Router{events: repository}).handleEvents(response, httptest.NewRequest(http.MethodGet, "/events?"+test.query, nil))

		got := search{repository.listParams.Query, repository.listParams.FromDate, repository.listParams.ToDate}
		if response.Code != http.StatusOK || got != test.want {
			t.Fatalf("%q: %d with %+v, want 200 with %+v", test.query, response.Code, got, test.want)
		}
	}

	for query, code := range map[string]string{
		"from=May+1":                    "invalid_date_range",
		"to=2031-02-30":                 "invalid_date_range",
		"from=2031-05-02&to=2031-05-01": "invalid_date_range",
		"q=" + strings.Repeat("a", 101): "invalid_query",
	} {
		repository := &fakeEventRepository{}
		response := httptest.NewRecorder()
		(&Router{events: repository}).handleEvents(response, httptest.NewRequest(http.MethodGet, "/events?"+query, nil))

		if response.Code != http.StatusBadRequest || response.Body.String() != "{\"error\":\""+code+"\"}\n" || repository.listPublicCalled {
			t.Fatalf("%q: response = %d %s, want 400 %s without a query", query, response.Code, response.Body.String(), code)
		}
	}
}

func TestHandleEventsProvidesStableNextAndPreviousCursors(t *testing.T) {
	events := make([]eventstore.Event, 0, 6)
	for index := 0; index < 6; index++ {
		event := testEvent(eventstore.VisibilityPublic)
		event.ID = fmt.Sprintf("22222222-2222-2222-2222-%012d", index+1)
		event.StartsAt = event.StartsAt.Add(time.Duration(index) * time.Hour)
		events = append(events, event)
	}
	repository := &fakeEventRepository{listed: events}
	router := &Router{events: repository}
	firstResponse := httptest.NewRecorder()

	router.handleEvents(firstResponse, httptest.NewRequest(http.MethodGet, "/events?limit=5", nil))

	var firstPage struct {
		Events     []eventstore.Event `json:"events"`
		HasMore    bool               `json:"has_more"`
		NextCursor string             `json:"next_cursor"`
	}
	if err := json.NewDecoder(firstResponse.Body).Decode(&firstPage); err != nil {
		t.Fatalf("decode first page: %v", err)
	}
	if len(firstPage.Events) != 5 || !firstPage.HasMore || firstPage.NextCursor == "" {
		t.Fatalf("first page = %#v, want five events and a next cursor", firstPage)
	}

	repository.listed = events[5:]
	secondResponse := httptest.NewRecorder()
	router.handleEvents(secondResponse, httptest.NewRequest(http.MethodGet, "/events?limit=5&after="+firstPage.NextCursor, nil))

	if repository.listParams.After == nil || repository.listParams.After.ID != events[4].ID || !repository.listParams.After.Timestamp.Equal(events[4].StartsAt) {
		t.Fatalf("after cursor = %#v, want the first page boundary", repository.listParams.After)
	}
	var secondPage struct {
		Events         []eventstore.Event `json:"events"`
		HasMore        bool               `json:"has_more"`
		HasPrevious    bool               `json:"has_previous"`
		PreviousCursor string             `json:"previous_cursor"`
	}
	if err := json.NewDecoder(secondResponse.Body).Decode(&secondPage); err != nil {
		t.Fatalf("decode second page: %v", err)
	}
	if len(secondPage.Events) != 1 || secondPage.HasMore || !secondPage.HasPrevious || secondPage.PreviousCursor == "" {
		t.Fatalf("second page = %#v, want the final event and a previous cursor", secondPage)
	}
}

func TestHandleEventsRejectsMalformedCursor(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events?after=not-a-cursor", nil)
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if repository.listPublicCalled {
		t.Fatal("ListPublic was called for a malformed cursor")
	}
}

func TestHandleMyEventsRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/me/events", nil)
	response := httptest.NewRecorder()

	router.handleMyEvents(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.listUpcomingRSVPsCalled || repository.listFollowedSchoolEventsCalled {
		t.Fatal("dashboard event queries were called for unauthenticated request")
	}
}

func TestHandleMyEventsReturnsDashboardEvents(t *testing.T) {
	upcoming := testEvent(eventstore.VisibilityPublic)
	yes := eventstore.RSVPYes
	upcoming.ViewerRSVP = &yes
	followed := testEvent(eventstore.VisibilityPublic)
	followed.ID = "88888888-8888-8888-8888-888888888888"
	followed.Slug = "followed-campus-final"
	followed.Title = "Followed Campus Final"
	interested := testEvent(eventstore.VisibilityPublic)
	interested.Slug = "interested-campus-cup"
	interested.ViewerInterested = true
	repository := &fakeEventRepository{
		upcomingRSVPs:        []eventstore.Event{upcoming},
		followedSchoolEvents: []eventstore.Event{followed},
		interestedEvents:     []eventstore.Event{interested},
	}
	handler := authenticatedMyEventsHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/me/events?limit=4", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listUpcomingRSVPsCalled || !repository.listFollowedSchoolEventsCalled {
		t.Fatal("dashboard event queries were not called")
	}
	if repository.listUpcomingRSVPsUserID != testUserID ||
		repository.listFollowedSchoolEventsUserID != testUserID ||
		repository.listUpcomingRSVPsLimit != 4 ||
		repository.listFollowedSchoolEventsLimit != 4 {
		t.Fatalf("queries = upcoming user %q limit %d followed user %q limit %d",
			repository.listUpcomingRSVPsUserID,
			repository.listUpcomingRSVPsLimit,
			repository.listFollowedSchoolEventsUserID,
			repository.listFollowedSchoolEventsLimit)
	}
	var payload struct {
		UpcomingRSVPs        []eventstore.Event `json:"upcoming_rsvps"`
		FollowedSchoolEvents []eventstore.Event `json:"followed_school_events"`
		InterestedEvents     []eventstore.Event `json:"interested_events"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.UpcomingRSVPs) != 1 || payload.UpcomingRSVPs[0].ViewerRSVP == nil || *payload.UpcomingRSVPs[0].ViewerRSVP != eventstore.RSVPYes {
		t.Fatalf("upcoming_rsvps = %#v, want RSVP event", payload.UpcomingRSVPs)
	}
	if len(payload.FollowedSchoolEvents) != 1 || payload.FollowedSchoolEvents[0].Slug != "followed-campus-final" {
		t.Fatalf("followed_school_events = %#v, want followed school event", payload.FollowedSchoolEvents)
	}
	if len(payload.InterestedEvents) != 1 || payload.InterestedEvents[0].Slug != "interested-campus-cup" || !payload.InterestedEvents[0].ViewerInterested {
		t.Fatalf("interested_events = %#v, want the interested event", payload.InterestedEvents)
	}
}

func TestHandleCreateEventRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(validCreateEventJSON(eventstore.VisibilityPublic, "")))
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.createCalled {
		t.Fatal("Create was called for unauthenticated request")
	}
}

func TestHandleCreateEventCreatesPublicEvent(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, "")))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.createCalled {
		t.Fatal("Create was not called")
	}
	if repository.createParams.CreatorUserID != testUserID {
		t.Fatalf("CreatorUserID = %q, want session user", repository.createParams.CreatorUserID)
	}
	if repository.createParams.PrivatePasswordHash != "" {
		t.Fatalf("PrivatePasswordHash = %q, want empty for public event", repository.createParams.PrivatePasswordHash)
	}
	if len(repository.createParams.GameIDs) != 1 || repository.createParams.GameIDs[0] != "44444444-4444-4444-4444-444444444444" {
		t.Fatalf("GameIDs = %#v, want request game IDs", repository.createParams.GameIDs)
	}
	if repository.createParams.Capacity == nil || *repository.createParams.Capacity != 24 {
		t.Fatalf("Capacity = %v, want 24", repository.createParams.Capacity)
	}
	if repository.createParams.Cost != eventstore.CostPaid {
		t.Fatalf("Cost = %q, want %q", repository.createParams.Cost, eventstore.CostPaid)
	}
	if repository.createParams.PaymentNote != "Pay at the venue." {
		t.Fatalf("PaymentNote = %q, want request payment note", repository.createParams.PaymentNote)
	}
	if repository.createParams.PaymentURL != "https://payments.example.test/scrim-night" {
		t.Fatalf("PaymentURL = %q, want request payment URL", repository.createParams.PaymentURL)
	}
}

func TestHandleCreateEventHashesPrivatePassword(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPrivate, "PrivatePass8")))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if repository.createParams.PrivatePasswordHash == "" || repository.createParams.PrivatePasswordHash == "PrivatePass8" {
		t.Fatalf("PrivatePasswordHash = %q, want non-plaintext hash", repository.createParams.PrivatePasswordHash)
	}
	if !auth.ComparePassword(repository.createParams.PrivatePasswordHash, "PrivatePass8") {
		t.Fatal("PrivatePasswordHash does not verify against original password")
	}
}

func TestHandleCreateEventAcceptsSupportedRecurrenceRules(t *testing.T) {
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load recurrence timezone: %v", err)
	}
	wantUntil := time.Date(
		2026, time.October, 15, 23, 59, 59,
		int(time.Second-time.Nanosecond),
		location,
	)
	for _, rule := range []string{
		eventstore.RecurrenceWeekly,
		eventstore.RecurrenceBiweekly,
		eventstore.RecurrenceMonthly,
	} {
		t.Run(rule, func(t *testing.T) {
			repository := &fakeEventRepository{}
			handler := authenticatedEventsHandler(repository)
			request := withIdempotencyKey(authenticatedEventRequest(
				http.MethodPost,
				"/events",
				recurringCreateEventJSON(rule, "2026-10-15"),
			))
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusCreated {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
			}
			if repository.createParams.RecurrenceRule != rule {
				t.Fatalf("RecurrenceRule = %q, want %q", repository.createParams.RecurrenceRule, rule)
			}
			if !repository.createParams.RecurrenceUntil.Equal(wantUntil) {
				t.Fatalf("RecurrenceUntil = %v, want %v", repository.createParams.RecurrenceUntil, wantUntil)
			}
		})
	}
}

func TestHandleCreateEventEnforcesOneYearRecurrenceDateBoundary(t *testing.T) {
	t.Run("same calendar date next year", func(t *testing.T) {
		repository := &fakeEventRepository{}
		handler := authenticatedEventsHandler(repository)
		request := withIdempotencyKey(authenticatedEventRequest(
			http.MethodPost,
			"/events",
			recurringCreateEventJSON(eventstore.RecurrenceMonthly, "2027-08-15"),
		))
		response := httptest.NewRecorder()

		handler.ServeHTTP(response, request)

		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if !repository.createCalled {
			t.Fatal("Create was not called at the one-year boundary")
		}
	})

	t.Run("next calendar date", func(t *testing.T) {
		repository := &fakeEventRepository{}
		handler := authenticatedEventsHandler(repository)
		request := withIdempotencyKey(authenticatedEventRequest(
			http.MethodPost,
			"/events",
			recurringCreateEventJSON(eventstore.RecurrenceMonthly, "2027-08-16"),
		))
		response := httptest.NewRecorder()

		handler.ServeHTTP(response, request)

		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
		if repository.createCalled {
			t.Fatal("Create was called beyond the one-year boundary")
		}
	})
}

func TestHandleCreateEventRejectsInvalidInput(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPrivate, "short")))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if repository.createCalled {
		t.Fatal("Create was called for invalid input")
	}
}

func TestHandleCreateEventRequiresAudience(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	body := strings.Replace(validCreateEventJSON(eventstore.VisibilityPublic, ""), `"audience":"campus",`, "", 1)
	request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", body))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	requireErrorContract(t, response, http.StatusBadRequest, "invalid_request")
	if repository.createCalled {
		t.Fatal("Create was called without an audience")
	}
}

func TestHandleCreateEventRequiresEventType(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	body := strings.Replace(validCreateEventJSON(eventstore.VisibilityPublic, ""), `"event_type":"lan",`, "", 1)
	request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", body))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	requireErrorContract(t, response, http.StatusBadRequest, "invalid_request")
	if repository.createCalled {
		t.Fatal("Create was called without an event type")
	}
}

func TestHandleCreateEventMapsMissingSchoolAndGame(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{name: "missing school", err: eventstore.ErrHostSchoolNotFound, code: "host_school_not_found"},
		{name: "missing game", err: eventstore.ErrGameNotFound, code: "game_not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeEventRepository{err: tc.err}
			handler := authenticatedEventsHandler(repository)
			request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, "")))
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusUnprocessableEntity, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), tc.code) {
				t.Fatalf("body = %s, want %q", response.Body.String(), tc.code)
			}
		})
	}
}

func TestHandleEventPathReturnsPublicDetail(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Title != "Campus Scrim Night" {
		t.Fatalf("title = %q, want public detail", payload.Title)
	}
}

func TestHandleEventPathReturnsViewerRSVPForAuthenticatedDetail(t *testing.T) {
	repository := &fakeEventRepository{
		detail:     testEvent(eventstore.VisibilityPublic),
		viewerRSVP: eventstore.RSVPMaybe,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerRSVP == nil || *payload.ViewerRSVP != eventstore.RSVPMaybe {
		t.Fatalf("ViewerRSVP = %#v, want maybe", payload.ViewerRSVP)
	}
}

func TestHandleEventPathReturnsViewerInterestForAuthenticatedDetail(t *testing.T) {
	repository := &fakeEventRepository{
		detail:           testEvent(eventstore.VisibilityPublic),
		viewerInterested: true,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.ViewerInterested {
		t.Fatalf("ViewerInterested = false, want true")
	}
}

func TestHandleEventPathReturnsEditPermissionForOrganizer(t *testing.T) {
	repository := &fakeEventRepository{
		detail:      testEvent(eventstore.VisibilityPublic),
		isOrganizer: true,
		canCancel:   true,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.ViewerCanEdit || !payload.ViewerCanCancel {
		t.Fatalf("ViewerCanEdit, ViewerCanCancel = %v, %v, want both for an organizer who may cancel", payload.ViewerCanEdit, payload.ViewerCanCancel)
	}
}

func TestHandleUpdateEventRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPatch, "/events/campus-scrim-night", strings.NewReader(validCreateEventJSON(eventstore.VisibilityPublic, "")))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.updateCalled {
		t.Fatal("Update was called for unauthenticated request")
	}
}

func TestHandleUpdateEventUpdatesOrganizerEvent(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", validCreateEventJSON(eventstore.VisibilityPublic, ""))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.updateCalled {
		t.Fatal("Update was not called")
	}
	if repository.updateParams.Slug != "campus-scrim-night" || repository.updateParams.EditorUserID != testUserID {
		t.Fatalf("update params = %#v, want slug and session user", repository.updateParams)
	}
	if repository.updateParams.PrivatePasswordHash != "" {
		t.Fatalf("PrivatePasswordHash = %q, want empty for public update", repository.updateParams.PrivatePasswordHash)
	}
}

func TestHandleUpdateEventRejectsRecurrenceFields(t *testing.T) {
	for _, field := range []string{
		`"recurrence_rule":"weekly"`,
		`"recurrence_until":"2026-10-15"`,
		`"recurrence_rule":null`,
	} {
		t.Run(field, func(t *testing.T) {
			repository := &fakeEventRepository{}
			handler := authenticatedEventPathHandler(repository)
			body := strings.TrimSuffix(strings.TrimSpace(validCreateEventJSON(eventstore.VisibilityPublic, "")), "}")
			request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", body+","+field+"}")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "event_recurrence_immutable") {
				t.Fatalf("body = %s, want event_recurrence_immutable", response.Body.String())
			}
			if repository.updateCalled {
				t.Fatal("Update was called with immutable recurrence fields")
			}
		})
	}
}

func TestHandleUpdateEventHashesNewPrivatePassword(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", validCreateEventJSON(eventstore.VisibilityPrivate, "PrivatePass8"))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.updateParams.PrivatePasswordHash == "" || repository.updateParams.PrivatePasswordHash == "PrivatePass8" {
		t.Fatalf("PrivatePasswordHash = %q, want non-plaintext hash", repository.updateParams.PrivatePasswordHash)
	}
	if !auth.ComparePassword(repository.updateParams.PrivatePasswordHash, "PrivatePass8") {
		t.Fatal("PrivatePasswordHash does not verify against original password")
	}
}

func TestHandleUpdateEventMapsOrganizerError(t *testing.T) {
	repository := &fakeEventRepository{err: eventstore.ErrOrganizerRequired}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", validCreateEventJSON(eventstore.VisibilityPublic, ""))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "not_event_organizer") {
		t.Fatalf("body = %s, want not_event_organizer", response.Body.String())
	}
}

func TestHandleDeleteEventSoftDeletesOrganizerEvent(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodDelete, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusNoContent, response.Body.String())
	}
	if !repository.deleteCalled {
		t.Fatal("Delete was not called")
	}
	if repository.deleteSlug != "campus-scrim-night" || repository.deleteUserID != testUserID {
		t.Fatalf("delete = slug %q user %q, want slug and session user", repository.deleteSlug, repository.deleteUserID)
	}
}

func TestHandleDeleteEventMapsMissingEvent(t *testing.T) {
	repository := &fakeEventRepository{err: eventstore.ErrEventNotFound}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodDelete, "/events/missing-event", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusNotFound, response.Body.String())
	}
}

func TestHandleEventPathReturnsLockedShellForPrivateDetail(t *testing.T) {
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "Secret Scrim Night") {
		t.Fatalf("private response leaked title: %s", body)
	}
	var payload eventstore.LockedEvent
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Locked || payload.Visibility != eventstore.VisibilityPrivate {
		t.Fatalf("locked payload = %#v, want private locked shell", payload)
	}
}

func TestHandleUnlockEventRejectsWrongPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("PrivatePass8")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	repository := &fakeEventRepository{
		detail:      testEvent(eventstore.VisibilityPrivate),
		privateHash: passwordHash,
	}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/unlock", strings.NewReader(`{"password":"WrongPass8"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if repository.unlockCreated {
		t.Fatal("CreatePrivateUnlock was called for a wrong password")
	}
	if !strings.Contains(response.Body.String(), "invalid_private_password") {
		t.Fatalf("body = %s, want invalid_private_password", response.Body.String())
	}
}

func TestHandleRSVPEventRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", strings.NewReader(`{"response":"yes"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.setRSVPCalled {
		t.Fatal("SetRSVP was called for unauthenticated request")
	}
}

func TestHandleRSVPEventRejectsLockedPrivateEvent(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPrivate)}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if repository.setRSVPCalled {
		t.Fatal("SetRSVP was called for locked private event")
	}
	if !strings.Contains(response.Body.String(), "private_event_locked") {
		t.Fatalf("body = %s, want private_event_locked", response.Body.String())
	}
}

func TestHandleEventInterestRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/interest", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.setInterestCalled {
		t.Fatal("SetInterest was called for unauthenticated request")
	}
}

func TestHandleEventInterestSetsAndUnsetsViewerInterest(t *testing.T) {
	for _, tc := range []struct {
		name   string
		method string
		want   bool
	}{
		{name: "set", method: http.MethodPost, want: true},
		{name: "unset", method: http.MethodDelete, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
			handler := authenticatedEventPathHandler(repository)
			request := authenticatedEventRequest(tc.method, "/events/campus-scrim-night/interest", "")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
			}
			if !repository.setInterestCalled {
				t.Fatal("SetInterest was not called")
			}
			if repository.interestSlug != "campus-scrim-night" ||
				repository.interestUserID != testUserID ||
				repository.interestValue != tc.want {
				t.Fatalf("interest = slug %q user %q value %t, want slug, session user, %t",
					repository.interestSlug, repository.interestUserID, repository.interestValue, tc.want)
			}
			var payload eventstore.Event
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.ViewerInterested != tc.want {
				t.Fatalf("ViewerInterested = %t, want %t", payload.ViewerInterested, tc.want)
			}
		})
	}
}

func TestHandleEventInterestRejectsLockedPrivateEvent(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPrivate)}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/interest", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if repository.setInterestCalled {
		t.Fatal("SetInterest was called for locked private event")
	}
	if !strings.Contains(response.Body.String(), "private_event_locked") {
		t.Fatalf("body = %s, want private_event_locked", response.Body.String())
	}
}

func TestHandleEventPathReturnsNotFoundForMissingEvent(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/missing-event", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestEventResponsesShowTheOnlineLinkOnlyToPeopleGoingAndOrganizers(t *testing.T) {
	const link = "https://meet.example/campus-scrim"
	hybrid := testEvent(eventstore.VisibilityPublic)
	hybrid.OnlineURL = link

	cases := []struct {
		name        string
		signedIn    bool
		viewerRSVP  string
		isOrganizer bool
		want        string
	}{
		{name: "a visitor", want: ""},
		{name: "a signed-in viewer with no RSVP", signedIn: true, want: ""},
		{name: "a viewer who said maybe", signedIn: true, viewerRSVP: eventstore.RSVPMaybe, want: ""},
		{name: "a viewer who is going", signedIn: true, viewerRSVP: eventstore.RSVPYes, want: link},
		{name: "an organizer", signedIn: true, isOrganizer: true, want: link},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeEventRepository{detail: hybrid, viewerRSVP: tc.viewerRSVP, isOrganizer: tc.isOrganizer}
			response := httptest.NewRecorder()
			if tc.signedIn {
				authenticatedEventPathHandler(repository).ServeHTTP(response, authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", ""))
			} else {
				(&Router{events: repository}).handleEventPath(response, httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil))
			}
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
			}
			var payload eventstore.Event
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.OnlineURL != tc.want {
				t.Fatalf("online_url = %q, want %q", payload.OnlineURL, tc.want)
			}
		})
	}
}

func TestHandleEventsNeverListsTheOnlineLink(t *testing.T) {
	listed := testEvent(eventstore.VisibilityPublic)
	listed.OnlineURL = "https://meet.example/campus-scrim"
	repository := &fakeEventRepository{listed: []eventstore.Event{listed}}
	response := httptest.NewRecorder()

	(&Router{events: repository}).handleEvents(response, httptest.NewRequest(http.MethodGet, "/events", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Events []eventstore.Event `json:"events"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Events) != 1 || payload.Events[0].OnlineURL != "" {
		t.Fatalf("events = %+v, want one event without online_url", payload.Events)
	}
}

func TestHandleRSVPEventReturnsTheOnlineLinkOnlyToAGoingResponse(t *testing.T) {
	const link = "https://meet.example/campus-scrim"
	for _, tc := range []struct {
		response string
		want     string
	}{
		{response: eventstore.RSVPYes, want: link},
		{response: eventstore.RSVPMaybe, want: ""},
		{response: eventstore.RSVPNo, want: ""},
	} {
		t.Run(tc.response, func(t *testing.T) {
			hybrid := testEvent(eventstore.VisibilityPublic)
			hybrid.OnlineURL = link
			repository := &fakeEventRepository{detail: hybrid}
			response := httptest.NewRecorder()

			authenticatedEventPathHandler(repository).ServeHTTP(response, authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"`+tc.response+`"}`))

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
			}
			var payload eventstore.Event
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.OnlineURL != tc.want {
				t.Fatalf("online_url = %q, want %q", payload.OnlineURL, tc.want)
			}
		})
	}
}

func TestMalformedSlugsNameTheirRecordType(t *testing.T) {
	router := &Router{events: &fakeEventRepository{}}
	got := map[string]string{}
	for path, handle := range map[string]http.HandlerFunc{
		"/schools/%25zz/members": router.handleSchoolPath,
		"/events/%25zz":          router.handleEventPath,
	} {
		response := httptest.NewRecorder()
		handle(response, httptest.NewRequest(http.MethodGet, path, nil))
		got[path] = fmt.Sprintf("%d %s", response.Code, strings.TrimSpace(response.Body.String()))
	}
	want := map[string]string{
		"/schools/%25zz/members": `400 {"error":"invalid_school_slug"}`,
		"/events/%25zz":          `400 {"error":"invalid_event_slug"}`,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("responses = %v, want %v", got, want)
	}
}

func TestHandleMyEventsKeepsTheMeetingLinkForGoingViewersAndOrganizers(t *testing.T) {
	link := "https://meet.example/campus-scrim"
	maybe, yes := eventstore.RSVPMaybe, eventstore.RSVPYes
	event := func(slug string, rsvp *string, canEdit bool) eventstore.Event {
		event := testEvent(eventstore.VisibilityPublic)
		event.Slug, event.OnlineURL, event.ViewerRSVP, event.ViewerCanEdit = slug, link, rsvp, canEdit
		return event
	}
	repository := &fakeEventRepository{
		upcomingRSVPs:        []eventstore.Event{event("going", &yes, false), event("maybe", &maybe, false), event("organizer-maybe", &maybe, true)},
		followedSchoolEvents: []eventstore.Event{event("followed", nil, false)},
		interestedEvents:     []eventstore.Event{event("organizer-interested", nil, true)},
	}
	response := httptest.NewRecorder()

	authenticatedMyEventsHandler(repository).ServeHTTP(response, authenticatedEventRequest(http.MethodGet, "/me/events", ""))

	var payload map[string][]struct {
		Slug      string `json:"slug"`
		OnlineURL string `json:"online_url"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := map[string]string{}
	for _, list := range payload {
		for _, item := range list {
			got[item.Slug] = item.OnlineURL
		}
	}
	want := map[string]string{
		"going": link, "maybe": "", "organizer-maybe": link,
		"followed": "", "organizer-interested": link,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("online_url by event = %v, want %v", got, want)
	}
}

func TestHandleEventActivityFollowsTheEventPageRules(t *testing.T) {
	public := testEvent(eventstore.VisibilityPublic)
	private := testEvent(eventstore.VisibilityPrivate)
	private.Slug = "private-night"
	for _, test := range []struct {
		name       string
		detail     eventstore.Event
		organizer  bool
		signedIn   bool
		path       string
		wantStatus int
		wantCalls  []string
	}{
		{"a visitor reads the public view", public, false, false, "/events/campus-scrim-night/activity", http.StatusOK,
			[]string{public.ID + ":false:20"}},
		{"an editor reads every entry", public, true, true, "/events/campus-scrim-night/activity?limit=5", http.StatusOK,
			[]string{public.ID + ":true:5"}},
		{"a missing event", public, false, false, "/events/gone/activity", http.StatusNotFound, nil},
		{"a locked private event", private, false, true, "/events/private-night/activity", http.StatusNotFound, nil},
		{"an organizer of a private event", private, true, true, "/events/private-night/activity", http.StatusOK,
			[]string{private.ID + ":true:20"}},
		{"a limit out of range", public, false, false, "/events/campus-scrim-night/activity?limit=51", http.StatusBadRequest, nil},
		{"a malformed cursor", public, false, false, "/events/campus-scrim-night/activity?after=nope", http.StatusBadRequest, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &fakeEventRepository{detail: test.detail, isOrganizer: test.organizer}
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.signedIn {
				request = authenticatedEventRequest(http.MethodGet, test.path, "")
			}
			response := httptest.NewRecorder()
			authenticatedEventPathHandler(repository).ServeHTTP(response, request)
			if response.Code != test.wantStatus || !reflect.DeepEqual(repository.activityCalls, test.wantCalls) {
				t.Fatalf("status %d, calls %v; want %d, %v (%s)", response.Code, repository.activityCalls,
					test.wantStatus, test.wantCalls, response.Body.String())
			}
			if response.Code == http.StatusOK && response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("Cache-Control = %q, want private, no-store", response.Header().Get("Cache-Control"))
			}
		})
	}
}
