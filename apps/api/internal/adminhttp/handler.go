// Package adminhttp exposes the narrow, default-deny Admin Console API edge.
package adminhttp

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminidentity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/operations"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

const (
	ProxySecretHeader     = "X-CGN-Admin-Proxy-Secret"
	AccessAssertionHeader = "Cf-Access-Jwt-Assertion"
	CSRFHeader            = "X-CGN-Admin-CSRF"
	RequestIDHeader       = "X-Request-ID"
)

type Config struct {
	Enabled      bool
	SiteOrigin   string
	ProxySecret  string
	Cookies      adminsession.CookieConfig
	StepUpMaxAge time.Duration
}

type IdentityValidator interface {
	Validate(context.Context, string) (adminidentity.Identity, error)
}

type UserFinder interface {
	FindByEmail(context.Context, string) (users.Profile, error)
}

type GrantFinder interface {
	ActiveGrant(context.Context, string, adminaccess.Role) (adminaccess.Grant, error)
}

type OperationsRepository interface {
	ListReports(context.Context, operations.QueueFilter) ([]operations.ReportSummary, error)
	GetReport(context.Context, string) (operations.Report, error)
	PatchReport(context.Context, string, operations.QueuePatch) (operations.Report, error)
	ListSupportTickets(context.Context, operations.QueueFilter) ([]operations.SupportTicketSummary, error)
	GetSupportTicket(context.Context, string) (operations.SupportTicket, error)
	PatchSupportTicket(context.Context, string, operations.QueuePatch) (operations.SupportTicket, error)
	ListAuditHistory(context.Context, string, string, operations.AuditFilter) ([]operations.AuditEntry, error)
}

type Dependencies struct {
	Catalog      *CatalogDependencies
	Identities   IdentityValidator
	Users        UserFinder
	Grants       GrantFinder
	Sessions     adminsession.Manager
	Security     adminsecurity.Writer
	Transactions adminsession.SecurityTransactionRunner
	Operations   OperationsRepository
}

type routeControl string

const (
	controlExchange   routeControl = "access_exchange"
	controlStepUp     routeControl = "access_step_up"
	controlCapability routeControl = "capability"
	controlLogout     routeControl = "logout"
)

type routePolicy struct {
	Method             string
	Path               string
	Control            routeControl
	Capability         adminaccess.Capability
	RequiresRecentAuth bool
	Mutation           bool
	Operation          routeOperation
}

type routeOperation string

const (
	operationCurrentSession   routeOperation = "current_session"
	operationListReports      routeOperation = "list_reports"
	operationGetReport        routeOperation = "get_report"
	operationPatchReport      routeOperation = "patch_report"
	operationListReportAudit  routeOperation = "list_report_audit"
	operationListSupport      routeOperation = "list_support"
	operationGetSupport       routeOperation = "get_support"
	operationPatchSupport     routeOperation = "patch_support"
	operationListSupportAudit routeOperation = "list_support_audit"
)

