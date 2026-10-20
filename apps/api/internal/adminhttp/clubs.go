package adminhttp

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/operations"
)

// AdminClubs is the club store the Admin API needs: named commands only.
type AdminClubs interface {
	ListAdmin(context.Context, adminmutation.Filter) ([]clubs.AdminClub, error)
	GetAdmin(context.Context, string) (clubs.AdminClub, error)
	CreateAdmin(context.Context, clubs.AdminCreate) (clubs.AdminClub, error)
	UpdateAdmin(context.Context, string, clubs.AdminEdit) (clubs.AdminClub, error)
	ReplaceLinks(context.Context, string, clubs.LinksEdit) (clubs.AdminClub, error)
	HideAdmin(context.Context, string, adminmutation.Command) (clubs.AdminClub, error)
	UnhideAdmin(context.Context, string, adminmutation.Command) (clubs.AdminClub, error)
	MarkCheckedAdmin(context.Context, string, adminmutation.Command) (clubs.AdminClub, error)
	RemoveMemberAdmin(context.Context, string, clubs.MemberRemoval) (clubs.AdminClub, error)
	ListClaims(context.Context, string, adminmutation.Filter) ([]clubs.AdminClaimSummary, error)
	GetClaim(context.Context, string) (clubs.AdminClaim, error)
	ApproveClaim(context.Context, string, clubs.ClaimApproval) (clubs.AdminClaim, error)
	RejectClaim(context.Context, string, adminmutation.Command) (clubs.AdminClaim, error)
}

