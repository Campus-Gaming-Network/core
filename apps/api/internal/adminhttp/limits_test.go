package adminhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminidentity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
)

type limitedResponse struct {
	Status     int
	RetryAfter string
	Body       string
}

func responseSummary(response *httptest.ResponseRecorder) limitedResponse {
	return limitedResponse{
		Status: response.Code, RetryAfter: response.Header().Get("Retry-After"),
		Body: response.Body.String(),
	}
}

type deniedEvent struct {
	Type       adminsecurity.EventType
	Outcome    adminsecurity.Outcome
	ReasonCode string
	HTTPStatus int
}

func deniedEvents(events []adminsecurity.WriteInput) []deniedEvent {
	summaries := make([]deniedEvent, 0, len(events))
	for _, event := range events {
		summary := deniedEvent{Type: event.Type, Outcome: event.Outcome, ReasonCode: event.Metadata.ReasonCode}
		if event.Metadata.HTTPStatus != nil {
			summary.HTTPStatus = *event.Metadata.HTTPStatus
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

func TestAdminReadsAreLimitedPerVerifiedAdmin(t *testing.T) {
	handler, fixture := testHandler(true)
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	read := func(token string) *httptest.ResponseRecorder {
		req := trustedRequest(http.MethodGet, "/admin/v1/session")
		req.AddCookie(&http.Cookie{Name: "admin_session", Value: token})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}

	for attempt := range adminReadLimit {
		if response := read("current"); response.Code != http.StatusOK {
			t.Fatalf("read %d status = %d body = %s", attempt+1, response.Code, response.Body.String())
		}
	}
	now = now.Add(15 * time.Second)
	limited := read("current")
	want := limitedResponse{Status: http.StatusTooManyRequests, RetryAfter: "45", Body: "{\"error\":\"rate_limited\"}\n"}
	if got := responseSummary(limited); got != want {
		t.Fatalf("over-limit read = %#v, want %#v", got, want)
	}
	assertPrivateHeaders(t, limited.Header())
	wantEvents := []deniedEvent{{
		Type: adminsecurity.EventAuthorizationDenied, Outcome: adminsecurity.OutcomeDenied,
		ReasonCode: "rate_limited", HTTPStatus: http.StatusTooManyRequests,
	}}
	if got := deniedEvents(fixture.security.events); len(got) != 1 || got[0] != wantEvents[0] {
		t.Fatalf("security events = %#v, want %#v", got, wantEvents)
	}

	// A second operator keeps an independent budget.
	activeGrant := fixture.grants.grant
	fixture.sessions.principals["other"] = testPrincipal("other-user", "other-grant", "other-csrf")
	fixture.grants.grant = adminaccess.Grant{ID: "other-grant", UserID: "other-user", Role: adminaccess.RoleSiteAdmin}
	if response := read("other"); response.Code != http.StatusOK {
		t.Fatalf("other operator status = %d", response.Code)
	}

	fixture.grants.grant = activeGrant
	now = now.Add(45*time.Second - time.Nanosecond)
	if response := read("current"); response.Code != http.StatusTooManyRequests {
		t.Fatalf("read before reset status = %d", response.Code)
	}
	now = now.Add(time.Nanosecond)
	if response := read("current"); response.Code != http.StatusOK {
		t.Fatalf("read at reset status = %d", response.Code)
	}
}

func TestRejectedWritesConsumeWriteAndCriticalBudgetsBeforeHandlers(t *testing.T) {
	handler, fixture := testHandler(true)
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	principal := testPrincipal("user-id", "grant-id", "current-csrf")
	principal.StepUpAt = timePointer(now.Add(-time.Minute))
	fixture.sessions.principals["current"] = principal
	// A wrong CSRF value proves rejected attempts are still counted.
	write := func(method, path string) *httptest.ResponseRecorder {
		req := trustedRequest(method, path)
		req.Header.Set("Origin", "https://admin.example.test")
		req.Header.Set(CSRFHeader, "wrong-csrf")
		req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
		req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "wrong-csrf"})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}

	for attempt := range adminCriticalLimit {
		if response := write(http.MethodPost, "/admin/v1/site-admin-grants"); response.Code != http.StatusForbidden {
			t.Fatalf("critical write %d status = %d", attempt+1, response.Code)
		}
	}
	critical := limitedResponse{Status: http.StatusTooManyRequests, RetryAfter: "900", Body: "{\"error\":\"rate_limited\"}\n"}
	if got := responseSummary(write(http.MethodPost, "/admin/v1/site-admin-grants")); got != critical {
		t.Fatalf("over-limit critical write = %#v, want %#v", got, critical)
	}

	// The eleven critical attempts also spent the shared write budget.
	for attempt := range adminWriteLimit - adminCriticalLimit - 1 {
		if response := write(http.MethodPatch, "/admin/v1/reports/report-id"); response.Code != http.StatusForbidden {
			t.Fatalf("write %d status = %d", attempt+1, response.Code)
		}
	}
	ordinary := limitedResponse{Status: http.StatusTooManyRequests, RetryAfter: "60", Body: "{\"error\":\"rate_limited\"}\n"}
	if got := responseSummary(write(http.MethodPatch, "/admin/v1/reports/report-id")); got != ordinary {
		t.Fatalf("over-limit write = %#v, want %#v", got, ordinary)
	}
	if fixture.operations.lastReportID != "" {
		t.Fatalf("rejected writes reached the operation handler for %q", fixture.operations.lastReportID)
	}
}

func TestCriticalWritesCoverRecentAuthAndGrantChanges(t *testing.T) {
	var critical []string
	for _, policy := range routes {
		if criticalWrite(policy) {
			critical = append(critical, policy.Method+" "+policy.Path)
		}
	}
	want := []string{
		"POST /admin/v1/schools/{id}/admin-grants",
		"POST /admin/v1/schools/{id}/admin-grants/{grant_id}/revoke",
		"POST /admin/v1/users/{id}/suspend",
		"POST /admin/v1/users/{id}/reactivate",
		"PATCH /admin/v1/users/{id}/trust-grants",
		"POST /admin/v1/site-admin-grants",
		"POST /admin/v1/site-admin-grants/{id}/revoke",
	}
	if len(critical) != len(want) {
		t.Fatalf("critical writes = %#v, want %#v", critical, want)
	}
	for index := range want {
		if critical[index] != want[index] {
			t.Fatalf("critical writes = %#v, want %#v", critical, want)
		}
	}
}

func TestExchangeFailuresLockOnlyTheFailingAccessIdentity(t *testing.T) {
	handler, fixture := testHandler(true)
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	exchange := func() *httptest.ResponseRecorder {
		req := trustedRequest(http.MethodPost, "/admin/v1/auth/exchange")
		req.Header.Set("Origin", "https://admin.example.test")
		req.Header.Set(AccessAssertionHeader, "signed-access-assertion")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}

	fixture.grants.err = adminaccess.ErrGrantNotFound
	for attempt := range accessFailureLimit {
		if response := exchange(); response.Code != http.StatusForbidden {
			t.Fatalf("exchange %d status = %d", attempt+1, response.Code)
		}
	}

	// Gaining a grant does not lift the lockout early.
	fixture.grants.err = nil
	fixture.security.events = nil
	now = now.Add(5 * time.Minute)
	want := limitedResponse{Status: http.StatusTooManyRequests, RetryAfter: "600", Body: "{\"error\":\"rate_limited\"}\n"}
	if got := responseSummary(exchange()); got != want {
		t.Fatalf("locked exchange = %#v, want %#v", got, want)
	}
	if fixture.sessions.started.UserID != "" {
		t.Fatalf("locked exchange started a session: %#v", fixture.sessions.started)
	}
	wantEvent := deniedEvent{
		Type: adminsecurity.EventExchangeDenied, Outcome: adminsecurity.OutcomeDenied,
		ReasonCode: "rate_limited", HTTPStatus: http.StatusTooManyRequests,
	}
	if got := deniedEvents(fixture.security.events); len(got) != 1 || got[0] != wantEvent {
		t.Fatalf("security events = %#v, want %#v", got, wantEvent)
	}

	fixture.identities.identity.Subject = "other-access-subject"
	if response := exchange(); response.Code != http.StatusCreated {
		t.Fatalf("other identity exchange status = %d", response.Code)
	}

	fixture.identities.identity.Subject = "access-subject"
	now = now.Add(10 * time.Minute)
	if response := exchange(); response.Code != http.StatusCreated {
		t.Fatalf("exchange after the window status = %d body = %s", response.Code, response.Body.String())
	}
}

func TestStepUpFailuresLockBeforeAssertionValidation(t *testing.T) {
	handler, fixture := testHandler(true)
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	principal := testPrincipal("user-id", "grant-id", "current-csrf")
	principal.AuthenticatedAt = now.Add(-5 * time.Minute)
	fixture.sessions.principals["current"] = principal
	stepUp := func() *httptest.ResponseRecorder {
		req := trustedRequest(http.MethodPost, "/admin/v1/auth/step-up")
		req.Header.Set("Origin", "https://admin.example.test")
		req.Header.Set(CSRFHeader, "current-csrf")
		req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
		req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}

	fixture.identities.err = adminidentity.ErrInvalidAssertion
	for attempt := range accessFailureLimit - 1 {
		if response := stepUp(); response.Code != http.StatusUnauthorized {
			t.Fatalf("step-up %d status = %d", attempt+1, response.Code)
		}
	}
	fixture.identities.err = nil
	fixture.identities.identity.Authenticated = now.Add(-11 * time.Minute)
	if response := stepUp(); response.Code != http.StatusForbidden {
		t.Fatalf("stale step-up status = %d", response.Code)
	}

	fixture.identities.identity.Authenticated = now.Add(-time.Minute)
	want := limitedResponse{Status: http.StatusTooManyRequests, RetryAfter: "900", Body: "{\"error\":\"rate_limited\"}\n"}
	if got := responseSummary(stepUp()); got != want {
		t.Fatalf("locked step-up = %#v, want %#v", got, want)
	}
	if fixture.sessions.rotatedToken != "" {
		t.Fatalf("locked step-up rotated %q", fixture.sessions.rotatedToken)
	}

	now = now.Add(accessFailureWindow)
	principal.AuthenticatedAt = now.Add(-5 * time.Minute)
	fixture.sessions.principals["current"] = principal
	fixture.identities.identity.Authenticated = now.Add(-time.Minute)
	if response := stepUp(); response.Code != http.StatusOK {
		t.Fatalf("step-up after the window status = %d body = %s", response.Code, response.Body.String())
	}
}
