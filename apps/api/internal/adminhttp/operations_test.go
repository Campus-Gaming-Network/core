package adminhttp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/operations"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

const (
	testReportID = "00000000-0000-4000-8000-000000000101"
	testTicketID = "00000000-0000-4000-8000-000000000102"
)

type fakeOperationsRepository struct {
	reports             []operations.Report
	report              operations.Report
	tickets             []operations.SupportTicket
	ticket              operations.SupportTicket
	audit               []operations.AuditEntry
	listReportFilter    operations.QueueFilter
	listSupportFilter   operations.QueueFilter
	lastReportID        string
	lastTicketID        string
	lastReportPatch     operations.QueuePatch
	lastSupportPatch    operations.QueuePatch
	lastAuditEntityType string
	lastAuditEntityID   string
	lastAuditFilter     operations.AuditFilter
	listReportCalls     int
	getReportCalls      int
	patchReportCalls    int
	listSupportCalls    int
	getSupportCalls     int
	patchSupportCalls   int
	listAuditCalls      int
	err                 error
}

func (repository *fakeOperationsRepository) ListReports(_ context.Context, filter operations.QueueFilter) ([]operations.Report, error) {
	repository.listReportCalls++
	repository.listReportFilter = filter
	return repository.reports, repository.err
}

func (repository *fakeOperationsRepository) GetReport(_ context.Context, id string) (operations.Report, error) {
	repository.getReportCalls++
	repository.lastReportID = id
	return repository.report, repository.err
}

func (repository *fakeOperationsRepository) PatchReport(_ context.Context, id string, patch operations.QueuePatch) (operations.Report, error) {
	repository.patchReportCalls++
	repository.lastReportID = id
	repository.lastReportPatch = patch
	return repository.report, repository.err
}

func (repository *fakeOperationsRepository) ListSupportTickets(_ context.Context, filter operations.QueueFilter) ([]operations.SupportTicket, error) {
	repository.listSupportCalls++
	repository.listSupportFilter = filter
	return repository.tickets, repository.err
}

func (repository *fakeOperationsRepository) GetSupportTicket(_ context.Context, id string) (operations.SupportTicket, error) {
	repository.getSupportCalls++
	repository.lastTicketID = id
	return repository.ticket, repository.err
}

func (repository *fakeOperationsRepository) PatchSupportTicket(_ context.Context, id string, patch operations.QueuePatch) (operations.SupportTicket, error) {
	repository.patchSupportCalls++
	repository.lastTicketID = id
	repository.lastSupportPatch = patch
	return repository.ticket, repository.err
}

func (repository *fakeOperationsRepository) ListAuditHistory(
	_ context.Context,
	entityType string,
	entityID string,
	filter operations.AuditFilter,
) ([]operations.AuditEntry, error) {
	repository.listAuditCalls++
	repository.lastAuditEntityType = entityType
	repository.lastAuditEntityID = entityID
	repository.lastAuditFilter = filter
	return repository.audit, repository.err
}

