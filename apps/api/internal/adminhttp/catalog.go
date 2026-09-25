package adminhttp

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/operations"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

type AdminSchools interface {
	GetAdminGrant(context.Context, string, string) (schools.AdminGrant, error)
	ListAdmin(context.Context, adminmutation.Filter) ([]schools.AdminSchool, error)
	GetAdmin(context.Context, string) (schools.AdminSchool, error)
	CreateAdmin(context.Context, schools.AdminEdit) (schools.AdminSchool, error)
	UpdateAdmin(context.Context, string, schools.AdminEdit) (schools.AdminSchool, error)
	DeactivateAdmin(context.Context, string, adminmutation.Command) (schools.AdminSchool, error)
	ReactivateAdmin(context.Context, string, adminmutation.Command) (schools.AdminSchool, error)
	DeleteAdmin(context.Context, string, adminmutation.Command) (schools.AdminSchool, error)
	ListAdminGrants(context.Context, string, adminmutation.Filter) ([]schools.AdminGrant, error)
	GrantAdmin(context.Context, string, schools.GrantAdminInput) (schools.AdminGrant, error)
	RevokeAdmin(context.Context, string, string, adminmutation.Command) (schools.AdminGrant, error)
}
type AdminGames interface {
	ListAdmin(context.Context, adminmutation.Filter) ([]games.AdminGame, error)
	GetAdmin(context.Context, string) (games.AdminGame, error)
	CreateAdmin(context.Context, games.AdminEdit) (games.AdminGame, error)
	UpdateAdmin(context.Context, string, games.AdminEdit) (games.AdminGame, error)
	DeleteAdmin(context.Context, string, adminmutation.Command) (games.AdminGame, error)
}
type AdminUsers interface {
	ListAdmin(context.Context, adminmutation.Filter) ([]users.AdminUser, error)
	GetAdmin(context.Context, string) (users.AdminUser, error)
	SuspendAdmin(context.Context, string, adminmutation.Command) (users.AdminUser, error)
	ReactivateAdmin(context.Context, string, adminmutation.Command) (users.AdminUser, error)
	ChangeTrustAdmin(context.Context, string, users.TrustChange) (users.AdminUser, error)
}
type AdminSiteGrants interface {
	ListGrants(context.Context, adminmutation.Filter) ([]adminaccess.Grant, error)
	GetGrant(context.Context, string) (adminaccess.Grant, error)
	GrantRole(context.Context, adminaccess.GrantInput) (adminaccess.Grant, error)
	RevokeRole(context.Context, adminaccess.RevokeInput) (adminaccess.Grant, error)
}
type CatalogCache interface {
	Invalidate()
	Refresh(context.Context) error
}
type AuditReader interface {
	List(context.Context, adminaudit.ListParams) ([]adminaudit.Entry, error)
}
type CatalogDependencies struct {
	Schools    AdminSchools
	Games      AdminGames
	Users      AdminUsers
	SiteGrants AdminSiteGrants
	Cache      CatalogCache
	Audit      AuditReader
}

