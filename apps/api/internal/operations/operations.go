// Package operations provides the database primitives used by the future
// site-admin CRM and by authenticated in-app notification endpoints.
//
// Queue and audit methods intentionally are not registered as public HTTP
// routes here. A caller must enforce site-admin authorization before exposing
// moderation data or applying a queue patch.
package operations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrQueueItemNotFound       = errors.New("queue item not found")
	ErrNotificationNotFound    = errors.New("notification not found")
	ErrNotificationUserMissing = errors.New("notification user not found")
	ErrNoChanges               = errors.New("no changes requested")
)

type QueueStatus string

const (
	QueueStatusOpen     QueueStatus = "open"
	QueueStatusInReview QueueStatus = "in_review"
	QueueStatusResolved QueueStatus = "resolved"
	QueueStatusClosed   QueueStatus = "closed"

	defaultPageLimit = 50
	maximumPageLimit = 200
)

const reportColumns = `
	id::text, reporter_user_id::text, target_type, target_id::text,
	reason, status, assigned_to_user_id::text, resolution_note,
	retention_started_at, created_at, updated_at
`

const supportTicketColumns = `
	id::text, submitter_user_id::text, submitter_deleted_at,
	contact_email, name, subject, message, status,
	assigned_to_user_id::text, resolution_note,
	retention_started_at, created_at, updated_at
`

const notificationColumns = `
	id::text, user_id::text, type, title, body, entity_type,
	entity_id::text, payload, read_at, created_at
`

type QueueFilter struct {
	Status QueueStatus
	Limit  int
}

// QueuePatch is a partial update. A non-nil AssignedToUserID containing an
// empty string clears the assignee; the same convention applies to the note.
type QueuePatch struct {
	ActorUserID      string
	Status           *QueueStatus
	AssignedToUserID *string
	ResolutionNote   *string
}

type Report struct {
	ID                 string      `json:"id"`
	ReporterUserID     string      `json:"reporter_user_id"`
	TargetType         string      `json:"target_type"`
	TargetID           string      `json:"target_id"`
	Reason             string      `json:"reason"`
	Status             QueueStatus `json:"status"`
	AssignedToUserID   *string     `json:"assigned_to_user_id,omitempty"`
	ResolutionNote     string      `json:"resolution_note"`
	RetentionStartedAt *time.Time  `json:"retention_started_at"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`
}

type SupportTicket struct {
	ID                 string      `json:"id"`
	SubmitterUserID    *string     `json:"submitter_user_id,omitempty"`
	SubmitterDeletedAt *time.Time  `json:"submitter_deleted_at,omitempty"`
	ContactEmail       string      `json:"contact_email"`
	Name               string      `json:"name"`
	Subject            string      `json:"subject"`
	Message            string      `json:"message"`
	Status             QueueStatus `json:"status"`
	AssignedToUserID   *string     `json:"assigned_to_user_id,omitempty"`
	ResolutionNote     string      `json:"resolution_note"`
	RetentionStartedAt *time.Time  `json:"retention_started_at"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`
}

type AuditEntry struct {
	ID          string          `json:"id"`
	ActorUserID *string         `json:"actor_user_id,omitempty"`
	Action      string          `json:"action"`
	EntityType  string          `json:"entity_type"`
	EntityID    string          `json:"entity_id"`
	Before      json.RawMessage `json:"before"`
	After       json.RawMessage `json:"after"`
	Metadata    json.RawMessage `json:"metadata"`
	CreatedAt   time.Time       `json:"created_at"`
}

