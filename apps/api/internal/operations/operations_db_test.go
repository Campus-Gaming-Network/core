package operations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5/pgxpool"
)

type operationsFixture struct {
	pool       *pgxpool.Pool
	repository *PostgresRepository
	actorID    string
	sessionID  string
	reporterID string
	otherID    string
	reportID   string
	ticketID   string
}

func newOperationsFixture(t *testing.T) operationsFixture {
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
	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug)
		VALUES ('Operations Test School', $1)
		RETURNING id::text
	`, "operations-test-"+suffix).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}

	insertUser := func(label string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1, 'hash', $2, $3::uuid, NOW())
			RETURNING id::text
		`, label+"-"+suffix+"@example.test", label, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert %s: %v", label, err)
		}
		return id
	}
	actorID := insertUser("operator")
	reporterID := insertUser("reporter")
	otherID := insertUser("other")
	if _, err := pool.Exec(ctx, `
		UPDATE users SET email_verified_at = NOW() WHERE id = $1::uuid
	`, actorID); err != nil {
		t.Fatalf("verify operator: %v", err)
	}
	var grantID, sessionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO site_role_grants (user_id, role, granted_by_user_id, grant_reason)
		VALUES ($1::uuid, 'site_admin', $1::uuid, 'Operations test administrator')
		RETURNING id::text
	`, actorID).Scan(&grantID); err != nil {
		t.Fatalf("insert operator grant: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO admin_sessions (
			user_id, grant_id, token_hash, csrf_token_hash, authn_method,
			access_issuer, access_subject, access_email, authenticated_at,
			last_seen_at, idle_expires_at, absolute_expires_at
		)
		VALUES (
			$1::uuid, $2::uuid, $3, $4, 'cloudflare_access',
			'https://access.example.test', $5, $6, NOW(), NOW(),
			NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '8 hours'
		)
		RETURNING id::text
	`, actorID, grantID, make([]byte, 32),
		make([]byte, 32), "operations-subject-"+suffix,
		"operator-"+suffix+"@example.test").Scan(&sessionID); err != nil {
		t.Fatalf("insert operator session: %v", err)
	}

	var reportID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO reports (reporter_user_id, target_type, target_id, reason, updated_at)
		VALUES (
			$1::uuid, 'user', $2::uuid, 'Harassment in event chat',
			TIMESTAMPTZ '2025-01-02 03:04:05+00'
		)
		RETURNING id::text
	`, reporterID, otherID).Scan(&reportID); err != nil {
		t.Fatalf("insert report: %v", err)
	}

	var ticketID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO support_tickets (
			submitter_user_id, contact_email, name, subject, message
		)
		VALUES ($1::uuid, $2, 'Reporter', 'Account help', 'Please help with my account.')
		RETURNING id::text
	`, reporterID, "reporter-"+suffix+"@example.test").Scan(&ticketID); err != nil {
		t.Fatalf("insert support ticket: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM notifications WHERE user_id IN ($1::uuid, $2::uuid, $3::uuid)`, actorID, reporterID, otherID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM audit_logs WHERE entity_id IN ($1::uuid, $2::uuid)`, reportID, ticketID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM reports WHERE id = $1::uuid`, reportID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM support_tickets WHERE id = $1::uuid`, ticketID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM admin_sessions WHERE id = $1::uuid`, sessionID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM site_role_grants WHERE id = $1::uuid`, grantID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, actorID, reporterID, otherID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	return operationsFixture{
		pool:       pool,
		repository: NewPostgresRepository(pool),
		actorID:    actorID,
		sessionID:  sessionID,
		reporterID: reporterID,
		otherID:    otherID,
		reportID:   reportID,
		ticketID:   ticketID,
	}
}

func (fixture operationsFixture) queuePatch(t *testing.T, entityID string, patch QueuePatch) QueuePatch {
	t.Helper()
	if patch.ActorUserID == "" {
		patch.ActorUserID = fixture.actorID
	}
	if patch.AdminSessionID == "" {
		patch.AdminSessionID = fixture.sessionID
	}
	if patch.RequestID == "" {
		patch.RequestID = "operations-test-request"
	}
	if patch.ExpectedUpdatedAt.IsZero() {
		if err := fixture.pool.QueryRow(t.Context(), `
			SELECT updated_at FROM reports WHERE id = $1::uuid
			UNION ALL
			SELECT updated_at FROM support_tickets WHERE id = $1::uuid
		`, entityID).Scan(&patch.ExpectedUpdatedAt); err != nil {
			t.Fatalf("read queue version: %v", err)
		}
	}
	return patch
}

