package adminhttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/operations"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

const (
	defaultAdminListLimit = 50
	maximumAdminListLimit = 100
	maximumPatchBodyBytes = 16 << 10
)

type queuePatchRequest struct {
	ExpectedUpdatedAt time.Time               `json:"expected_updated_at"`
	Status            *operations.QueueStatus `json:"status"`
	AssignedToUserID  *string                 `json:"assigned_to_user_id"`
	ResolutionNote    *string                 `json:"resolution_note"`
}

type cursorPage[T any] struct {
	Items          []T
	NextCursor     string
	PreviousCursor string
}

func (handler *Handler) operationHandler(operation routeOperation, entityID string) http.Handler {
	switch operation {
	case operationCurrentSession:
		return http.HandlerFunc(handler.currentSession)
	case operationListReports:
		return http.HandlerFunc(handler.listReports)
	case operationGetReport:
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.getReport(w, req, entityID)
		})
	case operationPatchReport:
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.patchReport(w, req, entityID)
		})
	case operationListReportAudit:
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.listAuditHistory(w, req, operationsEntityReport, entityID)
		})
	case operationListSupport:
		return http.HandlerFunc(handler.listSupportTickets)
	case operationGetSupport:
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.getSupportTicket(w, req, entityID)
		})
	case operationPatchSupport:
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.patchSupportTicket(w, req, entityID)
		})
	case operationListSupportAudit:
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.listAuditHistory(w, req, operationsEntitySupportTicket, entityID)
		})
	default:
		return http.NotFoundHandler()
	}
}

const (
	operationsEntityReport        = "report"
	operationsEntitySupportTicket = "support_ticket"
)

func (handler *Handler) listReports(w http.ResponseWriter, req *http.Request) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	filter, err := parseQueueFilter(req.URL.Query())
	if err != nil {
		writeAdminApplicationError(w, err, "reports_unavailable")
		return
	}
	limit := filter.Limit
	filter.Limit++
	reports, err := handler.dependencies.Operations.ListReports(req.Context(), filter)
	if err != nil {
		writeAdminApplicationError(w, err, "reports_unavailable")
		return
	}
	page := makeCursorPage(reports, limit, filter.After, filter.Before, func(report operations.Report) (time.Time, string) {
		return report.CreatedAt, report.ID
	})
	if err := handler.recordSensitiveRead(req, actor, operationsEntityReport, "list"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"reports":         page.Items,
		"next_cursor":     page.NextCursor,
		"previous_cursor": page.PreviousCursor,
	})
}

func (handler *Handler) getReport(w http.ResponseWriter, req *http.Request, id string) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	if !validAdminUUID(id) {
		writeError(w, http.StatusNotFound, "queue_item_not_found")
		return
	}
	report, err := handler.dependencies.Operations.GetReport(req.Context(), id)
	if err != nil {
		writeAdminApplicationError(w, err, "report_unavailable")
		return
	}
	if err := handler.recordSensitiveRead(req, actor, operationsEntityReport, "read"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (handler *Handler) patchReport(w http.ResponseWriter, req *http.Request, id string) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	if !validAdminUUID(id) {
		writeError(w, http.StatusNotFound, "queue_item_not_found")
		return
	}
	var input queuePatchRequest
	if err := decodeAdminJSON(w, req, &input); err != nil {
		writeAdminApplicationError(w, err, "report_update_failed")
		return
	}
	report, err := handler.dependencies.Operations.PatchReport(req.Context(), id, operations.QueuePatch{
		ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req),
		ExpectedUpdatedAt: input.ExpectedUpdatedAt, Status: input.Status,
		AssignedToUserID: input.AssignedToUserID, ResolutionNote: input.ResolutionNote,
	})
	if err != nil {
		writeAdminApplicationError(w, err, "report_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (handler *Handler) listSupportTickets(w http.ResponseWriter, req *http.Request) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	filter, err := parseQueueFilter(req.URL.Query())
	if err != nil {
		writeAdminApplicationError(w, err, "support_tickets_unavailable")
		return
	}
	limit := filter.Limit
	filter.Limit++
	tickets, err := handler.dependencies.Operations.ListSupportTickets(req.Context(), filter)
	if err != nil {
		writeAdminApplicationError(w, err, "support_tickets_unavailable")
		return
	}
	page := makeCursorPage(tickets, limit, filter.After, filter.Before, func(ticket operations.SupportTicket) (time.Time, string) {
		return ticket.CreatedAt, ticket.ID
	})
	if err := handler.recordSensitiveRead(req, actor, operationsEntitySupportTicket, "list"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"support_tickets": page.Items,
		"next_cursor":     page.NextCursor,
		"previous_cursor": page.PreviousCursor,
	})
}