var routes = append([]routePolicy{
	{Method: http.MethodPost, Path: "/admin/v1/auth/exchange", Control: controlExchange},
	{Method: http.MethodPost, Path: "/admin/v1/auth/step-up", Control: controlStepUp, Mutation: true},
	{Method: http.MethodGet, Path: "/admin/v1/session", Control: controlCapability, Capability: adminaccess.CapabilityAdminSessionRead, Operation: operationCurrentSession},
	{Method: http.MethodPost, Path: "/admin/v1/logout", Control: controlLogout, Mutation: true},
	{Method: http.MethodGet, Path: "/admin/v1/reports", Control: controlCapability, Capability: adminaccess.CapabilityReportsRead, Operation: operationListReports},
	{Method: http.MethodGet, Path: "/admin/v1/reports/{id}", Control: controlCapability, Capability: adminaccess.CapabilityReportsRead, Operation: operationGetReport},
	{Method: http.MethodPatch, Path: "/admin/v1/reports/{id}", Control: controlCapability, Capability: adminaccess.CapabilityReportsManage, Mutation: true, Operation: operationPatchReport},
	{Method: http.MethodGet, Path: "/admin/v1/reports/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: operationListReportAudit},
	{Method: http.MethodGet, Path: "/admin/v1/support-tickets", Control: controlCapability, Capability: adminaccess.CapabilitySupportRead, Operation: operationListSupport},
	{Method: http.MethodGet, Path: "/admin/v1/support-tickets/{id}", Control: controlCapability, Capability: adminaccess.CapabilitySupportRead, Operation: operationGetSupport},
	{Method: http.MethodPatch, Path: "/admin/v1/support-tickets/{id}", Control: controlCapability, Capability: adminaccess.CapabilitySupportManage, Mutation: true, Operation: operationPatchSupport},
	{Method: http.MethodGet, Path: "/admin/v1/support-tickets/{id}/audit", Control: controlCapability, Capability: adminaccess.CapabilityAuditRead, Operation: operationListSupportAudit},
}, catalogRoutes...)

type Handler struct {
	config       Config
	dependencies Dependencies
	trusted      http.Handler
	now          func() time.Time
}

func NewHandler(config Config, dependencies Dependencies) *Handler {
	if config.StepUpMaxAge <= 0 || config.StepUpMaxAge > 10*time.Minute {
		config.StepUpMaxAge = 10 * time.Minute
	}
	handler := &Handler{config: config, dependencies: dependencies, now: time.Now}
	if dependencies.Sessions != nil {
		handler.trusted = adminsession.WithSession(dependencies.Sessions, config.Cookies)(
			http.HandlerFunc(handler.dispatch),
		)
	} else {
		handler.trusted = http.HandlerFunc(handler.dispatch)
	}
	return handler
}

func (handler *Handler) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	setPrivateHeaders(w)
	if handler == nil || !handler.config.Enabled {
		http.NotFound(w, req)
		return
	}
	if handler.config.ProxySecret == "" || !secretEqual(req.Header.Get(ProxySecretHeader), handler.config.ProxySecret) {
		// Conceal the privileged surface from direct-origin traffic.
		http.NotFound(w, req)
		return
	}
	requestID, err := newRequestID()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	w.Header().Set(RequestIDHeader, requestID)
	req = req.WithContext(context.WithValue(req.Context(), requestIDContextKey{}, requestID))
	handler.trusted.ServeHTTP(w, req)
}