func TestPostgresRepositoryQueuesWriteAuditHistory(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()

	openReports, err := fixture.repository.ListReports(ctx, QueueFilter{Status: QueueStatusOpen})
	if err != nil {
		t.Fatalf("ListReports() error = %v", err)
	}
	if !containsReport(openReports, fixture.reportID) {
		t.Fatalf("ListReports() did not include fixture report %s", fixture.reportID)
	}

	inReview := QueueStatusInReview
	note := "Reviewing the reported chat context."
	updatedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID:      fixture.actorID,
		AdminSessionID:   fixture.sessionID,
		RequestID:        "report-update-request",
		Status:           &inReview,
		AssignedToUserID: &fixture.actorID,
		ResolutionNote:   &note,
	}))
	if err != nil {
		t.Fatalf("PatchReport() error = %v", err)
	}
	if updatedReport.Status != inReview || updatedReport.AssignedToUserID == nil || *updatedReport.AssignedToUserID != fixture.actorID {
		t.Fatalf("PatchReport() = %#v, want in-review report assigned to actor", updatedReport)
	}

	if _, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		Status: &inReview,
	})); !errors.Is(err, ErrNoChanges) {
		t.Fatalf("no-op PatchReport() error = %v, want ErrNoChanges", err)
	}

	reportHistory, err := fixture.repository.ListAuditHistory(ctx, "report", fixture.reportID, AuditFilter{Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditHistory(report) error = %v", err)
	}
	if len(reportHistory) != 1 || reportHistory[0].Action != "report.updated" {
		t.Fatalf("report audit history = %#v, want one report.updated entry", reportHistory)
	}
	if reportHistory[0].ActorUserID == nil || *reportHistory[0].ActorUserID != fixture.actorID {
		t.Fatalf("audit actor = %v, want %s", reportHistory[0].ActorUserID, fixture.actorID)
	}
	if reportHistory[0].AdminSessionID == nil || *reportHistory[0].AdminSessionID != fixture.sessionID ||
		reportHistory[0].RequestID == nil || *reportHistory[0].RequestID != "report-update-request" {
		t.Fatalf("audit correlation = %#v, want session and request ids", reportHistory[0])
	}
	var before, after adminaudit.QueueState
	if err := json.Unmarshal(reportHistory[0].Before, &before); err != nil {
		t.Fatalf("decode audit before: %v", err)
	}
	if err := json.Unmarshal(reportHistory[0].After, &after); err != nil {
		t.Fatalf("decode audit after: %v", err)
	}
	if before.Status != string(QueueStatusOpen) || after.Status != string(QueueStatusInReview) {
		t.Fatalf("audit transition = %q -> %q, want open -> in_review", before.Status, after.Status)
	}
	if before.RetentionStartedAt != nil || after.RetentionStartedAt != nil {
		t.Fatalf("in-review audit retention transition = %v -> %v, want nil -> nil", before.RetentionStartedAt, after.RetentionStartedAt)
	}
	if bytes.Contains(reportHistory[0].Before, []byte(note)) || bytes.Contains(reportHistory[0].After, []byte(note)) ||
		bytes.Contains(reportHistory[0].Before, []byte("Harassment in event chat")) ||
		bytes.Contains(reportHistory[0].After, []byte("Harassment in event chat")) {
		t.Fatal("report audit copied moderation text")
	}

	resolved := QueueStatusResolved
	ticketNote := "Sent account recovery guidance."
	updatedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, fixture.queuePatch(t, fixture.ticketID, QueuePatch{
		ActorUserID:      fixture.actorID,
		AdminSessionID:   fixture.sessionID,
		RequestID:        "support-update-request",
		Status:           &resolved,
		AssignedToUserID: &fixture.actorID,
		ResolutionNote:   &ticketNote,
	}))
	if err != nil {
		t.Fatalf("PatchSupportTicket() error = %v", err)
	}
	if updatedTicket.Status != resolved || updatedTicket.ResolutionNote != ticketNote || updatedTicket.RetentionStartedAt == nil {
		t.Fatalf("PatchSupportTicket() = %#v, want resolved ticket with note", updatedTicket)
	}

	resolvedTickets, err := fixture.repository.ListSupportTickets(ctx, QueueFilter{Status: QueueStatusResolved})
	if err != nil {
		t.Fatalf("ListSupportTickets() error = %v", err)
	}
	if !containsSupportTicket(resolvedTickets, fixture.ticketID) {
		t.Fatalf("ListSupportTickets() did not include fixture ticket %s", fixture.ticketID)
	}

	ticketHistory, err := fixture.repository.ListAuditHistory(ctx, "support_ticket", fixture.ticketID, AuditFilter{Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditHistory(support ticket) error = %v", err)
	}
	if len(ticketHistory) != 1 || ticketHistory[0].Action != "support_ticket.updated" {
		t.Fatalf("support ticket audit history = %#v, want one support_ticket.updated entry", ticketHistory)
	}
	if err := json.Unmarshal(ticketHistory[0].Before, &before); err != nil {
		t.Fatalf("decode support ticket audit before: %v", err)
	}
	if err := json.Unmarshal(ticketHistory[0].After, &after); err != nil {
		t.Fatalf("decode support ticket audit after: %v", err)
	}
	if before.RetentionStartedAt != nil || !optionalTimeEqual(after.RetentionStartedAt, updatedTicket.RetentionStartedAt) {
		t.Fatalf(
			"support ticket audit retention transition = %v -> %v, want nil -> %v",
			before.RetentionStartedAt,
			after.RetentionStartedAt,
			updatedTicket.RetentionStartedAt,
		)
	}
	var metadata adminaudit.Metadata
	if err := json.Unmarshal(ticketHistory[0].Metadata, &metadata); err != nil {
		t.Fatalf("decode support ticket audit metadata: %v", err)
	}
	if metadata != (adminaudit.Metadata{ResolutionNoteChanged: true}) {
		t.Fatalf("support ticket audit metadata = %#v, want note-change marker", metadata)
	}
	if err := adminaudit.ValidateSafeDocuments(
		ticketHistory[0].Before,
		ticketHistory[0].After,
		ticketHistory[0].Metadata,
	); err != nil {
		t.Fatalf("support ticket audit contains prohibited fields: %v", err)
	}
	for _, prohibited := range []string{
		ticketNote,
		updatedTicket.ContactEmail,
		updatedTicket.Name,
		updatedTicket.Subject,
		updatedTicket.Message,
	} {
		if bytes.Contains(ticketHistory[0].Before, []byte(prohibited)) ||
			bytes.Contains(ticketHistory[0].After, []byte(prohibited)) ||
			bytes.Contains(ticketHistory[0].Metadata, []byte(prohibited)) {
			t.Fatalf("support ticket audit copied prohibited text %q", prohibited)
		}
	}
}