func (handler *Handler) getSupportTicket(w http.ResponseWriter, req *http.Request, id string) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	if !validAdminUUID(id) {
		writeError(w, http.StatusNotFound, "queue_item_not_found")
		return
	}
	ticket, err := handler.dependencies.Operations.GetSupportTicket(req.Context(), id)
	if err != nil {
		writeAdminApplicationError(w, err, "support_ticket_unavailable")
		return
	}
	if err := handler.recordSensitiveRead(req, actor, operationsEntitySupportTicket, "read"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (handler *Handler) patchSupportTicket(w http.ResponseWriter, req *http.Request, id string) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	if !validAdminUUID(id) {
		writeError(w, http.StatusNotFound, "queue_item_not_found")
		return
	}
	var input queuePatchRequest
	if err := decodeAdminJSON(w, req, &input); err != nil {
		writeAdminApplicationError(w, err, "support_ticket_update_failed")
		return
	}
	ticket, err := handler.dependencies.Operations.PatchSupportTicket(req.Context(), id, operations.QueuePatch{
		ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req),
		ExpectedUpdatedAt: input.ExpectedUpdatedAt, Status: input.Status,
		AssignedToUserID: input.AssignedToUserID, ResolutionNote: input.ResolutionNote,
	})
	if err != nil {
		writeAdminApplicationError(w, err, "support_ticket_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (handler *Handler) listAuditHistory(w http.ResponseWriter, req *http.Request, entityType string, entityID string) {
	actor, ok := ActorFromContext(req.Context())
	if !ok || handler.dependencies.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	if !validAdminUUID(entityID) {
		writeError(w, http.StatusNotFound, "queue_item_not_found")
		return
	}
	if entityType == operationsEntityReport {
		if _, err := handler.dependencies.Operations.GetReport(req.Context(), entityID); err != nil {
			writeAdminApplicationError(w, err, "audit_history_unavailable")
			return
		}
	} else if _, err := handler.dependencies.Operations.GetSupportTicket(req.Context(), entityID); err != nil {
		writeAdminApplicationError(w, err, "audit_history_unavailable")
		return
	}
	filter, err := parseAuditFilter(req.URL.Query())
	if err != nil {
		writeAdminApplicationError(w, err, "audit_history_unavailable")
		return
	}
	limit := filter.Limit
	filter.Limit++
	entries, err := handler.dependencies.Operations.ListAuditHistory(req.Context(), entityType, entityID, filter)
	if err != nil {
		writeAdminApplicationError(w, err, "audit_history_unavailable")
		return
	}
	page := makeCursorPage(entries, limit, filter.After, filter.Before, func(entry operations.AuditEntry) (time.Time, string) {
		return entry.CreatedAt, entry.ID
	})
	if err := handler.recordSensitiveRead(req, actor, "audit_log", "list"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"audit_entries":   page.Items,
		"next_cursor":     page.NextCursor,
		"previous_cursor": page.PreviousCursor,
	})
}

func parseQueueFilter(values url.Values) (operations.QueueFilter, error) {
	if err := validateQueryKeys(values, map[string]struct{}{
		"status": {}, "assignee": {}, "limit": {}, "after": {}, "before": {},
	}); err != nil {
		return operations.QueueFilter{}, err
	}
	filter := operations.QueueFilter{Status: operations.QueueStatus(values.Get("status"))}
	if assignee := strings.TrimSpace(values.Get("assignee")); assignee != "" {
		if assignee == "unassigned" {
			empty := ""
			filter.AssignedToUserID = &empty
		} else if validAdminUUID(assignee) {
			filter.AssignedToUserID = &assignee
		} else {
			return operations.QueueFilter{}, apperror.Validation("invalid queue assignee")
		}
	}
	limit, after, before, err := parsePagination(values)
	if err != nil {
		return operations.QueueFilter{}, err
	}
	filter.Limit = limit
	filter.After = after
	filter.Before = before
	if err := operations.ValidateQueueFilter(filter); err != nil {
		return operations.QueueFilter{}, err
	}
	return filter, nil
}

