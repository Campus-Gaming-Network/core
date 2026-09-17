package adminhttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
)

type actorContextKey struct{}

// Actor is the only administrative identity domain handlers may consume. It is
// derived from the authenticated session plus a fresh active-grant lookup;
// path, query, and body actor identifiers are never trusted.
type Actor struct {
	adminsession.Principal
	Grant adminaccess.Grant
}

func ActorFromContext(ctx context.Context) (Actor, bool) {
	actor, ok := ctx.Value(actorContextKey{}).(Actor)
	return actor, ok && actor.SessionID != "" && actor.UserID != "" &&
		actor.Grant.ID != "" && actor.Grant.ID == actor.GrantID
}

func (handler *Handler) withAuthorization(
	capability adminaccess.Capability,
	requireRecentAuth bool,
	next http.Handler,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		principal, err := adminsession.Require(req.Context())
		if err != nil {
			handler.recordDenied(req, adminsecurity.EventAuthorizationDenied, "session_missing", http.StatusUnauthorized)
			writeError(w, http.StatusUnauthorized, "admin_authentication_required")
			return
		}
		if handler.dependencies.Grants == nil {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}

		grant, err := handler.dependencies.Grants.ActiveGrant(
			req.Context(), principal.UserID, adminaccess.RoleSiteAdmin,
		)
		actor := Actor{Principal: principal, Grant: grant}
		if errors.Is(err, adminaccess.ErrGrantNotFound) ||
			(err == nil && (grant.ID != principal.GrantID || grant.UserID != principal.UserID ||
				grant.Role != adminaccess.RoleSiteAdmin ||
				(capability != "" && !adminaccess.Allows(grant.Role, capability)))) {
			handler.recordDeniedForActor(req, actor, adminsecurity.EventAuthorizationDenied, "capability_denied", http.StatusForbidden)
			writeError(w, http.StatusForbidden, "site_admin_required")
			return
		}
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		if requireRecentAuth && !handler.hasRecentAuthentication(principal) {
			handler.recordDeniedForActor(
				req, actor, adminsecurity.EventAuthorizationDenied,
				"recent_auth_required", http.StatusForbidden,
			)
			writeError(w, http.StatusForbidden, "recent_auth_required")
			return
		}

		next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor)))
	})
}

func (handler *Handler) hasRecentAuthentication(principal adminsession.Principal) bool {
	if principal.StepUpAt == nil {
		return false
	}
	now := handler.now().UTC()
	stepUpAt := principal.StepUpAt.UTC()
	return !stepUpAt.After(now) && !stepUpAt.Before(now.Add(-handler.config.StepUpMaxAge))
}

func (handler *Handler) withMutationOrigin(
	denialEvent adminsecurity.EventType,
	next http.Handler,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if !handler.validOrigin(req) {
			handler.recordDenied(
				req, denialEvent, "origin_mismatch", http.StatusForbidden,
			)
			writeError(w, http.StatusForbidden, "admin_csrf_invalid")
			return
		}
		next.ServeHTTP(w, req)
	})
}

func (handler *Handler) withCSRFBoundary(
	denialEvent adminsecurity.EventType,
	next http.Handler,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		actor, ok := ActorFromContext(req.Context())
		if !ok {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		if !validCSRF(req, actor.Principal, handler.config.Cookies) {
			handler.recordDeniedForActor(
				req, actor, denialEvent, "csrf_failed", http.StatusForbidden,
			)
			writeError(w, http.StatusForbidden, "admin_csrf_invalid")
			return
		}
		next.ServeHTTP(w, req)
	})
}