func TestPostgresRepositoryQueuePaginationFiltersAndDetails(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()
	baseCreatedAt := time.Date(2026, time.September, 18, 8, 0, 0, 0, time.UTC)
	if _, err := fixture.pool.Exec(ctx, `
		UPDATE reports
		SET assigned_to_user_id = $2::uuid, status = 'open', created_at = $3
		WHERE id = $1::uuid
	`, fixture.reportID, fixture.actorID, baseCreatedAt); err != nil {
		t.Fatalf("prepare first report: %v", err)
	}

	insertReport := func(offset time.Duration, status QueueStatus, assignee *string) string {
		t.Helper()
		var id string
		if err := fixture.pool.QueryRow(ctx, `
			INSERT INTO reports (
				reporter_user_id, target_type, target_id, reason, status,
				assigned_to_user_id, created_at
			)
			VALUES ($1::uuid, 'user', $2::uuid, 'Pagination fixture', $3,
			        $4::uuid, $5)
			RETURNING id::text
		`, fixture.reporterID, fixture.otherID, status, assignee, baseCreatedAt.Add(offset)).Scan(&id); err != nil {
			t.Fatalf("insert paginated report: %v", err)
		}
		t.Cleanup(func() {
			_, _ = fixture.pool.Exec(context.Background(), `DELETE FROM reports WHERE id = $1::uuid`, id)
		})
		return id
	}
	secondID := insertReport(-time.Minute, QueueStatusOpen, &fixture.actorID)
	unassignedID := insertReport(-2*time.Minute, QueueStatusOpen, nil)
	_ = insertReport(-3*time.Minute, QueueStatusResolved, &fixture.actorID)

	assigned := fixture.actorID
	firstPage, err := fixture.repository.ListReports(ctx, QueueFilter{
		Status: QueueStatusOpen, AssignedToUserID: &assigned, Limit: 1,
	})
	if err != nil {
		t.Fatalf("ListReports(first page) error = %v", err)
	}
	if len(firstPage) != 1 || firstPage[0].ID != fixture.reportID {
		t.Fatalf("first page = %#v, want fixture report", firstPage)
	}
	after := pagecursor.Cursor{Timestamp: firstPage[0].CreatedAt, ID: firstPage[0].ID}
	secondPage, err := fixture.repository.ListReports(ctx, QueueFilter{
		Status: QueueStatusOpen, AssignedToUserID: &assigned, Limit: 1, After: &after,
	})
	if err != nil {
		t.Fatalf("ListReports(second page) error = %v", err)
	}
	if len(secondPage) != 1 || secondPage[0].ID != secondID {
		t.Fatalf("second page = %#v, want %s", secondPage, secondID)
	}
	before := pagecursor.Cursor{Timestamp: secondPage[0].CreatedAt, ID: secondPage[0].ID}
	previousPage, err := fixture.repository.ListReports(ctx, QueueFilter{
		Status: QueueStatusOpen, AssignedToUserID: &assigned, Limit: 1, Before: &before,
	})
	if err != nil {
		t.Fatalf("ListReports(previous page) error = %v", err)
	}
	if !reflect.DeepEqual(previousPage, firstPage) {
		t.Fatalf("previous page = %#v, want %#v", previousPage, firstPage)
	}

	unassigned := ""
	unassignedReports, err := fixture.repository.ListReports(ctx, QueueFilter{
		Status: QueueStatusOpen, AssignedToUserID: &unassigned, Limit: 10,
	})
	if err != nil {
		t.Fatalf("ListReports(unassigned) error = %v", err)
	}
	if len(unassignedReports) != 1 || unassignedReports[0].ID != unassignedID {
		t.Fatalf("unassigned reports = %#v, want %s", unassignedReports, unassignedID)
	}
	detail, err := fixture.repository.GetReport(ctx, fixture.reportID)
	if err != nil {
		t.Fatalf("GetReport() error = %v", err)
	}
	wantReportSummary := ReportSummary{
		ID:                 detail.ID,
		ReporterUserID:     detail.ReporterUserID,
		TargetType:         detail.TargetType,
		TargetID:           detail.TargetID,
		Status:             detail.Status,
		AssignedToUserID:   detail.AssignedToUserID,
		RetentionStartedAt: detail.RetentionStartedAt,
		CreatedAt:          detail.CreatedAt,
		UpdatedAt:          detail.UpdatedAt,
	}
	if !reflect.DeepEqual(firstPage[0], wantReportSummary) {
		t.Fatalf("ListReports() = %#v, want summary %#v", firstPage[0], wantReportSummary)
	}

	if _, err := fixture.pool.Exec(ctx, `
		UPDATE support_tickets SET assigned_to_user_id = $2::uuid WHERE id = $1::uuid
	`, fixture.ticketID, fixture.actorID); err != nil {
		t.Fatalf("assign support ticket: %v", err)
	}
	tickets, err := fixture.repository.ListSupportTickets(ctx, QueueFilter{AssignedToUserID: &assigned, Limit: 10})
	if err != nil {
		t.Fatalf("ListSupportTickets() error = %v", err)
	}
	if len(tickets) != 1 || tickets[0].ID != fixture.ticketID {
		t.Fatalf("support tickets = %#v, want fixture ticket", tickets)
	}
	ticket, err := fixture.repository.GetSupportTicket(ctx, fixture.ticketID)
	if err != nil {
		t.Fatalf("GetSupportTicket() error = %v", err)
	}
	wantTicketSummary := SupportTicketSummary{
		ID:                 ticket.ID,
		SubmitterUserID:    ticket.SubmitterUserID,
		SubmitterDeletedAt: ticket.SubmitterDeletedAt,
		Subject:            ticket.Subject,
		Status:             ticket.Status,
		AssignedToUserID:   ticket.AssignedToUserID,
		RetentionStartedAt: ticket.RetentionStartedAt,
		CreatedAt:          ticket.CreatedAt,
		UpdatedAt:          ticket.UpdatedAt,
	}
	if !reflect.DeepEqual(tickets[0], wantTicketSummary) {
		t.Fatalf("ListSupportTickets() = %#v, want summary %#v", tickets[0], wantTicketSummary)
	}
}