func parseAuditFilter(values url.Values) (operations.AuditFilter, error) {
	if err := validateQueryKeys(values, map[string]struct{}{
		"limit": {}, "after": {}, "before": {},
	}); err != nil {
		return operations.AuditFilter{}, err
	}
	limit, after, before, err := parsePagination(values)
	if err != nil {
		return operations.AuditFilter{}, err
	}
	return operations.AuditFilter{Limit: limit, After: after, Before: before}, nil
}

func parsePagination(values url.Values) (int, *pagecursor.Cursor, *pagecursor.Cursor, error) {
	limit := defaultAdminListLimit
	if raw := values.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maximumAdminListLimit {
			return 0, nil, nil, apperror.Validation("invalid pagination limit")
		}
		limit = parsed
	}
	if values.Get("after") != "" && values.Get("before") != "" {
		return 0, nil, nil, apperror.Wrap(apperror.KindValidation, "invalid_cursor", pagecursor.ErrInvalid)
	}
	var after, before *pagecursor.Cursor
	if raw := values.Get("after"); raw != "" {
		decoded, err := pagecursor.Decode(raw)
		if err != nil {
			return 0, nil, nil, apperror.Wrap(apperror.KindValidation, "invalid_cursor", err)
		}
		after = &decoded
	}
	if raw := values.Get("before"); raw != "" {
		decoded, err := pagecursor.Decode(raw)
		if err != nil {
			return 0, nil, nil, apperror.Wrap(apperror.KindValidation, "invalid_cursor", err)
		}
		before = &decoded
	}
	return limit, after, before, nil
}

func validateQueryKeys(values url.Values, allowed map[string]struct{}) error {
	for key, entries := range values {
		if _, ok := allowed[key]; !ok || len(entries) != 1 {
			return apperror.Validation("invalid query parameters")
		}
	}
	return nil
}

func makeCursorPage[T any](
	items []T,
	limit int,
	after *pagecursor.Cursor,
	before *pagecursor.Cursor,
	key func(T) (time.Time, string),
) cursorPage[T] {
	hasLookahead := len(items) > limit
	if hasLookahead {
		if before != nil {
			items = items[1:]
		} else {
			items = items[:limit]
		}
	}
	page := cursorPage[T]{Items: items}
	if len(items) == 0 {
		return page
	}
	if after != nil || (before != nil && hasLookahead) {
		timestamp, id := key(items[0])
		page.PreviousCursor = pagecursor.Encode(timestamp, id)
	}
	if before != nil || hasLookahead {
		timestamp, id := key(items[len(items)-1])
		page.NextCursor = pagecursor.Encode(timestamp, id)
	}
	return page
}

func decodeAdminJSON(w http.ResponseWriter, req *http.Request, target any) error {
	req.Body = http.MaxBytesReader(w, req.Body, maximumPatchBodyBytes)
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return apperror.Wrap(apperror.KindValidation, "invalid_request", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return apperror.Wrap(apperror.KindValidation, "invalid_request", errors.New("request body must contain one JSON value"))
	}
	return nil
}

func writeAdminApplicationError(w http.ResponseWriter, err error, fallback string) {
	kind, code, ok := apperror.Details(err)
	if !ok {
		writeError(w, http.StatusInternalServerError, fallback)
		return
	}
	status := http.StatusInternalServerError
	switch kind {
	case apperror.KindValidation:
		status = http.StatusBadRequest
	case apperror.KindNotFound:
		status = http.StatusNotFound
	case apperror.KindConflict:
		status = http.StatusConflict
	case apperror.KindAuthentication:
		status = http.StatusUnauthorized
	case apperror.KindAuthorization:
		status = http.StatusForbidden
	case apperror.KindUnprocessable:
		status = http.StatusUnprocessableEntity
	}
	writeError(w, status, code)
}

func (handler *Handler) recordSensitiveRead(req *http.Request, actor Actor, resourceType string, operation string) error {
	if handler.dependencies.Security == nil {
		return errors.New("admin security writer unavailable")
	}
	_, err := handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
		Type: adminsecurity.EventSensitiveRead, Outcome: adminsecurity.OutcomeSucceeded,
		ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req),
		Metadata: adminsecurity.Metadata{ResourceType: resourceType, Operation: operation},
	})
	return err
}

func validAdminUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') ||
			(character >= 'a' && character <= 'f') ||
			(character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}
