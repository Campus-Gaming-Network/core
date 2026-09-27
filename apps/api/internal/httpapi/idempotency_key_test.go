package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
)

type idempotentCreateCase struct {
	name     string
	handler  http.Handler
	target   string
	body     string
	received func() string
}

func idempotentCreateCases() []idempotentCreateCase {
	events := &fakeEventRepository{}
	teams := &fakeTeamRepository{}
	eventReports := &fakeSafetyRepository{}
	userReports := &fakeSafetyRepository{}
	tickets := &fakeSafetyRepository{}
	return []idempotentCreateCase{
		{
			name:     "event",
			handler:  authenticatedEventsHandler(events),
			target:   "/events",
			body:     validCreateEventJSON(eventstore.VisibilityPublic, ""),
			received: func() string { return events.createParams.IdempotencyKey },
		},
		{
			name:     "team",
			handler:  authenticatedTeamsHandler(teams),
			target:   "/teams",
			body:     validCreateTeamJSON(),
			received: func() string { return teams.createParams.IdempotencyKey },
		},
		{
			name:     "event report",
			handler:  authenticatedEventReportHandler(eventReports),
			target:   "/events/campus-scrim-night/report",
			body:     `{"reason":"Spam listing"}`,
			received: func() string { return eventReports.reportEventKey },
		},
		{
			name:     "user report",
			handler:  authenticatedUserReportHandler(userReports),
			target:   "/users/22222222-2222-2222-2222-222222222222/report",
			body:     `{"reason":"Harassment"}`,
			received: func() string { return userReports.reportUserKey },
		},
		{
			name:     "support ticket",
			handler:  http.HandlerFunc((&Router{safety: tickets}).handleSupportTickets),
			target:   "/support-tickets",
			body:     `{"contact_email":"player@example.com","subject":"Need help","message":"Please help."}`,
			received: func() string { return tickets.supportInput.IdempotencyKey },
		},
	}
}

func TestCreateHandlersForwardIdempotencyKey(t *testing.T) {
	for _, testCase := range idempotentCreateCases() {
		t.Run(testCase.name, func(t *testing.T) {
			request := withIdempotencyKey(authenticatedEventRequest(http.MethodPost, testCase.target, testCase.body))
			response := httptest.NewRecorder()

			testCase.handler.ServeHTTP(response, request)

			if response.Code != http.StatusCreated {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
			}
			if got := testCase.received(); got != testIdempotencyKey {
				t.Fatalf("repository idempotency key = %q, want %q", got, testIdempotencyKey)
			}
		})
	}
}

func TestCreateHandlersRequireIdempotencyKey(t *testing.T) {
	for _, header := range []string{"", "retry-1"} {
		for _, testCase := range idempotentCreateCases() {
			t.Run(testCase.name+" with key "+strconv.Quote(header), func(t *testing.T) {
				request := authenticatedEventRequest(http.MethodPost, testCase.target, testCase.body)
				request.Header.Set("Idempotency-Key", header)
				response := httptest.NewRecorder()

				testCase.handler.ServeHTTP(response, request)

				if response.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
				}
				if body := strings.TrimSpace(response.Body.String()); body != `{"error":"invalid_idempotency_key"}` {
					t.Fatalf("body = %s, want invalid_idempotency_key", body)
				}
				if got := testCase.received(); got != "" {
					t.Fatalf("repository received key %q for a rejected request", got)
				}
			})
		}
	}
}