func TestPostgresRepositoryConcurrentQueuePatchesRejectStaleVersion(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()

	inReview := QueueStatusInReview
	closed := QueueStatusClosed
	patches := []QueuePatch{
		fixture.queuePatch(t, fixture.reportID, QueuePatch{RequestID: "concurrent-patch-1", Status: &inReview}),
		fixture.queuePatch(t, fixture.reportID, QueuePatch{RequestID: "concurrent-patch-2", Status: &closed}),
	}
	start := make(chan struct{})
	results := make(chan error, len(patches))
	for _, patch := range patches {
		go func() {
			<-start
			_, err := fixture.repository.PatchReport(ctx, fixture.reportID, patch)
			results <- err
		}()
	}
	close(start)
	succeeded := 0
	conflicted := 0
	for range patches {
		err := <-results
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrQueueItemConflict):
			conflicted++
		default:
			t.Fatalf("concurrent PatchReport() error = %v", err)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent results = %d succeeded, %d conflicted", succeeded, conflicted)
	}

	var auditCount int
	if err := fixture.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM audit_logs
		WHERE entity_type = 'report' AND entity_id = $1::uuid
	`, fixture.reportID).Scan(&auditCount); err != nil {
		t.Fatalf("count concurrent patch audits: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("concurrent patch audit count = %d, want 1", auditCount)
	}
}

func TestPostgresRepositoryQueueRetentionLifecycle(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()
	resolved := QueueStatusResolved
	closed := QueueStatusClosed
	open := QueueStatusOpen

	resolvedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &resolved,
	}))
	if err != nil {
		t.Fatalf("resolve report: %v", err)
	}
	if resolvedReport.RetentionStartedAt == nil {
		t.Fatal("resolved report retention_started_at = nil")
	}
	firstReportClock := *resolvedReport.RetentionStartedAt

	closedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	}))
	if err != nil {
		t.Fatalf("close resolved report: %v", err)
	}
	if !optionalTimeEqual(closedReport.RetentionStartedAt, &firstReportClock) {
		t.Fatalf("closed report retention_started_at = %v, want preserved %v", closedReport.RetentionStartedAt, firstReportClock)
	}

	if _, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	})); !errors.Is(err, ErrNoChanges) {
		t.Fatalf("no-op closed report patch error = %v, want ErrNoChanges", err)
	}

	reopenedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &open,
	}))
	if err != nil {
		t.Fatalf("reopen report: %v", err)
	}
	if reopenedReport.RetentionStartedAt != nil {
		t.Fatalf("reopened report retention_started_at = %v, want nil", reopenedReport.RetentionStartedAt)
	}

	reclosedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	}))
	if err != nil {
		t.Fatalf("close reopened report: %v", err)
	}
	if reclosedReport.RetentionStartedAt == nil || !reclosedReport.RetentionStartedAt.After(firstReportClock) {
		t.Fatalf(
			"reclosed report retention_started_at = %v, want a clock after %v",
			reclosedReport.RetentionStartedAt,
			firstReportClock,
		)
	}

	closedReports, err := fixture.repository.ListReports(ctx, QueueFilter{Status: QueueStatusClosed})
	if err != nil {
		t.Fatalf("list closed reports: %v", err)
	}
	listedReport := findReport(closedReports, fixture.reportID)
	if listedReport == nil || !optionalTimeEqual(listedReport.RetentionStartedAt, reclosedReport.RetentionStartedAt) {
		t.Fatalf("listed report = %#v, want retention_started_at %v", listedReport, reclosedReport.RetentionStartedAt)
	}

	reportHistory, err := fixture.repository.ListAuditHistory(ctx, "report", fixture.reportID, AuditFilter{Limit: 10})
	if err != nil {
		t.Fatalf("list report retention audit history: %v", err)
	}
	if len(reportHistory) != 4 {
		t.Fatalf("report audit history length = %d, want 4 (no-op must not write an audit)", len(reportHistory))
	}
	afterAudit := pagecursor.Cursor{Timestamp: reportHistory[1].CreatedAt, ID: reportHistory[1].ID}
	olderAudit, err := fixture.repository.ListAuditHistory(
		ctx,
		"report",
		fixture.reportID,
		AuditFilter{Limit: 10, After: &afterAudit},
	)
	if err != nil {
		t.Fatalf("list older report audit history: %v", err)
	}
	if !reflect.DeepEqual(olderAudit, reportHistory[2:]) {
		t.Fatalf("older audit history = %#v, want %#v", olderAudit, reportHistory[2:])
	}
	beforeAudit := pagecursor.Cursor{Timestamp: reportHistory[2].CreatedAt, ID: reportHistory[2].ID}
	newerAudit, err := fixture.repository.ListAuditHistory(
		ctx,
		"report",
		fixture.reportID,
		AuditFilter{Limit: 10, Before: &beforeAudit},
	)
	if err != nil {
		t.Fatalf("list newer report audit history: %v", err)
	}
	if !reflect.DeepEqual(newerAudit, reportHistory[:2]) {
		t.Fatalf("newer audit history = %#v, want %#v", newerAudit, reportHistory[:2])
	}
	assertRetentionAuditTransition(
		t,
		reportHistory[0],
		QueueStatusOpen,
		nil,
		QueueStatusClosed,
		reclosedReport.RetentionStartedAt,
	)
	assertRetentionAuditTransition(
		t,
		reportHistory[1],
		QueueStatusClosed,
		&firstReportClock,
		QueueStatusOpen,
		nil,
	)
	assertRetentionAuditTransition(
		t,
		reportHistory[2],
		QueueStatusResolved,
		&firstReportClock,
		QueueStatusClosed,
		&firstReportClock,
	)
	assertRetentionAuditTransition(
		t,
		reportHistory[3],
		QueueStatusOpen,
		nil,
		QueueStatusResolved,
		&firstReportClock,
	)

	resolvedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, fixture.queuePatch(t, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &resolved,
	}))
	if err != nil {
		t.Fatalf("resolve support ticket: %v", err)
	}
	if resolvedTicket.RetentionStartedAt == nil {
		t.Fatal("resolved support ticket retention_started_at = nil")
	}
	firstTicketClock := *resolvedTicket.RetentionStartedAt

	reopenedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, fixture.queuePatch(t, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &open,
	}))
	if err != nil {
		t.Fatalf("reopen support ticket: %v", err)
	}
	if reopenedTicket.RetentionStartedAt != nil {
		t.Fatalf("reopened support ticket retention_started_at = %v, want nil", reopenedTicket.RetentionStartedAt)
	}

	reclosedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, fixture.queuePatch(t, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	}))
	if err != nil {
		t.Fatalf("close reopened support ticket: %v", err)
	}
	if reclosedTicket.RetentionStartedAt == nil || !reclosedTicket.RetentionStartedAt.After(firstTicketClock) {
		t.Fatalf(
			"reclosed support ticket retention_started_at = %v, want a clock after %v",
			reclosedTicket.RetentionStartedAt,
			firstTicketClock,
		)
	}

	closedTickets, err := fixture.repository.ListSupportTickets(ctx, QueueFilter{Status: QueueStatusClosed})
	if err != nil {
		t.Fatalf("list closed support tickets: %v", err)
	}
	listedTicket := findSupportTicket(closedTickets, fixture.ticketID)
	if listedTicket == nil || !optionalTimeEqual(listedTicket.RetentionStartedAt, reclosedTicket.RetentionStartedAt) {
		t.Fatalf("listed support ticket = %#v, want retention_started_at %v", listedTicket, reclosedTicket.RetentionStartedAt)
	}

	if _, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, fixture.queuePatch(t, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	})); !errors.Is(err, ErrNoChanges) {
		t.Fatalf("no-op closed support ticket patch error = %v, want ErrNoChanges", err)
	}
}

func TestPostgresRepositoryTerminalTicketScrubsDeletedSubmitterContact(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()
	if _, err := fixture.pool.Exec(ctx, `
		UPDATE support_tickets
		SET submitter_user_id = NULL,
		    submitter_deleted_at = NOW()
		WHERE id = $1::uuid
	`, fixture.ticketID); err != nil {
		t.Fatalf("mark ticket submitter deleted: %v", err)
	}

	resolved := QueueStatusResolved
	ticket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, fixture.queuePatch(t, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &resolved,
	}))
	if err != nil {
		t.Fatalf("resolve deleted-submitter ticket: %v", err)
	}
	if ticket.SubmitterUserID != nil || ticket.SubmitterDeletedAt == nil {
		t.Fatalf("ticket submitter state = (%v, %v), want detached with deletion marker", ticket.SubmitterUserID, ticket.SubmitterDeletedAt)
	}
	if ticket.ContactEmail != "deleted@deleted.invalid" || ticket.Name != "" {
		t.Fatalf("ticket contact = (%q, %q), want scrubbed", ticket.ContactEmail, ticket.Name)
	}
}

func TestPostgresRepositoryAuditFailureRollsBackQueuePatch(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()
	inReview := QueueStatusInReview

	_, err := fixture.repository.PatchReport(ctx, fixture.reportID, fixture.queuePatch(t, fixture.reportID, QueuePatch{
		ActorUserID:    fixture.actorID,
		AdminSessionID: "00000000-0000-4000-8000-000000000001",
		RequestID:      "forced-audit-failure",
		Status:         &inReview,
	}))
	if err == nil {
		t.Fatal("PatchReport() error = nil, want audit foreign-key error")
	}

	var status QueueStatus
	var retentionStartedAt *time.Time
	if err := fixture.pool.QueryRow(ctx, `
		SELECT status, retention_started_at FROM reports WHERE id = $1::uuid
	`, fixture.reportID).Scan(&status, &retentionStartedAt); err != nil {
		t.Fatalf("read report after failed audit: %v", err)
	}
	if status != QueueStatusOpen {
		t.Fatalf("report status = %q, want %q after rollback", status, QueueStatusOpen)
	}
	if retentionStartedAt != nil {
		t.Fatalf("report retention_started_at = %v, want nil after rollback", retentionStartedAt)
	}

	var auditCount int
	if err := fixture.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM audit_logs
		WHERE entity_type = 'report' AND entity_id = $1::uuid
	`, fixture.reportID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit history after rollback: %v", err)
	}
	if auditCount != 0 {
		t.Fatalf("audit history after rollback = %d, want 0", auditCount)
	}
}

