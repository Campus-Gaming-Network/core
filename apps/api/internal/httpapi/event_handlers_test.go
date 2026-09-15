package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	request := httptest.NewRequest(http.MethodGet, "/events?game=rocket-league&school=example-university&format=online&limit=5", nil)
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
	repository := &fakeEventRepository{
		upcomingRSVPs:        []eventstore.Event{upcoming},
		followedSchoolEvents: []eventstore.Event{followed},
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
	request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, ""))
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
	if !repository.createParams.IsPaid {
		t.Fatal("IsPaid = false, want true")
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
	request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPrivate, "PrivatePass8"))
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
			request := authenticatedEventRequest(
				http.MethodPost,
				"/events",
				recurringCreateEventJSON(rule, "2026-10-15"),
			)
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
		request := authenticatedEventRequest(
			http.MethodPost,
			"/events",
			recurringCreateEventJSON(eventstore.RecurrenceMonthly, "2027-08-15"),
		)
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
		request := authenticatedEventRequest(
			http.MethodPost,
			"/events",
			recurringCreateEventJSON(eventstore.RecurrenceMonthly, "2027-08-16"),
		)
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
	request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPrivate, "short"))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if repository.createCalled {
		t.Fatal("Create was called for invalid input")
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
			request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, ""))
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
	if !payload.ViewerCanEdit {
		t.Fatal("ViewerCanEdit = false, want true for organizer")
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

func TestHandleEventPathReturnsPrivateDetailToOrganizer(t *testing.T) {
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event, isOrganizer: true}
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
	if payload.Title != "Secret Scrim Night" {
		t.Fatalf("title = %q, want private organizer detail", payload.Title)
	}
}

func TestHandleEventPathReturnsPrivateDetailWithUnlockToken(t *testing.T) {
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event, unlockValid: true}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil)
	request.Header.Set("X-CGN-Event-Unlock", "raw-unlock-token")
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.unlockChecked {
		t.Fatal("IsPrivateUnlockValid was not called")
	}
	if repository.unlockSlug != "campus-scrim-night" || len(repository.unlockTokenHash) == 0 {
		t.Fatalf("unlock check = slug %q hash %x, want slug and token hash", repository.unlockSlug, repository.unlockTokenHash)
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Title != "Secret Scrim Night" {
		t.Fatalf("title = %q, want unlocked private detail", payload.Title)
	}
}

func TestHandleUnlockEventCreatesTokenForCorrectPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("PrivatePass8")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event, privateHash: passwordHash}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/unlock", strings.NewReader(`{"password":"PrivatePass8"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.unlockCreated {
		t.Fatal("CreatePrivateUnlock was not called")
	}
	if repository.unlockSlug != "campus-scrim-night" || len(repository.unlockTokenHash) == 0 {
		t.Fatalf("unlock = slug %q hash %x, want slug and token hash", repository.unlockSlug, repository.unlockTokenHash)
	}
	if !repository.unlockExpiresAt.After(time.Now()) {
		t.Fatalf("unlockExpiresAt = %s, want future expiration", repository.unlockExpiresAt)
	}
	var payload struct {
		Event       eventstore.Event `json:"event"`
		UnlockToken string           `json:"unlock_token"`
		ExpiresAt   time.Time        `json:"expires_at"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Event.Title != "Secret Scrim Night" || payload.UnlockToken == "" || payload.ExpiresAt.IsZero() {
		t.Fatalf("payload = %#v, want event, token, and expiration", payload)
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

func TestHandleRSVPEventSetsViewerResponse(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.setRSVPCalled {
		t.Fatal("SetRSVP was not called")
	}
	if repository.rsvpInput.Slug != "campus-scrim-night" ||
		repository.rsvpInput.UserID != testUserID ||
		repository.rsvpInput.Response != eventstore.RSVPYes {
		t.Fatalf("RSVP input = %#v, want slug, session user, yes", repository.rsvpInput)
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerRSVP == nil || *payload.ViewerRSVP != eventstore.RSVPYes {
		t.Fatalf("ViewerRSVP = %#v, want yes", payload.ViewerRSVP)
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

func TestHandleRSVPEventMapsFullEvent(t *testing.T) {
	repository := &fakeEventRepository{
		detail:  testEvent(eventstore.VisibilityPublic),
		rsvpErr: eventstore.ErrEventFull,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusConflict, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "event_full") {
		t.Fatalf("body = %s, want event_full", response.Body.String())
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
