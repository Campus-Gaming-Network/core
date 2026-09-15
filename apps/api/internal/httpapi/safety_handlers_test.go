package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
)

func TestHandleSupportTicketsAllowsAnonymousSubmission(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{safety: repository}
	request := httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(`{
		"contact_email":"player@example.com",
		"name":"Player One",
		"subject":"Need help",
		"message":"I need help with my account."
	}`))
	response := httptest.NewRecorder()

	router.handleSupportTickets(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.supportCalled {
		t.Fatal("CreateSupportTicket was not called")
	}
	if repository.supportInput.SubmitterUserID != "" {
		t.Fatalf("SubmitterUserID = %q, want empty for anonymous support", repository.supportInput.SubmitterUserID)
	}
	if repository.supportInput.ContactEmail != "player@example.com" ||
		repository.supportInput.Subject != "Need help" {
		t.Fatalf("support input = %#v, want request fields", repository.supportInput)
	}
}

func TestHandleSupportTicketsMapsValidationError(t *testing.T) {
	repository := &fakeSafetyRepository{err: apperror.Validation("subject is required")}
	router := &Router{safety: repository}
	request := httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(`{
		"contact_email":"player@example.com",
		"message":"I need help."
	}`))
	response := httptest.NewRecorder()

	router.handleSupportTickets(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "invalid_request") {
		t.Fatalf("body = %s, want invalid_request", response.Body.String())
	}
}

func TestHandleSupportTicketsRateLimitsSubmissions(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{
		cfg: config.Config{
			AuthRateLimit:  1,
			AuthRateWindow: time.Minute,
		},
		limiter: ratelimit.New(1, time.Minute),
		safety:  repository,
	}
	body := `{"contact_email":"player@example.com","subject":"Need help","message":"Please help."}`
	first := httptest.NewRecorder()
	router.handleSupportTickets(first, httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(body)))
	second := httptest.NewRecorder()
	router.handleSupportTickets(second, httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(body)))

	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d", first.Code, http.StatusCreated)
	}
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d; body = %s", second.Code, http.StatusTooManyRequests, second.Body.String())
	}
}

func TestHandleReportEventRequiresAuthentication(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{
		events: &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)},
		safety: repository,
	}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/report", strings.NewReader(`{"reason":"Spam listing"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.reportEventCalled {
		t.Fatal("ReportEvent was called for unauthenticated request")
	}
}

func TestHandleReportEventCreatesReport(t *testing.T) {
	repository := &fakeSafetyRepository{}
	handler := authenticatedEventReportHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/report", `{"reason":"Spam listing"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.reportEventCalled {
		t.Fatal("ReportEvent was not called")
	}
	if repository.reportEventUserID != testUserID ||
		repository.reportEventSlug != "campus-scrim-night" ||
		repository.reportEventReason != "Spam listing" {
		t.Fatalf("ReportEvent call = user %q slug %q reason %q",
			repository.reportEventUserID,
			repository.reportEventSlug,
			repository.reportEventReason)
	}
}

func TestHandleReportEventRateLimitsSubmissions(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{
		cfg: config.Config{
			SessionCookie:  "session",
			SessionTTL:     time.Hour,
			AuthRateLimit:  1,
			AuthRateWindow: time.Minute,
		},
		events:  &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)},
		limiter: ratelimit.New(1, time.Minute),
		safety:  repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}
	handler := auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEventPath))
	body := `{"reason":"Spam listing"}`
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/report", body))
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/report", body))

	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d; body = %s", first.Code, http.StatusCreated, first.Body.String())
	}
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d; body = %s", second.Code, http.StatusTooManyRequests, second.Body.String())
	}
}

func TestHandleReportUserCreatesReport(t *testing.T) {
	repository := &fakeSafetyRepository{}
	handler := authenticatedUserReportHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/users/22222222-2222-2222-2222-222222222222/report", `{"reason":"Harassment"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.reportUserCalled {
		t.Fatal("ReportUser was not called")
	}
	if repository.reportUserReporter != testUserID ||
		repository.reportUserTarget != "22222222-2222-2222-2222-222222222222" ||
		repository.reportUserReason != "Harassment" {
		t.Fatalf("ReportUser call = reporter %q target %q reason %q",
			repository.reportUserReporter,
			repository.reportUserTarget,
			repository.reportUserReason)
	}
}

func TestHandleReportUserMapsSelfReport(t *testing.T) {
	repository := &fakeSafetyRepository{err: safety.ErrCannotReportSelf}
	handler := authenticatedUserReportHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/users/22222222-2222-2222-2222-222222222222/report", `{"reason":"Oops"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "cannot_report_self") {
		t.Fatalf("body = %s, want cannot_report_self", response.Body.String())
	}
}