type Notification struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id"`
	Type       string          `json:"type"`
	Title      string          `json:"title"`
	Body       string          `json:"body"`
	EntityType *string         `json:"entity_type,omitempty"`
	EntityID   *string         `json:"entity_id,omitempty"`
	Payload    json.RawMessage `json:"payload"`
	ReadAt     *time.Time      `json:"read_at,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

type NotificationInput struct {
	UserID     string
	Type       string
	Title      string
	Body       string
	EntityType string
	EntityID   string
	Payload    json.RawMessage
}

type NotificationFilter struct {
	UnreadOnly bool
	Limit      int
}

type Repository interface {
	ListReports(ctx context.Context, filter QueueFilter) ([]Report, error)
	PatchReport(ctx context.Context, id string, patch QueuePatch) (Report, error)
	ListSupportTickets(ctx context.Context, filter QueueFilter) ([]SupportTicket, error)
	PatchSupportTicket(ctx context.Context, id string, patch QueuePatch) (SupportTicket, error)
	ListAuditHistory(ctx context.Context, entityType string, entityID string, limit int) ([]AuditEntry, error)
	CreateNotification(ctx context.Context, input NotificationInput) (Notification, error)
	ListNotifications(ctx context.Context, userID string, filter NotificationFilter) ([]Notification, error)
	MarkNotificationRead(ctx context.Context, userID string, notificationID string) (Notification, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func ValidateQueueFilter(filter QueueFilter) error {
	if filter.Status != "" && !validQueueStatus(filter.Status) {
		return errors.New("queue status must be open, in_review, resolved, or closed")
	}
	if filter.Limit < 0 {
		return errors.New("queue limit cannot be negative")
	}
	return nil
}

func ValidateQueuePatch(patch QueuePatch) error {
	if strings.TrimSpace(patch.ActorUserID) == "" {
		return errors.New("actor user is required")
	}
	if patch.Status == nil && patch.AssignedToUserID == nil && patch.ResolutionNote == nil {
		return ErrNoChanges
	}
	if patch.Status != nil && !validQueueStatus(*patch.Status) {
		return errors.New("queue status must be open, in_review, resolved, or closed")
	}
	if patch.ResolutionNote != nil && len(strings.TrimSpace(*patch.ResolutionNote)) > 5000 {
		return errors.New("resolution note must be 5,000 characters or fewer")
	}
	return nil
}

func ValidateNotification(input NotificationInput) error {
	if strings.TrimSpace(input.UserID) == "" {
		return errors.New("notification user is required")
	}
	if value := strings.TrimSpace(input.Type); value == "" || len(value) > 80 {
		return errors.New("notification type is required and must be 80 characters or fewer")
	}
	if value := strings.TrimSpace(input.Title); value == "" || len(value) > 160 {
		return errors.New("notification title is required and must be 160 characters or fewer")
	}
	if value := strings.TrimSpace(input.Body); value == "" || len(value) > 2000 {
		return errors.New("notification body is required and must be 2,000 characters or fewer")
	}
	if (strings.TrimSpace(input.EntityType) == "") != (strings.TrimSpace(input.EntityID) == "") {
		return errors.New("notification entity type and id must be provided together")
	}
	if len(strings.TrimSpace(input.EntityType)) > 80 {
		return errors.New("notification entity type must be 80 characters or fewer")
	}
	if len(bytes.TrimSpace(input.Payload)) > 0 && !json.Valid(input.Payload) {
		return errors.New("notification payload must be valid JSON")
	}
	return nil
}

func (r *PostgresRepository) ListReports(ctx context.Context, filter QueueFilter) ([]Report, error) {
	if err := ValidateQueueFilter(filter); err != nil {
		return nil, err
	}

	rows, err := r.pool.Query(ctx, `
		SELECT `+reportColumns+`
		FROM reports
		WHERE deleted_at IS NULL
		  AND ($1 = '' OR status = $1)
		ORDER BY created_at, id
		LIMIT $2
	`, filter.Status, pageLimit(filter.Limit))
	if err != nil {
		return nil, fmt.Errorf("list reports: %w", err)
	}
	defer rows.Close()

	reports := make([]Report, 0)
	for rows.Next() {
		report, scanErr := scanReport(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan report: %w", scanErr)
		}
		reports = append(reports, report)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reports: %w", err)
	}
	return reports, nil
}

func (r *PostgresRepository) PatchReport(ctx context.Context, id string, patch QueuePatch) (Report, error) {
	id = strings.TrimSpace(id)
	patch = normalizeQueuePatch(patch)
	if id == "" {
		return Report{}, ErrQueueItemNotFound
	}
	if err := ValidateQueuePatch(patch); err != nil {
		return Report{}, err
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Report{}, fmt.Errorf("begin report patch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	current, err := scanReport(tx.QueryRow(ctx, `
		SELECT `+reportColumns+`
		FROM reports
		WHERE id = $1::uuid AND deleted_at IS NULL
		FOR UPDATE
	`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Report{}, ErrQueueItemNotFound
	}
	if err != nil {
		return Report{}, fmt.Errorf("get report for patch: %w", err)
	}

	nextStatus, nextAssignee, nextNote := applyQueuePatch(current.Status, current.AssignedToUserID, current.ResolutionNote, patch)
	if queueStateEqual(current.Status, current.AssignedToUserID, current.ResolutionNote, nextStatus, nextAssignee, nextNote) {
		return Report{}, ErrNoChanges
	}
	nextRetentionStartedAt := retentionStartedAtForTransition(
		current.Status, nextStatus, current.RetentionStartedAt, time.Now().UTC(),
	)

	updated, err := scanReport(tx.QueryRow(ctx, `
		UPDATE reports
		SET status = $2,
		    assigned_to_user_id = NULLIF($3, '')::uuid,
		    resolution_note = $4,
		    retention_started_at = $5
		WHERE id = $1::uuid
		RETURNING `+reportColumns+`
	`, id, nextStatus, nullableValue(nextAssignee), nextNote, nextRetentionStartedAt))
	if err != nil {
		return Report{}, fmt.Errorf("patch report: %w", err)
	}
	if err := insertQueueAudit(ctx, tx, patch.ActorUserID, "report.updated", "report", id,
		current.Status, current.AssignedToUserID, current.ResolutionNote, current.RetentionStartedAt,
		updated.Status, updated.AssignedToUserID, updated.ResolutionNote, updated.RetentionStartedAt); err != nil {
		return Report{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Report{}, fmt.Errorf("commit report patch: %w", err)
	}
	return updated, nil
}

func (r *PostgresRepository) ListSupportTickets(ctx context.Context, filter QueueFilter) ([]SupportTicket, error) {
	if err := ValidateQueueFilter(filter); err != nil {
		return nil, err
	}

	rows, err := r.pool.Query(ctx, `
		SELECT `+supportTicketColumns+`
		FROM support_tickets
		WHERE deleted_at IS NULL
		  AND ($1 = '' OR status = $1)
		ORDER BY created_at, id
		LIMIT $2
	`, filter.Status, pageLimit(filter.Limit))
	if err != nil {
		return nil, fmt.Errorf("list support tickets: %w", err)
	}
	defer rows.Close()

	tickets := make([]SupportTicket, 0)
	for rows.Next() {
		ticket, scanErr := scanSupportTicket(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan support ticket: %w", scanErr)
		}
		tickets = append(tickets, ticket)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate support tickets: %w", err)
	}
	return tickets, nil
}

func (r *PostgresRepository) PatchSupportTicket(ctx context.Context, id string, patch QueuePatch) (SupportTicket, error) {
	id = strings.TrimSpace(id)
	patch = normalizeQueuePatch(patch)
	if id == "" {
		return SupportTicket{}, ErrQueueItemNotFound
	}
	if err := ValidateQueuePatch(patch); err != nil {
		return SupportTicket{}, err
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SupportTicket{}, fmt.Errorf("begin support ticket patch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	current, err := scanSupportTicket(tx.QueryRow(ctx, `
		SELECT `+supportTicketColumns+`
		FROM support_tickets
		WHERE id = $1::uuid AND deleted_at IS NULL
		FOR UPDATE
	`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return SupportTicket{}, ErrQueueItemNotFound
	}
	if err != nil {
		return SupportTicket{}, fmt.Errorf("get support ticket for patch: %w", err)
	}

	nextStatus, nextAssignee, nextNote := applyQueuePatch(current.Status, current.AssignedToUserID, current.ResolutionNote, patch)
	if queueStateEqual(current.Status, current.AssignedToUserID, current.ResolutionNote, nextStatus, nextAssignee, nextNote) {
		return SupportTicket{}, ErrNoChanges
	}
	nextRetentionStartedAt := retentionStartedAtForTransition(
		current.Status, nextStatus, current.RetentionStartedAt, time.Now().UTC(),
	)

	updated, err := scanSupportTicket(tx.QueryRow(ctx, `
		UPDATE support_tickets
		SET status = $2,
		    assigned_to_user_id = NULLIF($3, '')::uuid,
		    resolution_note = $4,
		    contact_email = CASE
		        WHEN $2 IN ('resolved', 'closed') AND submitter_deleted_at IS NOT NULL
		            THEN 'deleted@deleted.invalid'
		        ELSE contact_email
		    END,
		    name = CASE
		        WHEN $2 IN ('resolved', 'closed') AND submitter_deleted_at IS NOT NULL
		            THEN ''
		        ELSE name
		    END,
		    retention_started_at = $5
		WHERE id = $1::uuid
		RETURNING `+supportTicketColumns+`
	`, id, nextStatus, nullableValue(nextAssignee), nextNote, nextRetentionStartedAt))
	if err != nil {
		return SupportTicket{}, fmt.Errorf("patch support ticket: %w", err)
	}
	if err := insertQueueAudit(ctx, tx, patch.ActorUserID, "support_ticket.updated", "support_ticket", id,
		current.Status, current.AssignedToUserID, current.ResolutionNote, current.RetentionStartedAt,
		updated.Status, updated.AssignedToUserID, updated.ResolutionNote, updated.RetentionStartedAt); err != nil {
		return SupportTicket{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SupportTicket{}, fmt.Errorf("commit support ticket patch: %w", err)
	}
	return updated, nil
}

func (r *PostgresRepository) ListAuditHistory(ctx context.Context, entityType string, entityID string, limit int) ([]AuditEntry, error) {
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	if entityType == "" || len(entityType) > 80 {
		return nil, errors.New("audit entity type is required and must be 80 characters or fewer")
	}
	if entityID == "" {
		return nil, errors.New("audit entity id is required")
	}
	if limit < 0 {
		return nil, errors.New("audit limit cannot be negative")
	}

	rows, err := r.pool.Query(ctx, `
		SELECT id::text, actor_user_id::text, action, entity_type, entity_id::text,
		       before_json, after_json, metadata, created_at
		FROM audit_logs
		WHERE entity_type = $1 AND entity_id = $2::uuid
		ORDER BY created_at DESC, id DESC
		LIMIT $3
	`, entityType, entityID, pageLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("list audit history: %w", err)
	}
	defer rows.Close()

	entries := make([]AuditEntry, 0)
	for rows.Next() {
		entry, scanErr := scanAuditEntry(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan audit entry: %w", scanErr)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit history: %w", err)
	}
	return entries, nil
}

func (r *PostgresRepository) CreateNotification(ctx context.Context, input NotificationInput) (Notification, error) {
	input = normalizeNotification(input)
	if err := ValidateNotification(input); err != nil {
		return Notification{}, err
	}

	payload := input.Payload
	if len(bytes.TrimSpace(payload)) == 0 {
		payload = json.RawMessage(`{}`)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Notification{}, fmt.Errorf("begin notification create: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var active bool
	if err := tx.QueryRow(ctx, `
		SELECT TRUE
		FROM users
		WHERE id = $1::uuid
		  AND account_status = 'active'
		  AND deleted_at IS NULL
		FOR UPDATE
	`, input.UserID).Scan(&active); errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrNotificationUserMissing
	} else if err != nil {
		return Notification{}, fmt.Errorf("lock notification user: %w", err)
	}

	notification, err := scanNotification(tx.QueryRow(ctx, `
		INSERT INTO notifications (
			user_id, type, title, body, entity_type, entity_id, payload
		)
		VALUES ($1::uuid, $2, $3, $4, NULLIF($5, ''), NULLIF($6, '')::uuid, $7::jsonb)
		RETURNING `+notificationColumns+`
	`, input.UserID, input.Type, input.Title, input.Body, input.EntityType, input.EntityID, payload))
	if err != nil {
		return Notification{}, fmt.Errorf("create notification: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Notification{}, fmt.Errorf("commit notification create: %w", err)
	}
	return notification, nil
}

func (r *PostgresRepository) ListNotifications(ctx context.Context, userID string, filter NotificationFilter) ([]Notification, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, errors.New("notification user is required")
	}
	if filter.Limit < 0 {
		return nil, errors.New("notification limit cannot be negative")
	}

	rows, err := r.pool.Query(ctx, `
		SELECT `+notificationColumns+`
		FROM notifications
		WHERE user_id = $1::uuid
		  AND (NOT $2 OR read_at IS NULL)
		ORDER BY created_at DESC, id DESC
		LIMIT $3
	`, userID, filter.UnreadOnly, pageLimit(filter.Limit))
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	notifications := make([]Notification, 0)
	for rows.Next() {
		notification, scanErr := scanNotification(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan notification: %w", scanErr)
		}
		notifications = append(notifications, notification)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notifications: %w", err)
	}
	return notifications, nil
}

func (r *PostgresRepository) MarkNotificationRead(ctx context.Context, userID string, notificationID string) (Notification, error) {
	userID = strings.TrimSpace(userID)
	notificationID = strings.TrimSpace(notificationID)
	if userID == "" || notificationID == "" {
		return Notification{}, ErrNotificationNotFound
	}

	notification, err := scanNotification(r.pool.QueryRow(ctx, `
		UPDATE notifications
		SET read_at = COALESCE(read_at, NOW())
		WHERE id = $1::uuid AND user_id = $2::uuid
		RETURNING `+notificationColumns+`
	`, notificationID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrNotificationNotFound
	}
	if err != nil {
		return Notification{}, fmt.Errorf("mark notification read: %w", err)
	}
	return notification, nil
}

func validQueueStatus(status QueueStatus) bool {
	switch status {
	case QueueStatusOpen, QueueStatusInReview, QueueStatusResolved, QueueStatusClosed:
		return true
	default:
		return false
	}
}

func normalizeQueuePatch(patch QueuePatch) QueuePatch {
	patch.ActorUserID = strings.TrimSpace(patch.ActorUserID)
	if patch.Status != nil {
		status := QueueStatus(strings.TrimSpace(string(*patch.Status)))
		patch.Status = &status
	}
	if patch.AssignedToUserID != nil {
		assignee := strings.TrimSpace(*patch.AssignedToUserID)
		patch.AssignedToUserID = &assignee
	}
	if patch.ResolutionNote != nil {
		note := strings.TrimSpace(*patch.ResolutionNote)
		patch.ResolutionNote = &note
	}
	return patch
}

func normalizeNotification(input NotificationInput) NotificationInput {
	input.UserID = strings.TrimSpace(input.UserID)
	input.Type = strings.TrimSpace(input.Type)
	input.Title = strings.TrimSpace(input.Title)
	input.Body = strings.TrimSpace(input.Body)
	input.EntityType = strings.TrimSpace(input.EntityType)
	input.EntityID = strings.TrimSpace(input.EntityID)
	input.Payload = bytes.TrimSpace(input.Payload)
	return input
}

func pageLimit(limit int) int {
	if limit == 0 {
		return defaultPageLimit
	}
	if limit > maximumPageLimit {
		return maximumPageLimit
	}
	return limit
}

func applyQueuePatch(status QueueStatus, assignee *string, note string, patch QueuePatch) (QueueStatus, *string, string) {
	nextStatus := status
	if patch.Status != nil {
		nextStatus = *patch.Status
	}
	nextAssignee := assignee
	if patch.AssignedToUserID != nil {
		nextAssignee = optionalString(*patch.AssignedToUserID)
	}
	nextNote := note
	if patch.ResolutionNote != nil {
		nextNote = *patch.ResolutionNote
	}
	return nextStatus, nextAssignee, nextNote
}

func queueStateEqual(currentStatus QueueStatus, currentAssignee *string, currentNote string, nextStatus QueueStatus, nextAssignee *string, nextNote string) bool {
	return currentStatus == nextStatus && optionalStringEqual(currentAssignee, nextAssignee) && currentNote == nextNote
}

func retentionStartedAtForTransition(
	currentStatus QueueStatus,
	nextStatus QueueStatus,
	current *time.Time,
	now time.Time,
) *time.Time {
	if !terminalQueueStatus(nextStatus) {
		return nil
	}
	if terminalQueueStatus(currentStatus) {
		return current
	}
	startedAt := now
	return &startedAt
}

func terminalQueueStatus(status QueueStatus) bool {
	return status == QueueStatusResolved || status == QueueStatusClosed
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func nullableValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func optionalStringEqual(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

type queueAuditState struct {
	Status             QueueStatus `json:"status"`
	AssignedToUserID   *string     `json:"assigned_to_user_id"`
	ResolutionNote     string      `json:"resolution_note"`
	RetentionStartedAt *time.Time  `json:"retention_started_at"`
}

func insertQueueAudit(
	ctx context.Context,
	tx pgx.Tx,
	actorUserID string,
	action string,
	entityType string,
	entityID string,
	beforeStatus QueueStatus,
	beforeAssignee *string,
	beforeNote string,
	beforeRetentionStartedAt *time.Time,
	afterStatus QueueStatus,
	afterAssignee *string,
	afterNote string,
	afterRetentionStartedAt *time.Time,
) error {
	before, err := json.Marshal(queueAuditState{
		Status: beforeStatus, AssignedToUserID: beforeAssignee, ResolutionNote: beforeNote,
		RetentionStartedAt: beforeRetentionStartedAt,
	})
	if err != nil {
		return fmt.Errorf("marshal audit before state: %w", err)
	}
	after, err := json.Marshal(queueAuditState{
		Status: afterStatus, AssignedToUserID: afterAssignee, ResolutionNote: afterNote,
		RetentionStartedAt: afterRetentionStartedAt,
	})
	if err != nil {
		return fmt.Errorf("marshal audit after state: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (
			actor_user_id, action, entity_type, entity_id, before_json, after_json
		)
		VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6::jsonb)
	`, actorUserID, action, entityType, entityID, before, after); err != nil {
		return fmt.Errorf("write queue audit: %w", err)
	}
	return nil
}

