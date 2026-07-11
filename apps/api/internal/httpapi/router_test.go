package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/jackc/pgx/v5"
)

const testUserID = "11111111-1111-1111-1111-111111111111"

type fakeSessionStore struct {
	session auth.Session
	err     error
}

func (s fakeSessionStore) FindSession(_ context.Context, _ []byte) (auth.Session, error) {
	return s.session, s.err
}

type fakeFollowRepository struct {
	listFollowedCalled bool
	followed           []schools.School
	err                error
}

type fakeEventRepository struct {
	listPublicCalled bool
	listParams       eventstore.ListParams
	listed           []eventstore.Event
	detail           eventstore.Event
	createCalled     bool
	createParams     eventstore.CreateParams
	created          eventstore.Event
	updateCalled     bool
	updateParams     eventstore.UpdateParams
	updated          eventstore.Event
	deleteCalled     bool
	deleteSlug       string
	deleteUserID     string
	err              error
}

func (r *fakeEventRepository) Create(_ context.Context, params eventstore.CreateParams) (eventstore.Event, error) {
	r.createCalled = true
	r.createParams = params
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.created.ID != "" {
		return r.created, nil
	}
	event := testEvent(params.Visibility)
	event.Title = params.Title
	event.Description = params.Description
	return event, nil
}

func (r *fakeEventRepository) Update(_ context.Context, params eventstore.UpdateParams) (eventstore.Event, error) {
	r.updateCalled = true
	r.updateParams = params
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.updated.ID != "" {
		return r.updated, nil
	}
	event := testEvent(params.Visibility)
	event.Slug = params.Slug
	event.Title = params.Title
	event.Description = params.Description
	return event, nil
}

func (r *fakeEventRepository) Delete(_ context.Context, slug string, userID string) error {
	r.deleteCalled = true
	r.deleteSlug = slug
	r.deleteUserID = userID
	return r.err
}

func (r *fakeEventRepository) ListPublic(_ context.Context, params eventstore.ListParams) ([]eventstore.Event, error) {
	r.listPublicCalled = true
	r.listParams = params
	return r.listed, r.err
}

func (r *fakeEventRepository) GetBySlug(_ context.Context, slug string) (eventstore.Event, error) {
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.detail.Slug != slug {
		return eventstore.Event{}, pgx.ErrNoRows
	}
	return r.detail, nil
}

func (r *fakeFollowRepository) Follow(_ context.Context, _ string, _ string) error {
	return nil
}

func (r *fakeFollowRepository) Unfollow(_ context.Context, _ string, _ string) error {
	return nil
}

func (r *fakeFollowRepository) IsFollowing(_ context.Context, _ string, _ string) (bool, error) {
	return false, nil
}

func (r *fakeFollowRepository) ListFollowed(_ context.Context, userID string) ([]schools.School, error) {
	r.listFollowedCalled = true
	if userID != testUserID {
		return nil, schools.ErrSchoolNotFound
	}
	return r.followed, r.err
}

func TestHandleMySchoolsRequiresAuthentication(t *testing.T) {
	repository := &fakeFollowRepository{}
	handler := authenticatedMySchoolsHandler(repository)
	request := httptest.NewRequest(http.MethodGet, "/me/schools", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.listFollowedCalled {
		t.Fatal("ListFollowed was called for an unauthenticated request")
	}
}

func TestHandleMySchoolsReturnsFollowedSchools(t *testing.T) {
	repository := &fakeFollowRepository{followed: []schools.School{
		{
			ID:           "22222222-2222-2222-2222-222222222222",
			Name:         "Example University",
			Slug:         "example-university",
			City:         "Irvine",
			State:        "CA",
			IsMainCampus: true,
		},
	}}
	handler := authenticatedMySchoolsHandler(repository)
	rawToken, _, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/me/schools", nil)
	request.AddCookie(&http.Cookie{Name: "session", Value: rawToken})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Schools []schools.School `json:"schools"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Schools) != 1 || payload.Schools[0].Slug != "example-university" {
		t.Fatalf("schools = %#v, want followed school payload", payload.Schools)
	}
}

func TestHandleEventsReturnsPublicEventsWithFilters(t *testing.T) {
	repository := &fakeEventRepository{listed: []eventstore.Event{
		testEvent(eventstore.VisibilityPublic),
	}}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events?game=rocket-league&school=example-university&limit=5&offset=10", nil)
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
	if repository.listParams.Limit != 5 || repository.listParams.Offset != 10 {
		t.Fatalf("list params = %#v, want pagination filters", repository.listParams)
	}
	var payload struct {
		Events []eventstore.Event `json:"events"`
		Limit  int                `json:"limit"`
		Offset int                `json:"offset"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Events) != 1 || payload.Events[0].Slug != "campus-scrim-night" {
		t.Fatalf("events = %#v, want public event payload", payload.Events)
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

func authenticatedMySchoolsHandler(repository *fakeFollowRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		follows: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleMySchools))
}

func authenticatedEventsHandler(repository *fakeEventRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie:  "session",
			SessionTTL:     time.Hour,
			AuthRateLimit:  5,
			AuthRateWindow: time.Minute,
		},
		events: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEvents))
}

func authenticatedEventPathHandler(repository *fakeEventRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		events: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEventPath))
}

func authenticatedEventRequest(method string, target string, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: "session", Value: "raw-token"})
	return request
}

func validCreateEventJSON(visibility string, privatePassword string) string {
	passwordField := ""
	if privatePassword != "" {
		passwordField = `,"private_password":"` + privatePassword + `"`
	}
	return `{
		"title":"Campus Scrim Night",
		"description":"Weekly games on campus.",
		"host_school_id":"33333333-3333-3333-3333-333333333333",
		"game_ids":["44444444-4444-4444-4444-444444444444"],
		"visibility":"` + visibility + `",
		"format":"in_person",
		"starts_at":"2026-08-15T20:00:00Z",
		"ends_at":"2026-08-15T22:00:00Z",
		"timezone":"America/Los_Angeles",
		"location_name":"Student Union",
		"address":"1 Campus Way",
		"capacity":24,
		"is_paid":true,
		"payment_note":"Pay at the venue.",
		"payment_url":"https://payments.example.test/scrim-night"` + passwordField + `
	}`
}

func testEvent(visibility string) eventstore.Event {
	return eventstore.Event{
		ID:          "22222222-2222-2222-2222-222222222222",
		Title:       "Campus Scrim Night",
		Slug:        "campus-scrim-night",
		Description: "Weekly games on campus.",
		Visibility:  visibility,
		Format:      eventstore.FormatInPerson,
		StartsAt:    time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:      time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		Timezone:    "America/Los_Angeles",
		Lifecycle:   eventstore.LifecycleUpcoming,
		HostSchool: eventstore.SchoolSummary{
			ID:    "33333333-3333-3333-3333-333333333333",
			Name:  "Example University",
			Slug:  "example-university",
			City:  "Irvine",
			State: "CA",
		},
		Games: []eventstore.GameSummary{
			{
				ID:   "44444444-4444-4444-4444-444444444444",
				Name: "Rocket League",
				Slug: "rocket-league",
			},
		},
	}
}
