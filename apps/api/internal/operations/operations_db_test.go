package operations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type operationsFixture struct {
	pool       *pgxpool.Pool
	repository *PostgresRepository
	actorID    string
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

	var reportID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO reports (reporter_user_id, target_type, target_id, reason)
		VALUES ($1::uuid, 'user', $2::uuid, 'Harassment in event chat')
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
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, actorID, reporterID, otherID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	return operationsFixture{
		pool:       pool,
		repository: NewPostgresRepository(pool),
		actorID:    actorID,
		reporterID: reporterID,
		otherID:    otherID,
		reportID:   reportID,
		ticketID:   ticketID,
	}
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
	updatedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID:      fixture.actorID,
		Status:           &inReview,
		AssignedToUserID: &fixture.actorID,
		ResolutionNote:   &note,
	})
	if err != nil {
		t.Fatalf("PatchReport() error = %v", err)
	}
	if updatedReport.Status != inReview || updatedReport.AssignedToUserID == nil || *updatedReport.AssignedToUserID != fixture.actorID {
		t.Fatalf("PatchReport() = %#v, want in-review report assigned to actor", updatedReport)
	}

	if _, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &inReview,
	}); !errors.Is(err, ErrNoChanges) {
		t.Fatalf("no-op PatchReport() error = %v, want ErrNoChanges", err)
	}

	reportHistory, err := fixture.repository.ListAuditHistory(ctx, "report", fixture.reportID, 10)
	if err != nil {
		t.Fatalf("ListAuditHistory(report) error = %v", err)
	}
	if len(reportHistory) != 1 || reportHistory[0].Action != "report.updated" {
		t.Fatalf("report audit history = %#v, want one report.updated entry", reportHistory)
	}
	if reportHistory[0].ActorUserID == nil || *reportHistory[0].ActorUserID != fixture.actorID {
		t.Fatalf("audit actor = %v, want %s", reportHistory[0].ActorUserID, fixture.actorID)
	}
	var before, after queueAuditState
	if err := json.Unmarshal(reportHistory[0].Before, &before); err != nil {
		t.Fatalf("decode audit before: %v", err)
	}
	if err := json.Unmarshal(reportHistory[0].After, &after); err != nil {
		t.Fatalf("decode audit after: %v", err)
	}
	if before.Status != QueueStatusOpen || after.Status != QueueStatusInReview {
		t.Fatalf("audit transition = %q -> %q, want open -> in_review", before.Status, after.Status)
	}
	if before.RetentionStartedAt != nil || after.RetentionStartedAt != nil {
		t.Fatalf("in-review audit retention transition = %v -> %v, want nil -> nil", before.RetentionStartedAt, after.RetentionStartedAt)
	}

	resolved := QueueStatusResolved
	ticketNote := "Sent account recovery guidance."
	updatedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, QueuePatch{
		ActorUserID:      fixture.actorID,
		Status:           &resolved,
		AssignedToUserID: &fixture.actorID,
		ResolutionNote:   &ticketNote,
	})
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

	ticketHistory, err := fixture.repository.ListAuditHistory(ctx, "support_ticket", fixture.ticketID, 10)
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
}

func TestPostgresRepositoryQueueRetentionLifecycle(t *testing.T) {
	fixture := newOperationsFixture(t)
	ctx := context.Background()
	resolved := QueueStatusResolved
	closed := QueueStatusClosed
	open := QueueStatusOpen

	resolvedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &resolved,
	})
	if err != nil {
		t.Fatalf("resolve report: %v", err)
	}
	if resolvedReport.RetentionStartedAt == nil {
		t.Fatal("resolved report retention_started_at = nil")
	}
	firstReportClock := *resolvedReport.RetentionStartedAt

	closedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	})
	if err != nil {
		t.Fatalf("close resolved report: %v", err)
	}
	if !optionalTimeEqual(closedReport.RetentionStartedAt, &firstReportClock) {
		t.Fatalf("closed report retention_started_at = %v, want preserved %v", closedReport.RetentionStartedAt, firstReportClock)
	}

	if _, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	}); !errors.Is(err, ErrNoChanges) {
		t.Fatalf("no-op closed report patch error = %v, want ErrNoChanges", err)
	}

	reopenedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &open,
	})
	if err != nil {
		t.Fatalf("reopen report: %v", err)
	}
	if reopenedReport.RetentionStartedAt != nil {
		t.Fatalf("reopened report retention_started_at = %v, want nil", reopenedReport.RetentionStartedAt)
	}

	reclosedReport, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	})
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

	reportHistory, err := fixture.repository.ListAuditHistory(ctx, "report", fixture.reportID, 10)
	if err != nil {
		t.Fatalf("list report retention audit history: %v", err)
	}
	if len(reportHistory) != 4 {
		t.Fatalf("report audit history length = %d, want 4 (no-op must not write an audit)", len(reportHistory))
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

	resolvedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &resolved,
	})
	if err != nil {
		t.Fatalf("resolve support ticket: %v", err)
	}
	if resolvedTicket.RetentionStartedAt == nil {
		t.Fatal("resolved support ticket retention_started_at = nil")
	}
	firstTicketClock := *resolvedTicket.RetentionStartedAt

	reopenedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &open,
	})
	if err != nil {
		t.Fatalf("reopen support ticket: %v", err)
	}
	if reopenedTicket.RetentionStartedAt != nil {
		t.Fatalf("reopened support ticket retention_started_at = %v, want nil", reopenedTicket.RetentionStartedAt)
	}

	reclosedTicket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	})
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

	if _, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &closed,
	}); !errors.Is(err, ErrNoChanges) {
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
	ticket, err := fixture.repository.PatchSupportTicket(ctx, fixture.ticketID, QueuePatch{
		ActorUserID: fixture.actorID,
		Status:      &resolved,
	})
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

	_, err := fixture.repository.PatchReport(ctx, fixture.reportID, QueuePatch{
		ActorUserID: "00000000-0000-0000-0000-000000000001",
		Status:      &inReview,
	})
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

func containsReport(reports []Report, id string) bool {
	for _, report := range reports {
		if report.ID == id {
			return true
		}
	}
	return false
}

func containsSupportTicket(tickets []SupportTicket, id string) bool {
	for _, ticket := range tickets {
		if ticket.ID == id {
			return true
		}
	}
	return false
}

func findReport(reports []Report, id string) *Report {
	for i := range reports {
		if reports[i].ID == id {
			return &reports[i]
		}
	}
	return nil
}

func findSupportTicket(tickets []SupportTicket, id string) *SupportTicket {
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
	var before, after queueAuditState
	if err := json.Unmarshal(entry.Before, &before); err != nil {
		t.Fatalf("decode retention audit before: %v", err)
	}
	if err := json.Unmarshal(entry.After, &after); err != nil {
		t.Fatalf("decode retention audit after: %v", err)
	}
	if before.Status != wantBeforeStatus || !optionalTimeEqual(before.RetentionStartedAt, wantBeforeRetentionStartedAt) {
		t.Fatalf(
			"audit before = (%q, %v), want (%q, %v)",
			before.Status,
			before.RetentionStartedAt,
			wantBeforeStatus,
			wantBeforeRetentionStartedAt,
		)
	}
	if after.Status != wantAfterStatus || !optionalTimeEqual(after.RetentionStartedAt, wantAfterRetentionStartedAt) {
		t.Fatalf(
			"audit after = (%q, %v), want (%q, %v)",
			after.Status,
			after.RetentionStartedAt,
			wantAfterStatus,
			wantAfterRetentionStartedAt,
		)
	}
}