func TestOperationsListsAreFilteredPaginatedJSONData(t *testing.T) {
	handler, fixture := testHandler(true)
	createdAt := time.Date(2026, time.September, 18, 9, 0, 0, 0, time.UTC)
	reports := []operations.Report{
		{ID: testReportID, Reason: `<img src=x onerror="alert(1)">`, Status: operations.QueueStatusOpen, CreatedAt: createdAt},
		{ID: "00000000-0000-4000-8000-000000000103", Reason: "second", Status: operations.QueueStatusOpen, CreatedAt: createdAt.Add(-time.Minute)},
		{ID: "00000000-0000-4000-8000-000000000104", Reason: "lookahead", Status: operations.QueueStatusOpen, CreatedAt: createdAt.Add(-2 * time.Minute)},
	}
	fixture.operations.reports = reports

	req := trustedRequest(http.MethodGet, "/admin/v1/reports?status=open&assignee=unassigned&limit=2")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %q body %s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
	var payload struct {
		Reports        []operations.Report `json:"reports"`
		NextCursor     string              `json:"next_cursor"`
		PreviousCursor string              `json:"previous_cursor"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !reflect.DeepEqual(payload.Reports, reports[:2]) || payload.NextCursor == "" || payload.PreviousCursor != "" {
		t.Fatalf("page = %#v, want first two reports and next cursor", payload)
	}
	if strings.Contains(response.Body.String(), "<img") || payload.Reports[0].Reason != reports[0].Reason {
		t.Fatalf("hostile text was not transported as inert JSON data: %s", response.Body.String())
	}
	emptyAssignee := ""
	wantFilter := operations.QueueFilter{
		Status: operations.QueueStatusOpen, AssignedToUserID: &emptyAssignee, Limit: 3,
	}
	if !reflect.DeepEqual(fixture.operations.listReportFilter, wantFilter) {
		t.Fatalf("filter = %#v, want %#v", fixture.operations.listReportFilter, wantFilter)
	}
	wantEvent := adminsecurity.WriteInput{
		Type: adminsecurity.EventSensitiveRead, Outcome: adminsecurity.OutcomeSucceeded,
		ActorUserID: "user-id", AdminSessionID: "session-id",
		RequestID: response.Header().Get(RequestIDHeader),
		Metadata:  adminsecurity.Metadata{ResourceType: "report", Operation: "list"},
	}
	if len(fixture.security.events) != 1 || !reflect.DeepEqual(fixture.security.events[0], wantEvent) {
		t.Fatalf("security events = %#v, want %#v", fixture.security.events, wantEvent)
	}

	tickets := []operations.SupportTicket{
		{ID: testTicketID, Message: `<script>alert("ticket")</script>`, Status: operations.QueueStatusOpen, CreatedAt: createdAt},
		{ID: "00000000-0000-4000-8000-000000000105", Message: "lookahead", Status: operations.QueueStatusOpen, CreatedAt: createdAt.Add(-time.Minute)},
	}
	fixture.operations.tickets = tickets
	req = trustedRequest(http.MethodGet, "/admin/v1/support-tickets?limit=1")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("support response = %d body %s", response.Code, response.Body.String())
	}
	var supportPayload struct {
		Tickets    []operations.SupportTicket `json:"support_tickets"`
		NextCursor string                     `json:"next_cursor"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &supportPayload); err != nil {
		t.Fatalf("decode support response: %v", err)
	}
	if !reflect.DeepEqual(supportPayload.Tickets, tickets[:1]) || supportPayload.NextCursor == "" ||
		strings.Contains(response.Body.String(), "<script") {
		t.Fatalf("support page did not preserve hostile text as inert JSON data: %#v %s", supportPayload, response.Body.String())
	}
	if !reflect.DeepEqual(fixture.operations.listSupportFilter, operations.QueueFilter{Limit: 2}) {
		t.Fatalf("support filter = %#v, want limit 2", fixture.operations.listSupportFilter)
	}
}

