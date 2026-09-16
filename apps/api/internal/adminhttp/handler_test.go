package adminhttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminidentity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

type fakeIdentityValidator struct {
	identity adminidentity.Identity
	err      error
}

func (validator *fakeIdentityValidator) Validate(_ context.Context, _ string) (adminidentity.Identity, error) {
	return validator.identity, validator.err
}

type fakeUserFinder struct {
	profile users.Profile
	err     error
}

func (finder *fakeUserFinder) FindByEmail(_ context.Context, email string) (users.Profile, error) {
	if finder.profile.Email != "" && finder.profile.Email != email {
		return users.Profile{}, errors.New("unexpected email")
	}
	return finder.profile, finder.err
}

type fakeGrantFinder struct {
	grant adminaccess.Grant
	err   error
}

func (finder *fakeGrantFinder) ActiveGrant(_ context.Context, _ string, _ adminaccess.Role) (adminaccess.Grant, error) {
	return finder.grant, finder.err
}

type fakeSessionManager struct {
	principals   map[string]adminsession.Principal
	started      adminsession.StartInput
	rotated      adminsession.StartInput
	rotatedToken string
	revokedToken string
	revokeReason string
}

func (manager *fakeSessionManager) Authenticate(_ context.Context, token string) (adminsession.Principal, error) {
	principal, ok := manager.principals[token]
	if !ok {
		return adminsession.Principal{}, adminsession.ErrUnauthenticated
	}
	return principal, nil
}

func (manager *fakeSessionManager) Start(_ context.Context, input adminsession.StartInput) (adminsession.Credential, error) {
	manager.started = input
	credential := adminsession.Credential{Token: "new-token", CSRFToken: "new-csrf", ExpiresAt: time.Now().Add(8 * time.Hour)}
	manager.principals[credential.Token] = testPrincipal(input.UserID, input.GrantID, credential.CSRFToken)
	return credential, nil
}

func (manager *fakeSessionManager) Rotate(_ context.Context, token string, input adminsession.StartInput, _ bool) (adminsession.Credential, error) {
	manager.rotatedToken = token
	manager.rotated = input
	credential := adminsession.Credential{Token: "rotated-token", CSRFToken: "rotated-csrf", ExpiresAt: time.Now().Add(8 * time.Hour)}
	manager.principals[credential.Token] = testPrincipal(input.UserID, input.GrantID, credential.CSRFToken)
	return credential, nil
}

func (manager *fakeSessionManager) Revoke(_ context.Context, token string, reason string) error {
	manager.revokedToken = token
	manager.revokeReason = reason
	return nil
}

type fakeSecurityWriter struct {
	events []adminsecurity.WriteInput
	err    error
}

func (writer *fakeSecurityWriter) Insert(_ context.Context, input adminsecurity.WriteInput) (adminsecurity.Event, error) {
	writer.events = append(writer.events, input)
	return adminsecurity.Event{ID: "security-event"}, writer.err
}

func TestHandlerConcealsDisabledAndUntrustedAdminSurface(t *testing.T) {
	for _, test := range []struct {
		name    string
		enabled bool
		secret  string
	}{
		{name: "disabled", enabled: false, secret: "proxy-secret"},
		{name: "missing proxy proof", enabled: true, secret: ""},
		{name: "wrong proxy proof", enabled: true, secret: "wrong"},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, _ := testHandler(test.enabled)
			req := httptest.NewRequest(http.MethodGet, "/admin/v1/session", nil)
			if test.secret != "" {
				req.Header.Set(ProxySecretHeader, test.secret)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", response.Code)
			}
			assertPrivateHeaders(t, response.Header())
		})
	}
}

func TestExchangeCreatesIsolatedSessionWithoutReturningCredentials(t *testing.T) {
	handler, fixture := testHandler(true)
	req := trustedRequest(http.MethodPost, "/admin/v1/auth/exchange")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(AccessAssertionHeader, "signed-access-assertion")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	if fixture.sessions.started.UserID != "user-id" || fixture.sessions.started.GrantID != "grant-id" ||
		fixture.sessions.started.AccessSubject != "access-subject" {
		t.Fatalf("started = %#v", fixture.sessions.started)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != "admin_session" || cookies[1].Name != "admin_csrf" {
		t.Fatalf("cookies = %#v", cookies)
	}
	if strings.Contains(response.Body.String(), "new-token") || strings.Contains(response.Body.String(), "new-csrf") {
		t.Fatalf("response exposed credential: %s", response.Body.String())
	}
	if len(fixture.security.events) != 1 || fixture.security.events[0].Type != adminsecurity.EventExchangeSucceeded ||
		fixture.security.events[0].AdminSessionID == "" {
		t.Fatalf("security events = %#v", fixture.security.events)
	}
	assertPrivateHeaders(t, response.Header())
}

func TestExchangeRotatesMatchingExistingSession(t *testing.T) {
	handler, fixture := testHandler(true)
	fixture.sessions.principals["old-token"] = testPrincipal("user-id", "grant-id", "old-csrf")
	req := trustedRequest(http.MethodPost, "/admin/v1/auth/exchange")
	req.Header.Set("Origin", "https://admin.example.test")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "old-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusCreated || fixture.sessions.rotatedToken != "old-token" ||
		fixture.sessions.started.UserID != "" {
		t.Fatalf("status/start/rotate = %d %#v %q", response.Code, fixture.sessions.started, fixture.sessions.rotatedToken)
	}
}

func TestExchangeDeniesInvalidIdentityAndOrigin(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		identityErr error
		wantCode    int
		wantError   string
	}{
		{name: "origin", origin: "https://attacker.example", wantCode: 403, wantError: "admin_origin_required"},
		{name: "assertion", origin: "https://admin.example.test", identityErr: adminidentity.ErrInvalidAssertion, wantCode: 401, wantError: "admin_access_assertion_invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, fixture := testHandler(true)
			fixture.identities.err = tt.identityErr
			req := trustedRequest(http.MethodPost, "/admin/v1/auth/exchange")
			req.Header.Set("Origin", tt.origin)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != tt.wantCode || !strings.Contains(response.Body.String(), tt.wantError) {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
			if len(fixture.security.events) != 1 || fixture.security.events[0].Outcome != adminsecurity.OutcomeDenied {
				t.Fatalf("security events = %#v", fixture.security.events)
			}
		})
	}
}

