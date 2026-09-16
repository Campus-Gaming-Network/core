// Package adminhttp exposes the narrow, default-deny Admin Console API edge.
package adminhttp

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminidentity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
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
	Enabled     bool
	SiteOrigin  string
	ProxySecret string
	Cookies     adminsession.CookieConfig
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

type SessionManager interface {
	adminsession.Authenticator
	Start(context.Context, adminsession.StartInput) (adminsession.Credential, error)
	Rotate(context.Context, string, adminsession.StartInput, bool) (adminsession.Credential, error)
	Revoke(context.Context, string, string) error
}

type SecurityWriter interface {
	Insert(context.Context, adminsecurity.WriteInput) (adminsecurity.Event, error)
}

type Dependencies struct {
	Identities IdentityValidator
	Users      UserFinder
	Grants     GrantFinder
	Sessions   SessionManager
	Security   SecurityWriter
}

type routeControl string

const (
	controlExchange       routeControl = "access_exchange"
	controlCurrentSession routeControl = "current_session"
	controlLogout         routeControl = "logout"
)

type routePolicy struct {
	Method     string
	Path       string
	Control    routeControl
	Capability adminaccess.Capability
}

var routes = []routePolicy{
	{Method: http.MethodPost, Path: "/admin/v1/auth/exchange", Control: controlExchange},
	{Method: http.MethodGet, Path: "/admin/v1/session", Control: controlCurrentSession, Capability: adminaccess.CapabilityAdminSessionRead},
	{Method: http.MethodPost, Path: "/admin/v1/logout", Control: controlLogout},
}

type Handler struct {
	config       Config
	dependencies Dependencies
	trusted      http.Handler
}