func (handler *Handler) dispatch(w http.ResponseWriter, req *http.Request) {
	policy, entityID, pathKnown := findRoute(req.Method, req.URL.Path)
	if !pathKnown {
		http.NotFound(w, req)
		return
	}
	if policy.Method == "" {
		w.Header().Set("Allow", allowedMethods(req.URL.Path))
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	for index, part := range strings.Split(policy.Path, "/") {
		if part == "{grant_id}" {
			req.SetPathValue("grant_id", strings.Split(req.URL.Path, "/")[index])
		}
	}

	switch policy.Control {
	case controlExchange:
		handler.exchange(w, req)
	case controlStepUp:
		next := handler.withCSRFBoundary(
			adminsecurity.EventStepUpDenied,
			http.HandlerFunc(handler.stepUp),
		)
		next = handler.withAuthorization("", false, next)
		handler.withMutationOrigin(adminsecurity.EventStepUpDenied, next).ServeHTTP(w, req)
	case controlCapability:
		next := handler.operationHandler(policy.Operation, entityID)
		if policy.Mutation {
			next = handler.withCSRFBoundary(adminsecurity.EventAuthorizationDenied, next)
		}
		next = handler.withAuthorization(
			policy.Capability,
			policy.RequiresRecentAuth,
			next,
		)
		if policy.Mutation {
			next = handler.withMutationOrigin(adminsecurity.EventAuthorizationDenied, next)
		}
		next.ServeHTTP(w, req)
	case controlLogout:
		next := handler.withCSRFBoundary(
			adminsecurity.EventAuthorizationDenied,
			http.HandlerFunc(handler.logout),
		)
		next = handler.withAuthorization("", false, next)
		handler.withMutationOrigin(adminsecurity.EventAuthorizationDenied, next).ServeHTTP(w, req)
	default:
		http.NotFound(w, req)
	}
}

func (handler *Handler) exchange(w http.ResponseWriter, req *http.Request) {
	if !handler.validOrigin(req) {
		handler.recordDenied(req, adminsecurity.EventExchangeDenied, "origin_mismatch", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "admin_origin_required")
		return
	}
	if handler.dependencies.Identities == nil || handler.dependencies.Users == nil ||
		handler.dependencies.Grants == nil || handler.dependencies.Sessions == nil ||
		handler.dependencies.Security == nil || handler.dependencies.Transactions == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	identity, err := handler.dependencies.Identities.Validate(req.Context(), req.Header.Get(AccessAssertionHeader))
	if err != nil {
		handler.recordDenied(req, adminsecurity.EventExchangeDenied, "invalid_access_assertion", http.StatusUnauthorized)
		writeError(w, http.StatusUnauthorized, "admin_access_assertion_invalid")
		return
	}
	profile, err := handler.dependencies.Users.FindByEmail(req.Context(), identity.Email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && profile.EmailVerifiedAt == nil) {
		handler.recordDenied(req, adminsecurity.EventExchangeDenied, "account_not_eligible", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "site_admin_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	grant, err := handler.dependencies.Grants.ActiveGrant(req.Context(), profile.ID, adminaccess.RoleSiteAdmin)
	if errors.Is(err, adminaccess.ErrGrantNotFound) {
		handler.recordDenied(req, adminsecurity.EventExchangeDenied, "active_grant_missing", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "site_admin_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}

	start := adminsession.StartInput{
		UserID: profile.ID, GrantID: grant.ID, AccessIssuer: identity.Issuer,
		AccessSubject: identity.Subject, AccessEmail: identity.Email,
	}
	var credential adminsession.Credential
	var principal adminsession.Principal
	err = handler.dependencies.Transactions.Run(req.Context(), func(
		sessions adminsession.Manager,
		security adminsecurity.Writer,
	) error {
		var operationErr error
		credential, operationErr = handler.startOrRotate(req, sessions, start)
		if operationErr != nil {
			return operationErr
		}
		principal, operationErr = sessions.Authenticate(req.Context(), credential.Token)
		if operationErr != nil {
			return operationErr
		}
		_, operationErr = security.Insert(req.Context(), adminsecurity.WriteInput{
			Type: adminsecurity.EventExchangeSucceeded, Outcome: adminsecurity.OutcomeSucceeded,
			ActorUserID: profile.ID, AdminSessionID: principal.SessionID, RequestID: requestID(req),
		})
		return operationErr
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	adminsession.SetCookie(w, handler.config.Cookies, credential)
	adminsession.SetCSRFCookie(w, handler.config.Cookies, credential)
	writeJSON(w, http.StatusCreated, sessionResponse(principal, grant.Role))
}

func (handler *Handler) startOrRotate(
	req *http.Request,
	sessions adminsession.Manager,
	input adminsession.StartInput,
) (adminsession.Credential, error) {
	principal, authenticated := adminsession.FromContext(req.Context())
	cookie, cookieErr := req.Cookie(sessionCookieName(handler.config.Cookies))
	if authenticated && cookieErr == nil && principal.UserID == input.UserID && principal.GrantID == input.GrantID {
		return sessions.Rotate(req.Context(), cookie.Value, input, false)
	}
	if authenticated && cookieErr == nil {
		if err := sessions.Revoke(req.Context(), cookie.Value, "Access identity changed"); err != nil {
			return adminsession.Credential{}, err
		}
	}
	return sessions.Start(req.Context(), input)
}

func (handler *Handler) currentSession(w http.ResponseWriter, req *http.Request) {
	actor, ok := ActorFromContext(req.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse(actor.Principal, actor.Grant.Role))
}

func (handler *Handler) stepUp(w http.ResponseWriter, req *http.Request) {
	actor, ok := ActorFromContext(req.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	cookie, err := req.Cookie(sessionCookieName(handler.config.Cookies))
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "admin_authentication_required")
		return
	}
	if handler.dependencies.Identities == nil || handler.dependencies.Transactions == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	identity, err := handler.dependencies.Identities.Validate(req.Context(), req.Header.Get(AccessAssertionHeader))
	if err != nil {
		handler.recordDeniedForActor(req, actor, adminsecurity.EventStepUpDenied, "invalid_access_assertion", http.StatusUnauthorized)
		writeError(w, http.StatusUnauthorized, "admin_access_assertion_invalid")
		return
	}
	if !handler.validStepUpIdentity(actor.Principal, identity) {
		handler.recordDeniedForActor(req, actor, adminsecurity.EventStepUpDenied, "fresh_identity_required", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "admin_step_up_required")
		return
	}

	start := adminsession.StartInput{
		UserID: actor.UserID, GrantID: actor.Grant.ID,
		AccessIssuer: identity.Issuer, AccessSubject: identity.Subject, AccessEmail: identity.Email,
	}
	var credential adminsession.Credential
	var principal adminsession.Principal
	err = handler.dependencies.Transactions.Run(req.Context(), func(
		sessions adminsession.Manager,
		security adminsecurity.Writer,
	) error {
		var operationErr error
		credential, operationErr = sessions.Rotate(req.Context(), cookie.Value, start, true)
		if operationErr != nil {
			return operationErr
		}
		principal, operationErr = sessions.Authenticate(req.Context(), credential.Token)
		if operationErr != nil {
			return operationErr
		}
		_, operationErr = security.Insert(req.Context(), adminsecurity.WriteInput{
			Type: adminsecurity.EventStepUpSucceeded, Outcome: adminsecurity.OutcomeSucceeded,
			ActorUserID: actor.UserID, AdminSessionID: principal.SessionID, RequestID: requestID(req),
		})
		return operationErr
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	adminsession.SetCookie(w, handler.config.Cookies, credential)
	adminsession.SetCSRFCookie(w, handler.config.Cookies, credential)
	writeJSON(w, http.StatusOK, sessionResponse(principal, actor.Grant.Role))
}

func (handler *Handler) logout(w http.ResponseWriter, req *http.Request) {
	actor, ok := ActorFromContext(req.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	cookie, err := req.Cookie(sessionCookieName(handler.config.Cookies))
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "admin_authentication_required")
		return
	}
	if handler.dependencies.Transactions == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	err = handler.dependencies.Transactions.Run(req.Context(), func(
		sessions adminsession.Manager,
		security adminsecurity.Writer,
	) error {
		if revokeErr := sessions.Revoke(req.Context(), cookie.Value, "operator logout"); revokeErr != nil {
			return revokeErr
		}
		_, eventErr := security.Insert(req.Context(), adminsecurity.WriteInput{
			Type: adminsecurity.EventLogout, Outcome: adminsecurity.OutcomeSucceeded,
			ActorUserID: actor.UserID, AdminSessionID: actor.SessionID, RequestID: requestID(req),
		})
		return eventErr
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	adminsession.ClearCookie(w, handler.config.Cookies)
	w.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) validStepUpIdentity(principal adminsession.Principal, identity adminidentity.Identity) bool {
	now := handler.now().UTC()
	authenticatedAt := identity.Authenticated.UTC()
	return identity.Issuer == principal.AccessIssuer &&
		identity.Subject == principal.AccessSubject &&
		strings.EqualFold(identity.Email, principal.AccessEmail) &&
		!authenticatedAt.Before(now.Add(-handler.config.StepUpMaxAge)) &&
		authenticatedAt.After(principal.AuthenticatedAt.UTC())
}

func (handler *Handler) validOrigin(req *http.Request) bool {
	return handler.config.SiteOrigin != "" && req.Header.Get("Origin") == handler.config.SiteOrigin
}

func (handler *Handler) recordDenied(req *http.Request, eventType adminsecurity.EventType, reason string, status int) {
	if handler.dependencies.Security == nil {
		return
	}
	httpStatus := status
	_, _ = handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
		Type: eventType, Outcome: adminsecurity.OutcomeDenied,
		RequestID: requestID(req), Metadata: adminsecurity.Metadata{ReasonCode: reason, HTTPStatus: &httpStatus},
	})
}

func (handler *Handler) recordDeniedForActor(
	req *http.Request,
	actor Actor,
	eventType adminsecurity.EventType,
	reason string,
	status int,
) {
	if handler.dependencies.Security == nil {
		return
	}
	httpStatus := status
	_, _ = handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
		Type: eventType, Outcome: adminsecurity.OutcomeDenied,
		ActorUserID: actor.UserID, AdminSessionID: actor.SessionID,
		RequestID: requestID(req), Metadata: adminsecurity.Metadata{ReasonCode: reason, HTTPStatus: &httpStatus},
	})
}

type sessionPayload struct {
	UserID            string                   `json:"user_id"`
	Email             string                   `json:"email"`
	Role              adminaccess.Role         `json:"role"`
	Capabilities      []adminaccess.Capability `json:"capabilities"`
	AuthenticatedAt   string                   `json:"authenticated_at"`
	StepUpAt          *string                  `json:"step_up_at,omitempty"`
	AbsoluteExpiresAt string                   `json:"absolute_expires_at"`
}

func sessionResponse(principal adminsession.Principal, role adminaccess.Role) sessionPayload {
	var stepUpAt *string
	if principal.StepUpAt != nil {
		value := principal.StepUpAt.UTC().Format(time.RFC3339)
		stepUpAt = &value
	}
	return sessionPayload{
		UserID: principal.UserID, Email: principal.AccessEmail, Role: role,
		Capabilities:    adminaccess.CapabilitiesForRole(role),
		AuthenticatedAt: principal.AuthenticatedAt.UTC().Format(time.RFC3339), StepUpAt: stepUpAt,
		AbsoluteExpiresAt: principal.AbsoluteExpiresAt.UTC().Format(time.RFC3339),
	}
}

func validCSRF(req *http.Request, principal adminsession.Principal, config adminsession.CookieConfig) bool {
	header := req.Header.Get(CSRFHeader)
	cookie, err := req.Cookie(csrfCookieName(config))
	if err != nil || header == "" || cookie.Value == "" || !secretEqual(header, cookie.Value) {
		return false
	}
	return adminsession.VerifyCSRF(principal, header)
}

func findRoute(method, path string) (routePolicy, string, bool) {
	pathKnown := false
	for _, route := range routes {
		entityID, matches := matchRoutePath(route.Path, path)
		if !matches {
			continue
		}
		pathKnown = true
		if route.Method == method {
			return route, entityID, true
		}
	}
	return routePolicy{}, "", pathKnown
}

func allowedMethods(path string) string {
	methods := make([]string, 0, 2)
	for _, route := range routes {
		if _, matches := matchRoutePath(route.Path, path); matches {
			methods = append(methods, route.Method)
		}
	}
	return strings.Join(methods, ", ")
}

func validateRoutePolicies(policies []routePolicy) error {
	seen := make(map[string]struct{}, len(policies))
	for _, policy := range policies {
		if policy.Method == "" || !validRoutePattern(policy.Path) {
			return fmt.Errorf("invalid admin route registration")
		}
		key := policy.Method + " " + policy.Path
		if _, exists := seen[key]; exists {
			return fmt.Errorf("duplicate admin route registration")
		}
		seen[key] = struct{}{}

		switch policy.Control {
		case controlCapability:
			if policy.Capability == "" || !adminaccess.Allows(adminaccess.RoleSiteAdmin, policy.Capability) {
				return fmt.Errorf("admin route lacks a supported capability")
			}
			if isMutationMethod(policy.Method) != policy.Mutation {
				return fmt.Errorf("admin capability route has an invalid mutation policy")
			}
			if !validRouteOperation(policy) {
				return fmt.Errorf("admin capability route has an invalid operation")
			}
		case controlExchange:
			if policy.Capability != "" || policy.RequiresRecentAuth || policy.Mutation || policy.Operation != "" {
				return fmt.Errorf("auth-control route must not declare a capability")
			}
		case controlStepUp, controlLogout:
			if policy.Capability != "" || policy.RequiresRecentAuth || !policy.Mutation || policy.Operation != "" {
				return fmt.Errorf("auth-control route has an invalid mutation policy")
			}
		default:
			return fmt.Errorf("admin route lacks an authorization control")
		}
	}
	return nil
}

func matchRoutePath(pattern string, path string) (string, bool) {
	parts, values := strings.Split(pattern, "/"), strings.Split(path, "/")
	if len(parts) != len(values) {
		return "", false
	}
	id := ""
	for index, part := range parts {
		if part == "{id}" || part == "{grant_id}" {
			if values[index] == "" {
				return "", false
			}
			if part == "{id}" {
				id = values[index]
			}
		} else if part != values[index] {
			return "", false
		}
	}
	return id, true
}

func validRoutePattern(path string) bool {
	if !strings.HasPrefix(path, "/admin/v1/") || strings.Count(path, "{id}") > 1 {
		return false
	}
	withoutID := strings.ReplaceAll(path, "{id}", "")
	if strings.Count(withoutID, "{grant_id}") > 1 {
		return false
	}
	withoutID = strings.ReplaceAll(withoutID, "{grant_id}", "")
	return !strings.ContainsAny(withoutID, "{}")
}

func validRouteOperation(policy routePolicy) bool {
	expected := map[routeOperation]routePolicy{
		operationCurrentSession:   {Method: http.MethodGet, Path: "/admin/v1/session", Capability: adminaccess.CapabilityAdminSessionRead},
		operationListReports:      {Method: http.MethodGet, Path: "/admin/v1/reports", Capability: adminaccess.CapabilityReportsRead},
		operationGetReport:        {Method: http.MethodGet, Path: "/admin/v1/reports/{id}", Capability: adminaccess.CapabilityReportsRead},
		operationPatchReport:      {Method: http.MethodPatch, Path: "/admin/v1/reports/{id}", Capability: adminaccess.CapabilityReportsManage, Mutation: true},
		operationListReportAudit:  {Method: http.MethodGet, Path: "/admin/v1/reports/{id}/audit", Capability: adminaccess.CapabilityAuditRead},
		operationListSupport:      {Method: http.MethodGet, Path: "/admin/v1/support-tickets", Capability: adminaccess.CapabilitySupportRead},
		operationGetSupport:       {Method: http.MethodGet, Path: "/admin/v1/support-tickets/{id}", Capability: adminaccess.CapabilitySupportRead},
		operationPatchSupport:     {Method: http.MethodPatch, Path: "/admin/v1/support-tickets/{id}", Capability: adminaccess.CapabilitySupportManage, Mutation: true},
		operationListSupportAudit: {Method: http.MethodGet, Path: "/admin/v1/support-tickets/{id}/audit", Capability: adminaccess.CapabilityAuditRead},
	}
	definition, ok := expected[policy.Operation]
	if !ok {
		for _, candidate := range catalogRoutes {
			if candidate.Operation == policy.Operation {
				definition, ok = candidate, true
				break
			}
		}
	}
	return ok && definition.Method == policy.Method && definition.Path == policy.Path &&
		definition.Capability == policy.Capability && definition.Mutation == policy.Mutation && definition.RequiresRecentAuth == policy.RequiresRecentAuth
}

func isMutationMethod(method string) bool {
	return method == http.MethodPost || method == http.MethodPut ||
		method == http.MethodPatch || method == http.MethodDelete
}

func setPrivateHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func secretEqual(left, right string) bool {
	return len(left) == len(right) && left != "" && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

type requestIDContextKey struct{}

func newRequestID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func requestID(req *http.Request) string {
	value, _ := req.Context().Value(requestIDContextKey{}).(string)
	return value
}

func sessionCookieName(config adminsession.CookieConfig) string {
	if value := strings.TrimSpace(config.Name); value != "" {
		return value
	}
	return adminsession.ProductionCookieName
}

func csrfCookieName(config adminsession.CookieConfig) string {
	if value := strings.TrimSpace(config.CSRFName); value != "" {
		return value
	}
	return adminsession.ProductionCSRFCookieName
}
