package httpapi

import (
	"errors"
	"net/http"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
)

type supportTicketRequest struct {
	ContactEmail string `json:"contact_email"`
	Name         string `json:"name"`
	Subject      string `json:"subject"`
	Message      string `json:"message"`
}

type reportRequest struct {
	Reason string `json:"reason"`
}

func (r *Router) handleSupportTickets(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/support-tickets" {
		http.NotFound(w, req)
		return
	}
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.safety == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.allow("support-ticket", req) {
		rateLimitExceeded(w, r)
		return
	}

	var request supportTicketRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	userID, _ := auth.UserID(req.Context())
	ticket, err := r.safety.CreateSupportTicket(req.Context(), safety.SupportTicketInput{
		SubmitterUserID: userID,
		ContactEmail:    request.ContactEmail,
		Name:            request.Name,
		Subject:         request.Subject,
		Message:         request.Message,
	})
	if err != nil {
		writeSafetyMutationError(w, err, "support_ticket_failed")
		return
	}
	writeJSON(w, http.StatusCreated, ticket)
}

func (r *Router) handleReportEvent(w http.ResponseWriter, req *http.Request, slug string) {
	if r.safety == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allow("report-event:"+userID, req) {
		rateLimitExceeded(w, r)
		return
	}

	var request reportRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	report, err := r.safety.ReportEvent(req.Context(), userID, slug, request.Reason)
	if err != nil {
		writeSafetyMutationError(w, err, "report_failed")
		return
	}
	writeJSON(w, http.StatusCreated, report)
}

func (r *Router) handleReportUser(w http.ResponseWriter, req *http.Request, targetUserID string) {
	if r.safety == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allow("report-user:"+userID, req) {
		rateLimitExceeded(w, r)
		return
	}

	var request reportRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	report, err := r.safety.ReportUser(req.Context(), userID, targetUserID, request.Reason)
	if err != nil {
		writeSafetyMutationError(w, err, "report_failed")
		return
	}
	writeJSON(w, http.StatusCreated, report)
}

func writeSafetyMutationError(w http.ResponseWriter, err error, fallbackCode string) {
	switch {
	case errors.Is(err, safety.ErrReportTargetNotFound):
		writeError(w, http.StatusNotFound, "report_target_not_found")
	case errors.Is(err, safety.ErrCannotReportSelf):
		writeError(w, http.StatusBadRequest, "cannot_report_self")
	case isValidationError(err):
		writeError(w, http.StatusBadRequest, "invalid_request")
	default:
		writeError(w, http.StatusInternalServerError, fallbackCode)
	}
}