func NewHandler(config Config, dependencies Dependencies) *Handler {
	handler := &Handler{config: config, dependencies: dependencies}
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
	policy, pathKnown := findRoute(req.Method, req.URL.Path)
	if !pathKnown {
		http.NotFound(w, req)
		return
	}
	if policy.Method == "" {
		w.Header().Set("Allow", allowedMethods(req.URL.Path))
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	switch policy.Control {
	case controlExchange:
		handler.exchange(w, req)
	case controlCurrentSession:
		handler.currentSession(w, req, policy.Capability)
	case controlLogout:
		handler.logout(w, req)
	default:
		http.NotFound(w, req)
	}
}

func (handler *Handler) exchange(w http.ResponseWriter, req *http.Request) {
	if !handler.validOrigin(req) {
		handler.recordDenied(req, "origin_mismatch", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "admin_origin_required")
		return
	}
	if handler.dependencies.Identities == nil || handler.dependencies.Users == nil ||
		handler.dependencies.Grants == nil || handler.dependencies.Sessions == nil || handler.dependencies.Security == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	identity, err := handler.dependencies.Identities.Validate(req.Context(), req.Header.Get(AccessAssertionHeader))
	if err != nil {
		handler.recordDenied(req, "invalid_access_assertion", http.StatusUnauthorized)
		writeError(w, http.StatusUnauthorized, "admin_access_assertion_invalid")
		return
	}
	profile, err := handler.dependencies.Users.FindByEmail(req.Context(), identity.Email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && profile.EmailVerifiedAt == nil) {
		handler.recordDenied(req, "account_not_eligible", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "site_admin_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	grant, err := handler.dependencies.Grants.ActiveGrant(req.Context(), profile.ID, adminaccess.RoleSiteAdmin)
	if errors.Is(err, adminaccess.ErrGrantNotFound) {
		handler.recordDenied(req, "active_grant_missing", http.StatusForbidden)
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
	credential, err := handler.startOrRotate(req, start)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	principal, err := handler.dependencies.Sessions.Authenticate(req.Context(), credential.Token)
	if err != nil {
		_ = handler.dependencies.Sessions.Revoke(req.Context(), credential.Token, "exchange verification failed")
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	if _, err := handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
		Type: adminsecurity.EventExchangeSucceeded, Outcome: adminsecurity.OutcomeSucceeded,
		ActorUserID: profile.ID, AdminSessionID: principal.SessionID, RequestID: requestID(req),
	}); err != nil {
		_ = handler.dependencies.Sessions.Revoke(req.Context(), credential.Token, "security event unavailable")
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	adminsession.SetCookie(w, handler.config.Cookies, credential)
	adminsession.SetCSRFCookie(w, handler.config.Cookies, credential)
	writeJSON(w, http.StatusCreated, sessionResponse(principal, grant.Role))
}

func (handler *Handler) startOrRotate(req *http.Request, input adminsession.StartInput) (adminsession.Credential, error) {
	principal, authenticated := adminsession.FromContext(req.Context())
	cookie, cookieErr := req.Cookie(sessionCookieName(handler.config.Cookies))
	if authenticated && cookieErr == nil && principal.UserID == input.UserID && principal.GrantID == input.GrantID {
		return handler.dependencies.Sessions.Rotate(req.Context(), cookie.Value, input, false)
	}
	if authenticated && cookieErr == nil {
		_ = handler.dependencies.Sessions.Revoke(req.Context(), cookie.Value, "Access identity changed")
	}
	return handler.dependencies.Sessions.Start(req.Context(), input)
}

func (handler *Handler) currentSession(w http.ResponseWriter, req *http.Request, capability adminaccess.Capability) {
	principal, grant, ok := handler.authorize(w, req, capability)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, sessionResponse(principal, grant.Role))
}

func (handler *Handler) logout(w http.ResponseWriter, req *http.Request) {
	principal, err := adminsession.Require(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "admin_authentication_required")
		return
	}
	if !handler.validOrigin(req) || !validCSRF(req, principal, handler.config.Cookies) {
		handler.recordDenied(req, "csrf_failed", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "admin_csrf_invalid")
		return
	}
	cookie, err := req.Cookie(sessionCookieName(handler.config.Cookies))
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "admin_authentication_required")
		return
	}
	if err := handler.dependencies.Sessions.Revoke(req.Context(), cookie.Value, "operator logout"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_session_unavailable")
		return
	}
	if handler.dependencies.Security != nil {
		_, _ = handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
			Type: adminsecurity.EventLogout, Outcome: adminsecurity.OutcomeSucceeded,
			ActorUserID: principal.UserID, AdminSessionID: principal.SessionID, RequestID: requestID(req),
		})
	}
	adminsession.ClearCookie(w, handler.config.Cookies)
	w.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) authorize(
	w http.ResponseWriter,
	req *http.Request,
	capability adminaccess.Capability,
) (adminsession.Principal, adminaccess.Grant, bool) {
	principal, err := adminsession.Require(req.Context())
	if err != nil {
		handler.recordDenied(req, "session_missing", http.StatusUnauthorized)
		writeError(w, http.StatusUnauthorized, "admin_authentication_required")
		return adminsession.Principal{}, adminaccess.Grant{}, false
	}
	if handler.dependencies.Grants == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return adminsession.Principal{}, adminaccess.Grant{}, false
	}
	grant, err := handler.dependencies.Grants.ActiveGrant(req.Context(), principal.UserID, adminaccess.RoleSiteAdmin)
	if errors.Is(err, adminaccess.ErrGrantNotFound) ||
		(err == nil && (grant.ID != principal.GrantID || !adminaccess.Allows(grant.Role, capability))) {
		handler.recordDeniedForPrincipal(req, principal, "capability_denied", http.StatusForbidden)
		writeError(w, http.StatusForbidden, "site_admin_required")
		return adminsession.Principal{}, adminaccess.Grant{}, false
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return adminsession.Principal{}, adminaccess.Grant{}, false
	}
	return principal, grant, true
}

func (handler *Handler) validOrigin(req *http.Request) bool {
	return handler.config.SiteOrigin != "" && req.Header.Get("Origin") == handler.config.SiteOrigin
}

func (handler *Handler) recordDenied(req *http.Request, reason string, status int) {
	if handler.dependencies.Security == nil {
		return
	}
	httpStatus := status
	_, _ = handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
		Type: adminsecurity.EventAuthorizationDenied, Outcome: adminsecurity.OutcomeDenied,
		RequestID: requestID(req), Metadata: adminsecurity.Metadata{ReasonCode: reason, HTTPStatus: &httpStatus},
	})
}

func (handler *Handler) recordDeniedForPrincipal(req *http.Request, principal adminsession.Principal, reason string, status int) {
	if handler.dependencies.Security == nil {
		return
	}
	httpStatus := status
	_, _ = handler.dependencies.Security.Insert(req.Context(), adminsecurity.WriteInput{
		Type: adminsecurity.EventAuthorizationDenied, Outcome: adminsecurity.OutcomeDenied,
		ActorUserID: principal.UserID, AdminSessionID: principal.SessionID,
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

func findRoute(method, path string) (routePolicy, bool) {
	pathKnown := false
	for _, route := range routes {
		if route.Path != path {
			continue
		}
		pathKnown = true
		if route.Method == method {
			return route, true
		}
	}
	return routePolicy{}, pathKnown
}

func allowedMethods(path string) string {
	methods := make([]string, 0, 2)
	for _, route := range routes {
		if route.Path == path {
			methods = append(methods, route.Method)
		}
	}
	return strings.Join(methods, ", ")
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