func TestOperationsPatchUsesAuthenticatedCorrelationAndMapsStaleWrites(t *testing.T) {
	handler, fixture := testHandler(true)
	updatedAt := time.Date(2026, time.September, 18, 9, 30, 0, 0, time.UTC)
	status := operations.QueueStatusInReview
	fixture.operations.report = operations.Report{ID: testReportID, Status: status, UpdatedAt: updatedAt.Add(time.Minute)}
	body := `{"expected_updated_at":"` + updatedAt.Format(time.RFC3339Nano) + `","status":"in_review"}`
	req := trustedMutationRequest(http.MethodPatch, "/admin/v1/reports/"+testReportID, body)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	wantPatch := operations.QueuePatch{
		ActorUserID: "user-id", AdminSessionID: "session-id",
		RequestID: response.Header().Get(RequestIDHeader), ExpectedUpdatedAt: updatedAt,
		Status: &status,
	}
	if fixture.operations.lastReportID != testReportID || !reflect.DeepEqual(fixture.operations.lastReportPatch, wantPatch) {
		t.Fatalf("patch = %q %#v, want %q %#v", fixture.operations.lastReportID, fixture.operations.lastReportPatch, testReportID, wantPatch)
	}

	fixture.operations.err = operations.ErrQueueItemConflict
	req = trustedMutationRequest(http.MethodPatch, "/admin/v1/reports/"+testReportID, body)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"queue_item_conflict"`) {
		t.Fatalf("stale response = %d %s", response.Code, response.Body.String())
	}

	fixture.operations.err = nil
	fixture.operations.ticket = operations.SupportTicket{ID: testTicketID, Status: status, UpdatedAt: updatedAt.Add(time.Minute)}
	req = trustedMutationRequest(http.MethodPatch, "/admin/v1/support-tickets/"+testTicketID, body)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("support status = %d body = %s", response.Code, response.Body.String())
	}
	wantPatch.RequestID = response.Header().Get(RequestIDHeader)
	if fixture.operations.lastTicketID != testTicketID || !reflect.DeepEqual(fixture.operations.lastSupportPatch, wantPatch) {
		t.Fatalf("support patch = %q %#v, want %q %#v", fixture.operations.lastTicketID, fixture.operations.lastSupportPatch, testTicketID, wantPatch)
	}
}

func TestOperationsRejectsInvalidPaginationBeforeRepositoryWork(t *testing.T) {
	cursor := pagecursor.Encode(
		time.Date(2026, time.September, 18, 9, 45, 0, 0, time.UTC),
		"00000000-0000-4000-8000-000000000109",
	)
	for _, path := range []string{
		"/admin/v1/reports?limit=101",
		"/admin/v1/reports?after=invalid",
		"/admin/v1/reports?after=" + cursor + "&before=" + cursor,
		"/admin/v1/reports?limit=1&limit=2",
		"/admin/v1/reports?unknown=value",
		"/admin/v1/reports?assignee=not-a-uuid",
		"/admin/v1/reports?status=pending",
	} {
		handler, fixture := testHandler(true)
		req := trustedRequest(http.MethodGet, path)
		req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusBadRequest || fixture.operations.listReportCalls != 0 {
			t.Fatalf("invalid pagination %q = %d calls %d", path, response.Code, fixture.operations.listReportCalls)
		}
	}
}

func TestOperationsRejectsBodyIdentityAndUnauthorizedResourceAccess(t *testing.T) {
	handler, fixture := testHandler(true)
	updatedAt := time.Date(2026, time.September, 18, 10, 0, 0, 0, time.UTC)
	body := `{"expected_updated_at":"` + updatedAt.Format(time.RFC3339Nano) + `","status":"closed","actor_user_id":"attacker"}`
	req := trustedMutationRequest(http.MethodPatch, "/admin/v1/reports/"+testReportID, body)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest || fixture.operations.patchReportCalls != 0 {
		t.Fatalf("body identity response = %d calls = %d", response.Code, fixture.operations.patchReportCalls)
	}

	handler, fixture = testHandler(true)
	fixture.grants.err = adminaccess.ErrGrantNotFound
	req = trustedRequest(http.MethodGet, "/admin/v1/support-tickets/"+testTicketID)
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusForbidden || fixture.operations.getSupportCalls != 0 {
		t.Fatalf("unauthorized read = %d calls = %d", response.Code, fixture.operations.getSupportCalls)
	}

	handler, fixture = testHandler(true)
	req = trustedRequest(http.MethodGet, "/admin/v1/reports/not-a-uuid")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusNotFound || fixture.operations.getReportCalls != 0 {
		t.Fatalf("malformed resource read = %d calls = %d", response.Code, fixture.operations.getReportCalls)
	}

	handler, fixture = testHandler(true)
	fixture.operations.err = operations.ErrQueueItemNotFound
	req = trustedRequest(http.MethodGet, "/admin/v1/reports/00000000-0000-4000-8000-000000000199")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusNotFound || fixture.operations.getReportCalls != 1 {
		t.Fatalf("unknown resource read = %d calls = %d", response.Code, fixture.operations.getReportCalls)
	}
}

func TestOperationsAuditHistoryIsScopedByRegisteredResource(t *testing.T) {
	handler, fixture := testHandler(true)
	createdAt := time.Date(2026, time.September, 18, 11, 0, 0, 0, time.UTC)
	fixture.operations.report = operations.Report{ID: testReportID}
	fixture.operations.audit = []operations.AuditEntry{{
		ID: "00000000-0000-4000-8000-000000000105", EntityType: "report",
		EntityID: testReportID, CreatedAt: createdAt,
	}}
	req := trustedRequest(http.MethodGet, "/admin/v1/reports/"+testReportID+"/audit?limit=20")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	if fixture.operations.getReportCalls != 1 || fixture.operations.listAuditCalls != 1 ||
		fixture.operations.lastAuditEntityType != "report" || fixture.operations.lastAuditEntityID != testReportID ||
		fixture.operations.lastAuditFilter.Limit != 21 {
		t.Fatalf("scoped audit calls = %#v", fixture.operations)
	}

	handler, fixture = testHandler(true)
	fixture.operations.ticket = operations.SupportTicket{ID: testTicketID}
	req = trustedRequest(http.MethodGet, "/admin/v1/support-tickets/"+testTicketID+"/audit?limit=20")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK || fixture.operations.getSupportCalls != 1 || fixture.operations.listAuditCalls != 1 ||
		fixture.operations.lastAuditEntityType != "support_ticket" || fixture.operations.lastAuditEntityID != testTicketID {
		t.Fatalf("scoped support audit response = %d repository = %#v", response.Code, fixture.operations)
	}
}

func TestOperationsMutationRequiresOriginAndCSRFBeforeRepositoryWork(t *testing.T) {
	handler, fixture := testHandler(true)
	req := trustedRequest(http.MethodPatch, "/admin/v1/support-tickets/"+testTicketID)
	req.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusForbidden || fixture.operations.patchSupportCalls != 0 || fixture.grants.calls != 0 {
		t.Fatalf("origin rejection = %d patch calls %d grant calls %d", response.Code, fixture.operations.patchSupportCalls, fixture.grants.calls)
	}
}

func trustedMutationRequest(method string, path string, body string) *http.Request {
	req := trustedRequest(method, path)
	req.Body = io.NopCloser(strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, "current-csrf")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
	return req
}