func scanReport(row pgx.Row) (Report, error) {
	var report Report
	err := row.Scan(
		&report.ID,
		&report.ReporterUserID,
		&report.TargetType,
		&report.TargetID,
		&report.Reason,
		&report.Status,
		&report.AssignedToUserID,
		&report.ResolutionNote,
		&report.RetentionStartedAt,
		&report.CreatedAt,
		&report.UpdatedAt,
	)
	return report, err
}

func scanSupportTicket(row pgx.Row) (SupportTicket, error) {
	var ticket SupportTicket
	err := row.Scan(
		&ticket.ID,
		&ticket.SubmitterUserID,
		&ticket.SubmitterDeletedAt,
		&ticket.ContactEmail,
		&ticket.Name,
		&ticket.Subject,
		&ticket.Message,
		&ticket.Status,
		&ticket.AssignedToUserID,
		&ticket.ResolutionNote,
		&ticket.RetentionStartedAt,
		&ticket.CreatedAt,
		&ticket.UpdatedAt,
	)
	return ticket, err
}

func scanAuditEntry(row pgx.Row) (AuditEntry, error) {
	var entry AuditEntry
	var before, after, metadata []byte
	err := row.Scan(
		&entry.ID,
		&entry.ActorUserID,
		&entry.Action,
		&entry.EntityType,
		&entry.EntityID,
		&before,
		&after,
		&metadata,
		&entry.CreatedAt,
	)
	entry.Before = json.RawMessage(before)
	entry.After = json.RawMessage(after)
	entry.Metadata = json.RawMessage(metadata)
	return entry, err
}

func scanNotification(row pgx.Row) (Notification, error) {
	var notification Notification
	var payload []byte
	err := row.Scan(
		&notification.ID,
		&notification.UserID,
		&notification.Type,
		&notification.Title,
		&notification.Body,
		&notification.EntityType,
		&notification.EntityID,
		&payload,
		&notification.ReadAt,
		&notification.CreatedAt,
	)
	notification.Payload = json.RawMessage(payload)
	return notification, err
}