func TestPostgresRepositoryNotificationsAreUserScoped(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()

	created, err := fixture.repository.CreateNotification(ctx, NotificationInput{
		UserID:     fixture.reporterID,
		Type:       "report.resolved",
		Title:      "Your report was reviewed",
		Body:       "Thanks for helping keep Campus Gaming Network safe.",
		EntityType: "report",
		EntityID:   fixture.reportID,
		Payload:    json.RawMessage(`{"status":"resolved"}`),
	})
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}
	if created.ReadAt != nil || created.EntityID == nil || *created.EntityID != fixture.reportID {
		t.Fatalf("CreateNotification() = %#v, want unread report notification", created)
	}

	unread, err := fixture.repository.ListNotifications(ctx, fixture.reporterID, NotificationFilter{UnreadOnly: true})
	if err != nil {
		t.Fatalf("ListNotifications() error = %v", err)
	}
	if len(unread) != 1 || unread[0].ID != created.ID {
		t.Fatalf("unread notifications = %#v, want created notification", unread)
	}

	if _, err := fixture.repository.MarkNotificationRead(ctx, fixture.otherID, created.ID); !errors.Is(err, ErrNotificationNotFound) {
		t.Fatalf("cross-user MarkNotificationRead() error = %v, want ErrNotificationNotFound", err)
	}
	read, err := fixture.repository.MarkNotificationRead(ctx, fixture.reporterID, created.ID)
	if err != nil {
		t.Fatalf("MarkNotificationRead() error = %v", err)
	}
	if read.ReadAt == nil {
		t.Fatal("MarkNotificationRead() ReadAt = nil")
	}

	unread, err = fixture.repository.ListNotifications(ctx, fixture.reporterID, NotificationFilter{UnreadOnly: true})
	if err != nil {
		t.Fatalf("ListNotifications() after read error = %v", err)
	}
	if len(unread) != 0 {
		t.Fatalf("unread notifications after read = %#v, want none", unread)
	}

	otherNotifications, err := fixture.repository.ListNotifications(ctx, fixture.otherID, NotificationFilter{})
	if err != nil {
		t.Fatalf("ListNotifications(other user) error = %v", err)
	}
	if len(otherNotifications) != 0 {
		t.Fatalf("other user's notifications = %#v, want none", otherNotifications)
	}

	if _, err := fixture.repository.MarkNotificationRead(ctx, fixture.reporterID, "not-a-uuid"); err == nil {
		t.Fatal("MarkNotificationRead(invalid id) error = nil")
	}
	if _, err := fixture.repository.CreateNotification(ctx, NotificationInput{
		UserID: "not-a-uuid",
		Type:   "test",
		Title:  "Test",
		Body:   "Test body",
	}); err == nil {
		t.Fatal("CreateNotification(invalid user id) error = nil")
	}

	if _, err := fixture.pool.Exec(ctx, `
		UPDATE users
		SET account_status = 'deleted', deleted_at = NOW()
		WHERE id = $1::uuid
	`, fixture.otherID); err != nil {
		t.Fatalf("mark notification user deleted: %v", err)
	}
	if _, err := fixture.repository.CreateNotification(ctx, NotificationInput{
		UserID: fixture.otherID,
		Type:   "test",
		Title:  "Test",
		Body:   "Test body",
	}); !errors.Is(err, ErrNotificationUserMissing) {
		t.Fatalf("CreateNotification(deleted user) error = %v, want ErrNotificationUserMissing", err)
	}
}