func TestCurrentSessionRequiresSessionAndCapability(t *testing.T) {
	handler, fixture := testHandler(true)
	for _, test := range []struct {
		name       string
		token      string
		grantID    string
		wantStatus int
	}{
		{name: "missing", wantStatus: 401},
		{name: "grant mismatch", token: "current", grantID: "different-grant", wantStatus: 403},
		{name: "allowed", token: "current", grantID: "grant-id", wantStatus: 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture.grants.grant.ID = test.grantID
			req := trustedRequest(http.MethodGet, "/admin/v1/session")
			if test.token != "" {
				req.AddCookie(&http.Cookie{Name: "admin_session", Value: test.token})
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestLogoutRequiresExactOriginAndDoubleSubmitCSRF(t *testing.T) {
	handler, fixture := testHandler(true)
	req := trustedRequest(http.MethodPost, "/admin/v1/logout")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, "current-csrf")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusNoContent || fixture.sessions.revokedToken != "current" ||
		fixture.sessions.revokeReason != "operator logout" {
		t.Fatalf("logout = %d token %q reason %q", response.Code, fixture.sessions.revokedToken, fixture.sessions.revokeReason)
	}
	if cookies := response.Result().Cookies(); len(cookies) != 2 || cookies[0].MaxAge != -1 || cookies[1].MaxAge != -1 {
		t.Fatalf("cleared cookies = %#v", cookies)
	}

	handler, _ = testHandler(true)
	req = trustedRequest(http.MethodPost, "/admin/v1/logout")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, "wrong")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusForbidden {
		t.Fatalf("invalid CSRF status = %d", response.Code)
	}
}

func TestRouteRegistryIsExplicitUniqueAndDefaultDeny(t *testing.T) {
	seen := make(map[string]struct{})
	for _, route := range routes {
		key := route.Method + " " + route.Path
		if route.Method == "" || !strings.HasPrefix(route.Path, "/admin/v1/") {
			t.Fatalf("invalid route = %#v", route)
		}
		if _, exists := seen[key]; exists {
			t.Fatalf("duplicate route = %s", key)
		}
		seen[key] = struct{}{}
		if route.Control == "" || (route.Control == controlCurrentSession && route.Capability == "") {
			t.Fatalf("route lacks authorization policy = %#v", route)
		}
	}
	handler, _ := testHandler(true)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, trustedRequest(http.MethodGet, "/admin/v1/not-registered"))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unregistered route status = %d", response.Code)
	}
}

type handlerFixture struct {
	identities *fakeIdentityValidator
	users      *fakeUserFinder
	grants     *fakeGrantFinder
	sessions   *fakeSessionManager
	security   *fakeSecurityWriter
}

func testHandler(enabled bool) (*Handler, handlerFixture) {
	verified := time.Now()
	fixture := handlerFixture{
		identities: &fakeIdentityValidator{identity: adminidentity.Identity{
			Issuer: "https://cgn.cloudflareaccess.com", Subject: "access-subject",
			Email: "admin@example.test", Authenticated: time.Now().Add(-time.Minute),
			ExpiresAt: time.Now().Add(time.Hour),
		}},
		users:  &fakeUserFinder{profile: users.Profile{ID: "user-id", Email: "admin@example.test", EmailVerifiedAt: &verified}},
		grants: &fakeGrantFinder{grant: adminaccess.Grant{ID: "grant-id", UserID: "user-id", Role: adminaccess.RoleSiteAdmin}},
		sessions: &fakeSessionManager{principals: map[string]adminsession.Principal{
			"current": testPrincipal("user-id", "grant-id", "current-csrf"),
		}},
		security: &fakeSecurityWriter{},
	}
	handler := NewHandler(Config{
		Enabled: enabled, SiteOrigin: "https://admin.example.test", ProxySecret: "proxy-secret",
		Cookies: adminsession.CookieConfig{Name: "admin_session", CSRFName: "admin_csrf", Secure: true},
	}, Dependencies{
		Identities: fixture.identities, Users: fixture.users, Grants: fixture.grants,
		Sessions: fixture.sessions, Security: fixture.security,
	})
	return handler, fixture
}

func testPrincipal(userID, grantID, csrf string) adminsession.Principal {
	now := time.Now().UTC()
	return adminsession.Principal{
		SessionID: "session-id", UserID: userID, GrantID: grantID,
		AccessIssuer: "https://cgn.cloudflareaccess.com", AccessSubject: "access-subject",
		AccessEmail: "admin@example.test", CSRFTokenHash: adminsession.HashToken(csrf),
		AuthenticatedAt: now.Add(-time.Minute), AbsoluteExpiresAt: now.Add(8 * time.Hour),
	}
}

func trustedRequest(method, path string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set(ProxySecretHeader, "proxy-secret")
	return req
}

func assertPrivateHeaders(t *testing.T, header http.Header) {
	t.Helper()
	if header.Get("Cache-Control") != "private, no-store" || header.Get("X-Robots-Tag") == "" ||
		header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("private headers = %#v", header)
	}
}