var catalogRoutes = []routePolicy{
	{Method: "GET", Path: "/admin/v1/schools/{id}/admin-grants/{grant_id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "school_grants.audit"},
	{Method: "GET", Path: "/admin/v1/schools", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsRead, Operation: "schools.list"},
	{Method: "POST", Path: "/admin/v1/schools", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsManage, Mutation: true, Operation: "schools.create"},
	{Method: "GET", Path: "/admin/v1/schools/{id}", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsRead, Operation: "schools.get"},
	{Method: "PATCH", Path: "/admin/v1/schools/{id}", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsManage, Mutation: true, Operation: "schools.update"},
	{Method: "POST", Path: "/admin/v1/schools/{id}/deactivate", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsManage, Mutation: true, Operation: "schools.deactivate"},
	{Method: "POST", Path: "/admin/v1/schools/{id}/reactivate", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsManage, Mutation: true, Operation: "schools.reactivate"},
	{Method: "DELETE", Path: "/admin/v1/schools/{id}", Control: controlCapability, Capability: adminaccess.CapabilitySchoolsManage, Mutation: true, Operation: "schools.delete"},
	{Method: "GET", Path: "/admin/v1/schools/{id}/admin-grants", Control: controlCapability, Capability: adminaccess.CapabilitySchoolGrantsManage, Operation: "school_grants.list"},
	{Method: "POST", Path: "/admin/v1/schools/{id}/admin-grants", Control: controlCapability, Capability: adminaccess.CapabilitySchoolGrantsManage, Mutation: true, Operation: "school_grants.grant"},
	{Method: "POST", Path: "/admin/v1/schools/{id}/admin-grants/{grant_id}/revoke", Control: controlCapability, Capability: adminaccess.CapabilitySchoolGrantsManage, Mutation: true, Operation: "school_grants.revoke"},
	{Method: "GET", Path: "/admin/v1/games", Control: controlCapability, Capability: adminaccess.CapabilityGamesManage, Operation: "games.list"},
	{Method: "POST", Path: "/admin/v1/games", Control: controlCapability, Capability: adminaccess.CapabilityGamesManage, Mutation: true, Operation: "games.create"},
	{Method: "GET", Path: "/admin/v1/games/{id}", Control: controlCapability, Capability: adminaccess.CapabilityGamesManage, Operation: "games.get"},
	{Method: "PATCH", Path: "/admin/v1/games/{id}", Control: controlCapability, Capability: adminaccess.CapabilityGamesManage, Mutation: true, Operation: "games.update"},
	{Method: "DELETE", Path: "/admin/v1/games/{id}", Control: controlCapability, Capability: adminaccess.CapabilityGamesManage, Mutation: true, Operation: "games.delete"},
	{Method: "GET", Path: "/admin/v1/users", Control: controlCapability, Capability: adminaccess.CapabilityUsersRead, Operation: "users.list"},
	{Method: "GET", Path: "/admin/v1/users/{id}", Control: controlCapability, Capability: adminaccess.CapabilityUsersRead, Operation: "users.get"},
	{Method: "POST", Path: "/admin/v1/users/{id}/suspend", Control: controlCapability, Capability: adminaccess.CapabilityUsersManageStatus, Mutation: true, RequiresRecentAuth: true, Operation: "users.suspend"},
	{Method: "POST", Path: "/admin/v1/users/{id}/reactivate", Control: controlCapability, Capability: adminaccess.CapabilityUsersManageStatus, Mutation: true, RequiresRecentAuth: true, Operation: "users.reactivate"},
	{Method: "PATCH", Path: "/admin/v1/users/{id}/trust-grants", Control: controlCapability, Capability: adminaccess.CapabilityTrustGrantsManage, Mutation: true, Operation: "users.trust"},
	{Method: "GET", Path: "/admin/v1/site-admin-grants", Control: controlCapability, Capability: adminaccess.CapabilitySiteGrantsManage, Operation: "site_grants.list"},
	{Method: "POST", Path: "/admin/v1/site-admin-grants", Control: controlCapability, Capability: adminaccess.CapabilitySiteGrantsManage, Mutation: true, RequiresRecentAuth: true, Operation: "site_grants.grant"},
	{Method: "POST", Path: "/admin/v1/site-admin-grants/{id}/revoke", Control: controlCapability, Capability: adminaccess.CapabilitySiteGrantsManage, Mutation: true, RequiresRecentAuth: true, Operation: "site_grants.revoke"},
	{Method: "GET", Path: "/admin/v1/schools/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "schools.audit"},
	{Method: "GET", Path: "/admin/v1/games/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "games.audit"},
	{Method: "GET", Path: "/admin/v1/users/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "users.audit"},
	{Method: "GET", Path: "/admin/v1/site-admin-grants/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: "site_grants.audit"},
}

func (handler *Handler) catalogHandler(operation routeOperation, id string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		actor, ok := ActorFromContext(req.Context())
		deps := handler.dependencies.Catalog
		if !ok || deps == nil || deps.Schools == nil || deps.Games == nil || deps.Users == nil || deps.SiteGrants == nil {
			writeError(w, 503, "admin_unavailable")
			return
		}
		if id != "" && !validAdminUUID(id) {
			writeAdminApplicationError(w, adminmutation.ErrNotFound, "admin_unavailable")
			return
		}
		if req.Method == http.MethodGet {
			handler.catalogRead(w, req, actor, operation, id)
			return
		}
		correlation := adminaudit.Correlation{ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req)}
		var result any
		var err error
		schoolChanged := false
		status := http.StatusOK
		switch operation {
		case "schools.create", "schools.update":
			var input schools.AdminEdit
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			if operation == "schools.create" {
				result, err = deps.Schools.CreateAdmin(req.Context(), input)
				status = http.StatusCreated
			} else {
				result, err = deps.Schools.UpdateAdmin(req.Context(), id, input)
			}
			schoolChanged = err == nil
		case "games.create", "games.update":
			var input games.AdminEdit
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			if operation == "games.create" {
				result, err = deps.Games.CreateAdmin(req.Context(), input)
				status = http.StatusCreated
			} else {
				result, err = deps.Games.UpdateAdmin(req.Context(), id, input)
			}
		case "school_grants.grant":
			var input schools.GrantAdminInput
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Schools.GrantAdmin(req.Context(), id, input)
			status = http.StatusCreated
		case "users.trust":
			var input users.TrustChange
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			result, err = deps.Users.ChangeTrustAdmin(req.Context(), id, input)
		case "site_grants.grant":
			var input struct {
				adminmutation.Command
				UserID string `json:"user_id"`
			}
			if err = decodeAdminJSON(w, req, &input); err != nil {
				break
			}
			input.Correlation = correlation
			if err = input.Command.Validate(true); err != nil {
				break
			}
			result, err = deps.SiteGrants.GrantRole(req.Context(), adminaccess.GrantInput{UserID: input.UserID, Role: adminaccess.RoleSiteAdmin,
				ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req), Reason: input.Reason, ExpectedUserUpdatedAt: &input.ExpectedUpdatedAt})
			status = http.StatusCreated
		default:
			var command adminmutation.Command
			if err = decodeAdminJSON(w, req, &command); err != nil {
				break
			}
			command.Correlation = correlation
			if err = command.Validate(true); err != nil {
				break
			}
			switch operation {
			case "schools.deactivate":
				result, err = deps.Schools.DeactivateAdmin(req.Context(), id, command)
				schoolChanged = err == nil
			case "schools.reactivate":
				result, err = deps.Schools.ReactivateAdmin(req.Context(), id, command)
				schoolChanged = err == nil
			case "schools.delete":
				result, err = deps.Schools.DeleteAdmin(req.Context(), id, command)
				schoolChanged = err == nil
			case "games.delete":
				result, err = deps.Games.DeleteAdmin(req.Context(), id, command)
			case "users.suspend":
				result, err = deps.Users.SuspendAdmin(req.Context(), id, command)
			case "users.reactivate":
				result, err = deps.Users.ReactivateAdmin(req.Context(), id, command)
			case "school_grants.revoke":
				result, err = deps.Schools.RevokeAdmin(req.Context(), id, req.PathValue("grant_id"), command)
			case "site_grants.revoke":
				var grant adminaccess.Grant
				grant, err = deps.SiteGrants.GetGrant(req.Context(), id)
				if err != nil {
					break
				}
				result, err = deps.SiteGrants.RevokeRole(req.Context(), adminaccess.RevokeInput{UserID: grant.UserID, Role: adminaccess.RoleSiteAdmin,
					ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req), Reason: command.Reason, ExpectedGrantID: id, ExpectedGrantedAt: &command.ExpectedUpdatedAt})
			default:
				http.NotFound(w, req)
				return
			}
		}
		if err != nil {
			if errors.Is(err, adminmutation.ErrConflict) {
				var current any
				var readErr error
				switch operation {
				case "schools.update", "schools.deactivate", "schools.reactivate", "schools.delete":
					current, readErr = deps.Schools.GetAdmin(req.Context(), id)
				case "games.update", "games.delete":
					current, readErr = deps.Games.GetAdmin(req.Context(), id)
				case "users.suspend", "users.reactivate", "users.trust":
					current, readErr = deps.Users.GetAdmin(req.Context(), id)
				}
				if current != nil && readErr == nil {
					writeJSON(w, 409, map[string]any{"error": "admin_record_conflict", "current": current})
					return
				}
			}
			writeAdminApplicationError(w, err, "admin_mutation_failed")
			return
		}
		if schoolChanged && deps.Cache != nil {
			deps.Cache.Invalidate()
			if err := deps.Cache.Refresh(req.Context()); err != nil {
				slog.Warn("admin catalog committed; reads use database until refresh succeeds")
			}
		}
		writeJSON(w, status, result)
	})
}

