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
	grant      adminaccess.Grant
	err        error
	calls      int
	lastUserID string
	lastRole   adminaccess.Role
}

func (finder *fakeGrantFinder) ActiveGrant(_ context.Context, userID string, role adminaccess.Role) (adminaccess.Grant, error) {
	finder.calls++
	finder.lastUserID = userID
	finder.lastRole = role
	return finder.grant, finder.err
}

type fakeSessionManager struct {
	principals   map[string]adminsession.Principal
	started      adminsession.StartInput
	rotated      adminsession.StartInput
	rotatedToken string
	revokedToken string
	revokeReason string
	stepUp       bool
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

func (manager *fakeSessionManager) Rotate(_ context.Context, token string, input adminsession.StartInput, stepUp bool) (adminsession.Credential, error) {
	manager.rotatedToken = token
	manager.rotated = input
	manager.stepUp = stepUp
	credential := adminsession.Credential{Token: "rotated-token", CSRFToken: "rotated-csrf", ExpiresAt: time.Now().Add(8 * time.Hour)}
	principal := testPrincipal(input.UserID, input.GrantID, credential.CSRFToken)
	if stepUp {
		now := time.Now().UTC()
		principal.StepUpAt = &now
	}
	manager.principals[credential.Token] = principal
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

type fakeTransactionRunner struct {
	sessions *fakeSessionManager
	security *fakeSecurityWriter
	err      error
	runs     int
}

func (runner *fakeTransactionRunner) Run(
	ctx context.Context,
	operation func(adminsession.Manager, adminsecurity.Writer) error,
) error {
	runner.runs++
	if runner.err != nil {
		return runner.err
	}
	return operation(runner.sessions, runner.security)
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

func TestExchangeDoesNotIssueCookiesWhenSecurityTransactionFails(t *testing.T) {
	handler, fixture := testHandler(true)
	fixture.security.err = errors.New("security event unavailable")
	req := trustedRequest(http.MethodPost, "/admin/v1/auth/exchange")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(AccessAssertionHeader, "signed-access-assertion")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusServiceUnavailable || len(response.Result().Cookies()) != 0 {
		t.Fatalf("failed exchange = %d cookies %#v", response.Code, response.Result().Cookies())
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
	for _, test := range []struct {
		name       string
		token      string
		grantID    string
		grantRole  adminaccess.Role
		grantErr   error
		wantStatus int
	}{
		{name: "missing", wantStatus: 401},
		{name: "revoked session", token: "revoked", wantStatus: 401},
		{name: "ordinary user", token: "current", grantErr: adminaccess.ErrGrantNotFound, wantStatus: 403},
		{name: "school admin only", token: "current", grantID: "grant-id", grantRole: "school_admin", wantStatus: 403},
		{name: "grant mismatch", token: "current", grantID: "different-grant", grantRole: adminaccess.RoleSiteAdmin, wantStatus: 403},
		{name: "allowed", token: "current", grantID: "grant-id", grantRole: adminaccess.RoleSiteAdmin, wantStatus: 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, fixture := testHandler(true)
			fixture.grants.grant.ID = test.grantID
			fixture.grants.grant.Role = test.grantRole
			fixture.grants.err = test.grantErr
			req := trustedRequest(http.MethodGet, "/admin/v1/session")
			if test.token != "" {
				req.AddCookie(&http.Cookie{Name: "admin_session", Value: test.token})
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
			}
			if test.token == "current" &&
				(fixture.grants.calls != 1 || fixture.grants.lastUserID != "user-id" ||
					fixture.grants.lastRole != adminaccess.RoleSiteAdmin) {
				t.Fatalf("active grant lookup = calls %d user %q role %q",
					fixture.grants.calls, fixture.grants.lastUserID, fixture.grants.lastRole)
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

func TestMutationOriginFailsBeforeSessionAndHandlerWork(t *testing.T) {
	handler, fixture := testHandler(true)
	req := trustedRequest(http.MethodPost, "/admin/v1/logout")
	req.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusForbidden || fixture.sessions.revokedToken != "" ||
		fixture.grants.calls != 0 || len(fixture.security.events) != 1 ||
		fixture.security.events[0].Metadata.ReasonCode != "origin_mismatch" {
		t.Fatalf("origin boundary = status %d revoke %q grant calls %d events %#v",
			response.Code, fixture.sessions.revokedToken, fixture.grants.calls, fixture.security.events)
	}
}

func TestStepUpRotatesCredentialAndRecordsFreshAuthentication(t *testing.T) {
	handler, fixture := testHandler(true)
	now := time.Date(2026, time.September, 16, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	principal := testPrincipal("user-id", "grant-id", "current-csrf")
	principal.AuthenticatedAt = now.Add(-5 * time.Minute)
	fixture.sessions.principals["current"] = principal
	fixture.identities.identity.Authenticated = now.Add(-time.Minute)

	req := trustedRequest(http.MethodPost, "/admin/v1/auth/step-up")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, "current-csrf")
	req.Header.Set(AccessAssertionHeader, "fresh-step-up-assertion")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK || fixture.sessions.rotatedToken != "current" ||
		!fixture.sessions.stepUp || fixture.transactions.runs != 1 {
		t.Fatalf("step-up = status %d token %q flag %t transactions %d body %s",
			response.Code, fixture.sessions.rotatedToken, fixture.sessions.stepUp,
			fixture.transactions.runs, response.Body.String())
	}
	if len(fixture.security.events) != 1 ||
		fixture.security.events[0].Type != adminsecurity.EventStepUpSucceeded {
		t.Fatalf("step-up security events = %#v", fixture.security.events)
	}
	if cookies := response.Result().Cookies(); len(cookies) != 2 ||
		cookies[0].Value != "rotated-token" || cookies[1].Value != "rotated-csrf" {
		t.Fatalf("step-up cookies = %#v", cookies)
	}
}

func TestStepUpRejectsStaleOrChangedAccessIdentityBeforeRotation(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*handlerFixture, time.Time)
	}{
		{name: "stale assertion", mutate: func(fixture *handlerFixture, now time.Time) {
			fixture.identities.identity.Authenticated = now.Add(-11 * time.Minute)
		}},
		{name: "changed subject", mutate: func(fixture *handlerFixture, now time.Time) {
			fixture.identities.identity.Authenticated = now.Add(-time.Minute)
			fixture.identities.identity.Subject = "different-subject"
		}},
		{name: "replayed assertion", mutate: func(fixture *handlerFixture, now time.Time) {
			fixture.identities.identity.Authenticated = now.Add(-6 * time.Minute)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, fixture := testHandler(true)
			now := time.Date(2026, time.September, 16, 12, 0, 0, 0, time.UTC)
			handler.now = func() time.Time { return now }
			principal := testPrincipal("user-id", "grant-id", "current-csrf")
			principal.AuthenticatedAt = now.Add(-5 * time.Minute)
			fixture.sessions.principals["current"] = principal
			test.mutate(&fixture, now)

			req := trustedRequest(http.MethodPost, "/admin/v1/auth/step-up")
			req.Header.Set("Origin", "https://admin.example.test")
			req.Header.Set(CSRFHeader, "current-csrf")
			req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
			req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)

			if response.Code != http.StatusForbidden || fixture.sessions.rotatedToken != "" ||
				len(fixture.security.events) != 1 ||
				fixture.security.events[0].Type != adminsecurity.EventStepUpDenied {
				t.Fatalf("step-up denial = status %d rotation %q events %#v",
					response.Code, fixture.sessions.rotatedToken, fixture.security.events)
			}
		})
	}
}

func TestLogoutFailsClosedWhenTransactionalSecurityEventFails(t *testing.T) {
	handler, fixture := testHandler(true)
	fixture.security.err = errors.New("security event unavailable")
	req := trustedRequest(http.MethodPost, "/admin/v1/logout")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, "current-csrf")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusServiceUnavailable || len(response.Result().Cookies()) != 0 {
		t.Fatalf("failed transactional logout = %d cookies %#v",
			response.Code, response.Result().Cookies())
	}
}

func TestRouteRegistryIsExplicitUniqueAndDefaultDeny(t *testing.T) {
	if err := validateRoutePolicies(routes); err != nil {
		t.Fatalf("route registry = %v", err)
	}
	for _, invalid := range [][]routePolicy{
		{{Method: http.MethodGet, Path: "/admin/v1/uncontrolled"}},
		{{Method: http.MethodGet, Path: "/admin/v1/read", Control: controlCapability}},
		{{Method: http.MethodGet, Path: "/admin/v1/read", Control: controlCapability, Capability: "unknown"}},
		{{Method: http.MethodPost, Path: "/admin/v1/auth/step-up", Control: controlStepUp, Mutation: true, RequiresRecentAuth: true}},
		{{Method: http.MethodPost, Path: "/admin/v1/write", Control: controlCapability, Capability: adminaccess.CapabilityReportsManage}},
		{
			{Method: http.MethodGet, Path: "/admin/v1/read", Control: controlCapability, Capability: adminaccess.CapabilityReportsRead},
			{Method: http.MethodGet, Path: "/admin/v1/read", Control: controlCapability, Capability: adminaccess.CapabilityReportsRead},
		},
	} {
		if err := validateRoutePolicies(invalid); err == nil {
			t.Fatalf("invalid route registry accepted = %#v", invalid)
		}
	}
	handler, _ := testHandler(true)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, trustedRequest(http.MethodGet, "/admin/v1/not-registered"))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unregistered route status = %d", response.Code)
	}
}

func TestAuthorizationMiddlewareEnforcesRecentAuthenticationBeforeHandler(t *testing.T) {
	handler, fixture := testHandler(true)
	now := time.Date(2026, time.September, 16, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	called := false
	protected := handler.withAuthorization(
		adminaccess.CapabilitySiteGrantsManage,
		true,
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }),
	)

	for _, test := range []struct {
		name       string
		stepUpAt   *time.Time
		wantStatus int
		wantCalled bool
	}{
		{name: "missing", wantStatus: http.StatusForbidden},
		{name: "stale", stepUpAt: timePointer(now.Add(-11 * time.Minute)), wantStatus: http.StatusForbidden},
		{name: "future", stepUpAt: timePointer(now.Add(time.Second)), wantStatus: http.StatusForbidden},
		{name: "recent", stepUpAt: timePointer(now.Add(-time.Minute)), wantStatus: http.StatusOK, wantCalled: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			called = false
			fixture.security.events = nil
			principal := testPrincipal("user-id", "grant-id", "csrf")
			principal.StepUpAt = test.stepUpAt
			req := trustedRequest(http.MethodPost, "/admin/v1/site-admin-grants")
			response := httptest.NewRecorder()

			// Exercise through the real session middleware to avoid manufacturing
			// the package-private principal context used by authorization.
			fixture.sessions.principals["recent-auth-test"] = principal
			req.AddCookie(&http.Cookie{Name: "admin_session", Value: "recent-auth-test"})
			handler.trusted = adminsession.WithSession(fixture.sessions, handler.config.Cookies)(protected)
			handler.trusted.ServeHTTP(response, req)

			if response.Code != test.wantStatus || called != test.wantCalled {
				t.Fatalf("recent auth = status %d called %t", response.Code, called)
			}
			if !test.wantCalled && (len(fixture.security.events) != 1 ||
				fixture.security.events[0].Metadata.ReasonCode != "recent_auth_required") {
				t.Fatalf("recent-auth denial events = %#v", fixture.security.events)
			}
		})
	}
}

func timePointer(value time.Time) *time.Time {
	return &value
}

type handlerFixture struct {
	identities   *fakeIdentityValidator
	users        *fakeUserFinder
	grants       *fakeGrantFinder
	sessions     *fakeSessionManager
	security     *fakeSecurityWriter
	transactions *fakeTransactionRunner
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
	fixture.transactions = &fakeTransactionRunner{
		sessions: fixture.sessions,
		security: fixture.security,
	}
	handler := NewHandler(Config{
		Enabled: enabled, SiteOrigin: "https://admin.example.test", ProxySecret: "proxy-secret",
		Cookies: adminsession.CookieConfig{Name: "admin_session", CSRFName: "admin_csrf", Secure: true},
	}, Dependencies{
		Identities: fixture.identities, Users: fixture.users, Grants: fixture.grants,
		Sessions: fixture.sessions, Security: fixture.security,
		Transactions: fixture.transactions,
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