func containsReport(reports []ReportSummary, id string) bool {
	for _, report := range reports {
		if report.ID == id {
			return true
		}
	}
	return false
}

func containsSupportTicket(tickets []SupportTicketSummary, id string) bool {
	for _, ticket := range tickets {
		if ticket.ID == id {
			return true
		}
	}
	return false
}

func findReport(reports []ReportSummary, id string) *ReportSummary {
	for i := range reports {
		if reports[i].ID == id {
			return &reports[i]
		}
	}
	return nil
}

func findSupportTicket(tickets []SupportTicketSummary, id string) *SupportTicketSummary {
	for i := range tickets {
		if tickets[i].ID == id {
			return &tickets[i]
		}
	}
	return nil
}

func assertRetentionAuditTransition(
	t *testing.T,
	entry AuditEntry,
	wantBeforeStatus QueueStatus,
	wantBeforeRetentionStartedAt *time.Time,
	wantAfterStatus QueueStatus,
	wantAfterRetentionStartedAt *time.Time,
) {
	t.Helper()
	var before, after adminaudit.QueueState
	if err := json.Unmarshal(entry.Before, &before); err != nil {
		t.Fatalf("decode retention audit before: %v", err)
	}
	if err := json.Unmarshal(entry.After, &after); err != nil {
		t.Fatalf("decode retention audit after: %v", err)
	}
	if before.Status != string(wantBeforeStatus) || !optionalTimeEqual(before.RetentionStartedAt, wantBeforeRetentionStartedAt) {
		t.Fatalf(
			"audit before = (%q, %v), want (%q, %v)",
			before.Status,
			before.RetentionStartedAt,
			wantBeforeStatus,
			wantBeforeRetentionStartedAt,
		)
	}
	if after.Status != string(wantAfterStatus) || !optionalTimeEqual(after.RetentionStartedAt, wantAfterRetentionStartedAt) {
		t.Fatalf(
			"audit after = (%q, %v), want (%q, %v)",
			after.Status,
			after.RetentionStartedAt,
			wantAfterStatus,
			wantAfterRetentionStartedAt,
		)
	}
}