func (handler *Handler) catalogRead(w http.ResponseWriter, req *http.Request, actor Actor, operation routeOperation, id string) {
	deps := handler.dependencies.Catalog
	if err := handler.recordSensitiveRead(req, actor, "admin_catalog", string(operation)); err != nil {
		writeError(w, 503, "admin_security_event_unavailable")
		return
	}
	var result any
	var err error
	switch operation {
	case "schools.get":
		result, err = deps.Schools.GetAdmin(req.Context(), id)
	case "games.get":
		result, err = deps.Games.GetAdmin(req.Context(), id)
	case "users.get":
		result, err = deps.Users.GetAdmin(req.Context(), id)
	case "schools.audit", "games.audit", "users.audit", "site_grants.audit", "school_grants.audit":
		if deps.Audit == nil {
			writeError(w, 503, "admin_unavailable")
			return
		}
		var entity adminaudit.EntityType
		switch operation {
		case "school_grants.audit":
			entity = adminaudit.EntitySchoolGrant
			_, err = deps.Schools.GetAdminGrant(req.Context(), id, req.PathValue("grant_id"))
			id = req.PathValue("grant_id")
		case "schools.audit":
			entity = adminaudit.EntitySchool
			_, err = deps.Schools.GetAdmin(req.Context(), id)
		case "games.audit":
			entity = adminaudit.EntityGame
			_, err = deps.Games.GetAdmin(req.Context(), id)
		case "users.audit":
			entity = adminaudit.EntityUser
			_, err = deps.Users.GetAdmin(req.Context(), id)
		case "site_grants.audit":
			entity = adminaudit.EntitySiteRoleGrant
			_, err = deps.SiteGrants.GetGrant(req.Context(), id)
		}
		if err != nil {
			break
		}
		var filter operations.AuditFilter
		filter, err = parseAuditFilter(req.URL.Query())
		if err != nil {
			break
		}
		var entries []adminaudit.Entry
		entries, err = deps.Audit.List(req.Context(), adminaudit.ListParams{EntityType: entity, EntityID: id, Limit: filter.Limit + 1, After: filter.After, Before: filter.Before})
		if err == nil {
			result = catalogPage("audit_entries", entries, adminmutation.Filter{Limit: filter.Limit, After: filter.After, Before: filter.Before}, func(e adminaudit.Entry) (time.Time, string) { return e.CreatedAt, e.ID })
		}
	default:
		var filter adminmutation.Filter
		filter, err = parseCatalogFilter(req)
		if err != nil {
			break
		}
		query := filter
		query.Limit++
		switch operation {
		case "schools.list":
			var items []schools.AdminSchool
			items, err = deps.Schools.ListAdmin(req.Context(), query)
			result = catalogPage("schools", items, filter, func(s schools.AdminSchool) (time.Time, string) { return s.CreatedAt, s.ID })
		case "games.list":
			var items []games.AdminGame
			items, err = deps.Games.ListAdmin(req.Context(), query)
			result = catalogPage("games", items, filter, func(g games.AdminGame) (time.Time, string) { return g.CreatedAt, g.ID })
		case "users.list":
			var items []users.AdminUser
			items, err = deps.Users.ListAdmin(req.Context(), query)
			result = catalogPage("users", items, filter, func(u users.AdminUser) (time.Time, string) { return u.CreatedAt, u.ID })
		case "school_grants.list":
			var items []schools.AdminGrant
			items, err = deps.Schools.ListAdminGrants(req.Context(), id, query)
			result = catalogPage("grants", items, filter, func(g schools.AdminGrant) (time.Time, string) { return g.CreatedAt, g.ID })
		case "site_grants.list":
			var items []adminaccess.Grant
			items, err = deps.SiteGrants.ListGrants(req.Context(), query)
			result = catalogPage("grants", items, filter, func(g adminaccess.Grant) (time.Time, string) { return g.GrantedAt, g.ID })
		default:
			http.NotFound(w, req)
			return
		}
	}
	if err != nil {
		writeAdminApplicationError(w, err, "admin_query_failed")
		return
	}
	writeJSON(w, 200, result)
}

func parseCatalogFilter(req *http.Request) (adminmutation.Filter, error) {
	values := req.URL.Query()
	if err := validateQueryKeys(values, map[string]struct{}{"q": {}, "state": {}, "limit": {}, "after": {}, "before": {}}); err != nil {
		return adminmutation.Filter{}, err
	}
	limit, after, before, err := parsePagination(values)
	if err != nil {
		return adminmutation.Filter{}, err
	}
	filter := adminmutation.Filter{Query: values.Get("q"), State: values.Get("state"), Limit: limit, After: after, Before: before}
	if err := filter.Validate(); err != nil {
		return adminmutation.Filter{}, err
	}
	if len(filter.Query) > 0 && len(filter.Query) < 2 {
		return adminmutation.Filter{}, apperror.Validation("search requires at least two characters")
	}
	return filter, nil
}

func catalogPage[T any](key string, items []T, filter adminmutation.Filter, position func(T) (time.Time, string)) map[string]any {
	page := makeCursorPage(items, filter.Limit, filter.After, filter.Before, position)
	return map[string]any{key: page.Items, "next_cursor": page.NextCursor, "previous_cursor": page.PreviousCursor}
}