var clubRoutes = []routePolicy{
	{Method: "GET", Path: "/admin/v1/clubs", Control: controlCapability, Capability: adminaccess.CapabilityClubsRead, Operation: "clubs.list"},
	{Method: "POST", Path: "/admin/v1/clubs", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.create"},
	{Method: "GET", Path: "/admin/v1/clubs/{id}", Control: controlCapability, Capability: adminaccess.CapabilityClubsRead, Operation: "clubs.get"},
	{Method: "PATCH", Path: "/admin/v1/clubs/{id}", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.update"},
	{Method: "POST", Path: "/admin/v1/clubs/{id}/links", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.links"},
	{Method: "POST", Path: "/admin/v1/clubs/{id}/hide", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.hide"},
	{Method: "POST", Path: "/admin/v1/clubs/{id}/unhide", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.unhide"},
	{Method: "POST", Path: "/admin/v1/clubs/{id}/remove-member", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.remove_member"},
	{Method: "POST", Path: "/admin/v1/clubs/{id}/mark-checked", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "clubs.check"},
	{Method: "GET", Path: "/admin/v1/clubs/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "clubs.audit"},
	{Method: "GET", Path: "/admin/v1/club-claims", Control: controlCapability, Capability: adminaccess.CapabilityClubsRead, Operation: "club_claims.list"},
	{Method: "GET", Path: "/admin/v1/club-claims/{id}", Control: controlCapability, Capability: adminaccess.CapabilityClubsRead, Operation: "club_claims.get"},
	{Method: "POST", Path: "/admin/v1/club-claims/{id}/approve", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "club_claims.approve"},
	{Method: "POST", Path: "/admin/v1/club-claims/{id}/reject", Control: controlCapability, Capability: adminaccess.CapabilityClubsManage, Mutation: true, Operation: "club_claims.reject"},
	{Method: "GET", Path: "/admin/v1/club-claims/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "club_claims.audit"},
}

// clubsHandler serves the club routes. Every mutation is one named command
// that validates, checks the version, and audits inside its transaction.
func (handler *Handler) clubsHandler(operation routeOperation, id string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		actor, ok := ActorFromContext(req.Context())
		deps := handler.dependencies.Catalog
		if !ok || deps == nil || deps.Clubs == nil {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		if id != "" && !validAdminUUID(id) {
			writeAdminApplicationError(w, req, adminmutation.ErrNotFound, "admin_unavailable")
			return
		}
		if req.Method == http.MethodGet {
			handler.clubsRead(w, req, actor, operation, id)
			return
		}
		correlation := adminaudit.Correlation{ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req)}
		var result clubs.AdminClub
		var err error
		status := http.StatusOK
		switch operation {
		case "clubs.create":
			var input clubs.AdminCreate
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Clubs.CreateAdmin(req.Context(), input)
			status = http.StatusCreated
		case "clubs.update":
			var input clubs.AdminEdit
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Clubs.UpdateAdmin(req.Context(), id, input)
		case "clubs.links":
			var input clubs.LinksEdit
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Clubs.ReplaceLinks(req.Context(), id, input)
		case "clubs.remove_member":
			var input clubs.MemberRemoval
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Clubs.RemoveMemberAdmin(req.Context(), id, input)
		case "clubs.hide", "clubs.unhide", "clubs.check":
			var command adminmutation.Command
			if err = decodeAdminJSON(w, req, &command); err != nil {
				break
			}
			command.Correlation = correlation
			switch operation {
			case "clubs.hide":
				result, err = deps.Clubs.HideAdmin(req.Context(), id, command)
			case "clubs.unhide":
				result, err = deps.Clubs.UnhideAdmin(req.Context(), id, command)
			default:
				result, err = deps.Clubs.MarkCheckedAdmin(req.Context(), id, command)
			}
		default:
			http.NotFound(w, req)
			return
		}
		if err != nil {
			if errors.Is(err, adminmutation.ErrConflict) && id != "" {
				if current, readErr := deps.Clubs.GetAdmin(req.Context(), id); readErr == nil {
					writeJSON(w, http.StatusConflict, map[string]any{"error": "admin_record_conflict", "current": current})
					return
				}
			}
			writeAdminApplicationError(w, req, err, "admin_mutation_failed")
			return
		}
		writeJSON(w, status, result)
	})
}

func (handler *Handler) clubsRead(w http.ResponseWriter, req *http.Request, actor Actor, operation routeOperation, id string) {
	deps := handler.dependencies.Catalog
	if err := handler.recordSensitiveRead(req, actor, "admin_catalog", string(operation)); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	var result any
	var err error
	switch operation {
	case "clubs.get":
		result, err = deps.Clubs.GetAdmin(req.Context(), id)
	case "clubs.audit":
		if deps.Audit == nil {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		if _, err = deps.Clubs.GetAdmin(req.Context(), id); err != nil {
			break
		}
		var filter operations.AuditFilter
		if filter, err = parseAuditFilter(req.URL.Query()); err != nil {
			break
		}
		var entries []adminaudit.Entry
		entries, err = deps.Audit.List(req.Context(), adminaudit.ListParams{EntityType: adminaudit.EntityClub, EntityID: id, Limit: filter.Limit + 1, After: filter.After, Before: filter.Before})
		if err == nil {
			result = catalogPage("audit_entries", entries, adminmutation.Filter{Limit: filter.Limit, After: filter.After, Before: filter.Before}, func(e adminaudit.Entry) (time.Time, string) { return e.CreatedAt, e.ID })
		}
	case "clubs.list":
		var filter adminmutation.Filter
		if filter, err = parseCatalogFilter(req, "school"); err != nil {
			break
		}
		filter.School = req.URL.Query().Get("school")
		if err = filter.Validate(); err != nil {
			break
		}
		query := filter
		query.Limit++
		var items []clubs.AdminClub
		items, err = deps.Clubs.ListAdmin(req.Context(), query)
		result = catalogPage("clubs", items, filter, func(c clubs.AdminClub) (time.Time, string) { return c.CreatedAt, c.ID })
	default:
		http.NotFound(w, req)
		return
	}
	if err != nil {
		writeAdminApplicationError(w, req, err, "admin_query_failed")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// clubClaimsHandler serves the claim review routes. Approving and rejecting
// are named commands that check the claim's version and audit the decision.
func (handler *Handler) clubClaimsHandler(operation routeOperation, id string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		actor, ok := ActorFromContext(req.Context())
		deps := handler.dependencies.Catalog
		if !ok || deps == nil || deps.Clubs == nil {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		if id != "" && !validAdminUUID(id) {
			writeAdminApplicationError(w, req, adminmutation.ErrNotFound, "admin_unavailable")
			return
		}
		if req.Method == http.MethodGet {
			handler.clubClaimsRead(w, req, actor, operation, id)
			return
		}
		correlation := adminaudit.Correlation{ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req)}
		var result clubs.AdminClaim
		var err error
		switch operation {
		case "club_claims.approve":
			var input clubs.ClaimApproval
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Clubs.ApproveClaim(req.Context(), id, input)
		case "club_claims.reject":
			var command adminmutation.Command
			if err = decodeAdminJSON(w, req, &command); err != nil {
				break
			}
			command.Correlation = correlation
			result, err = deps.Clubs.RejectClaim(req.Context(), id, command)
		default:
			http.NotFound(w, req)
			return
		}
		if err != nil {
			if errors.Is(err, adminmutation.ErrConflict) {
				if current, readErr := deps.Clubs.GetClaim(req.Context(), id); readErr == nil {
					writeJSON(w, http.StatusConflict, map[string]any{"error": "admin_record_conflict", "current": current})
					return
				}
			}
			writeAdminApplicationError(w, req, err, "admin_mutation_failed")
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

func (handler *Handler) clubClaimsRead(w http.ResponseWriter, req *http.Request, actor Actor, operation routeOperation, id string) {
	deps := handler.dependencies.Catalog
	if err := handler.recordSensitiveRead(req, actor, "club_claim", string(operation)); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_security_event_unavailable")
		return
	}
	var result any
	var err error
	switch operation {
	case "club_claims.get":
		result, err = deps.Clubs.GetClaim(req.Context(), id)
	case "club_claims.audit":
		if deps.Audit == nil {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		if _, err = deps.Clubs.GetClaim(req.Context(), id); err != nil {
			break
		}
		var filter operations.AuditFilter
		if filter, err = parseAuditFilter(req.URL.Query()); err != nil {
			break
		}
		var entries []adminaudit.Entry
		entries, err = deps.Audit.List(req.Context(), adminaudit.ListParams{EntityType: adminaudit.EntityClubClaim, EntityID: id, Limit: filter.Limit + 1, After: filter.After, Before: filter.Before})
		if err == nil {
			result = catalogPage("audit_entries", entries, adminmutation.Filter{Limit: filter.Limit, After: filter.After, Before: filter.Before}, func(e adminaudit.Entry) (time.Time, string) { return e.CreatedAt, e.ID })
		}
	case "club_claims.list":
		var filter adminmutation.Filter
		if filter, err = parseCatalogFilter(req, "status"); err != nil {
			break
		}
		query := filter
		query.Limit++
		var items []clubs.AdminClaimSummary
		items, err = deps.Clubs.ListClaims(req.Context(), req.URL.Query().Get("status"), query)
		result = catalogPage("claims", items, filter, func(c clubs.AdminClaimSummary) (time.Time, string) { return c.CreatedAt, c.ID })
	default:
		http.NotFound(w, req)
		return
	}
	if err != nil {
		writeAdminApplicationError(w, req, err, "admin_query_failed")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
