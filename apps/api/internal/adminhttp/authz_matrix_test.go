package adminhttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
)

// Every registered route, not one representative route, faces each actor the
// authorization table names. The table is built from the runtime registry, so
// a new route joins it the moment it is registered.

func matrixPath(route routePolicy) string {
	return strings.NewReplacer("{id}", testReportID, "{grant_id}", testTicketID).Replace(route.Path)
}

// sessionRoutes are the routes that require an admin session. Exchange is the
// only one that establishes it.
func sessionRoutes() []routePolicy {
	var result []routePolicy
	for _, route := range routes {
		if route.Control != controlExchange {
			result = append(result, route)
		}
	}
	return result
}

// matrixRequest is a request from an active administrator with a session,
// exact origin, matching CSRF token, and a recent identity confirmation.
func matrixRequest(route routePolicy) *http.Request {
	req := trustedRequest(route.Method, matrixPath(route))
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, "current-csrf")
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
	return req
}

func matrixHandler(t *testing.T) (*Handler, handlerFixture) {
	t.Helper()
	handler, fixture := testHandler(true)
	principal := fixture.sessions.principals["current"]
	recent := time.Now().Add(-time.Minute)
	principal.StepUpAt = &recent
	fixture.sessions.principals["current"] = principal
	return handler, fixture
}

func rejectedAsUnauthenticated(code int) bool { return code == http.StatusUnauthorized }

func TestEveryAdminRouteFacesTheFullActorMatrix(t *testing.T) {
	for _, route := range sessionRoutes() {
		name := route.Method + " " + route.Path
		t.Run(name, func(t *testing.T) {
			for _, actor := range []struct {
				name       string
				arrange    func(*http.Request, handlerFixture)
				wantStatus int
				wantClear  bool
			}{
				{
					name:       "no admin cookie",
					arrange:    func(req *http.Request, _ handlerFixture) { req.Header.Del("Cookie") },
					wantStatus: http.StatusUnauthorized,
				},
				{
					name: "a public-site cookie only",
					arrange: func(req *http.Request, _ handlerFixture) {
						req.Header.Del("Cookie")
						req.AddCookie(&http.Cookie{Name: "cgn_session", Value: "current"})
					},
					wantStatus: http.StatusUnauthorized,
				},
				{
					name: "a malformed, unknown, revoked, or expired admin token",
					arrange: func(req *http.Request, _ handlerFixture) {
						req.Header.Del("Cookie")
						req.AddCookie(&http.Cookie{Name: "admin_session", Value: "not-a-session"})
						req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
					},
					wantStatus: http.StatusUnauthorized,
					wantClear:  true,
				},
				{
					name:       "an ordinary or school-admin-only identity",
					arrange:    func(_ *http.Request, fixture handlerFixture) { fixture.grants.err = adminaccess.ErrGrantNotFound },
					wantStatus: http.StatusForbidden,
				},
				{
					name: "a grant that is not the session's grant",
					arrange: func(_ *http.Request, fixture handlerFixture) {
						fixture.grants.grant.ID = "another-grant"
					},
					wantStatus: http.StatusForbidden,
				},
				{
					name:       "an identity the BFF did not vouch for",
					arrange:    func(req *http.Request, _ handlerFixture) { req.Header.Del(AccessEmailHeader) },
					wantStatus: http.StatusUnauthorized,
				},
			} {
				handler, fixture := matrixHandler(t)
				req := matrixRequest(route)
				actor.arrange(req, fixture)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, req)

				if response.Code != actor.wantStatus {
					t.Fatalf("%s: status = %d, want %d: %s", actor.name, response.Code, actor.wantStatus, response.Body.String())
				}
				if cleared := strings.Contains(strings.Join(response.Header().Values("Set-Cookie"), "\n"), "admin_session=;"); cleared != actor.wantClear {
					t.Fatalf("%s: cookie cleared = %v, want %v", actor.name, cleared, actor.wantClear)
				}
				assertPrivateHeaders(t, response.Header())
			}
		})
	}
}

func TestEveryRecentAuthRouteRefusesAStaleConfirmation(t *testing.T) {
	checked := 0
	for _, route := range sessionRoutes() {
		if !route.RequiresRecentAuth {
			continue
		}
		checked++
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			for _, stepUp := range []*time.Time{nil, timePointer(time.Now().Add(-11 * time.Minute))} {
				handler, fixture := matrixHandler(t)
				principal := fixture.sessions.principals["current"]
				principal.StepUpAt = stepUp
				fixture.sessions.principals["current"] = principal
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, matrixRequest(route))

				if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "recent_auth_required") {
					t.Fatalf("stale confirmation %v: status = %d body = %s", stepUp, response.Code, response.Body.String())
				}
			}
		})
	}
	if checked == 0 {
		t.Fatal("no route requires recent authentication; the matrix is not exercising it")
	}
}

// Only the declared capability opens a route: each capability is tried alone,
// and a read capability never opens a write.
func TestEachRouteOpensForItsOwnCapabilityAlone(t *testing.T) {
	var capabilities []adminaccess.Capability
	capabilities = append(capabilities, adminaccess.CapabilitiesForRole(adminaccess.RoleSiteAdmin)...)
	if len(capabilities) < 10 {
		t.Fatalf("only %d capabilities registered", len(capabilities))
	}
	declared := map[adminaccess.Capability]bool{}

	for _, route := range sessionRoutes() {
		if route.Capability != "" {
			declared[route.Capability] = true
		}
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			for _, held := range capabilities {
				handler, _ := matrixHandler(t)
				handler.allows = func(_ adminaccess.Role, needed adminaccess.Capability) bool { return needed == held }
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, matrixRequest(route))

				// Routes with no capability (logout, step-up) need only a session.
				open := route.Capability == "" || route.Capability == held
				denied := response.Code == http.StatusForbidden && strings.Contains(response.Body.String(), "site_admin_required")
				if open == denied || rejectedAsUnauthenticated(response.Code) {
					t.Fatalf("holding only %s: status = %d body = %s, route needs %q", held, response.Code, response.Body.String(), route.Capability)
				}
			}
		})
	}
	// Every declared capability is a real one, and every real capability guards
	// at least one route, so none is granted but unused.
	for _, capability := range capabilities {
		if !declared[capability] {
			t.Errorf("capability %s guards no route", capability)
		}
	}
	for capability := range declared {
		if !adminaccess.Allows(adminaccess.RoleSiteAdmin, capability) {
			t.Errorf("route declares %s, which no role holds", capability)
		}
	}
}

// Every mutation route checks the exact origin and the double-submit CSRF
// token before its handler runs; a rejected request never reaches it.
func TestEveryMutationRouteChecksOriginAndCSRFBeforeTheHandler(t *testing.T) {
	checked := 0
	for _, route := range sessionRoutes() {
		if !route.Mutation {
			continue
		}
		checked++
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			for _, attack := range []struct {
				name   string
				mutate func(*http.Request)
			}{
				{"no origin", func(req *http.Request) { req.Header.Del("Origin") }},
				{"a foreign origin", func(req *http.Request) { req.Header.Set("Origin", "https://attacker.test") }},
				{"a lookalike origin", func(req *http.Request) { req.Header.Set("Origin", "https://admin.example.test.attacker.test") }},
				{"no CSRF header", func(req *http.Request) { req.Header.Del(CSRFHeader) }},
				{"a wrong CSRF header", func(req *http.Request) { req.Header.Set(CSRFHeader, "not-the-token") }},
				{"a CSRF header without its cookie", func(req *http.Request) {
					req.Header.Del("Cookie")
					req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
				}},
			} {
				handler, fixture := matrixHandler(t)
				req := matrixRequest(route)
				attack.mutate(req)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, req)

				if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "admin_csrf_invalid") {
					t.Fatalf("%s: status = %d body = %s", attack.name, response.Code, response.Body.String())
				}
				repository := fixture.operations
				if repository.patchReportCalls+repository.patchSupportCalls != 0 {
					t.Fatalf("%s: the handler ran", attack.name)
				}
			}
		})
	}
	if checked < 15 {
		t.Fatalf("only %d mutation routes checked", checked)
	}
}

// Every mutation route draws on the write budget, and critical ones on the
// critical budget too, counted before the handler so malformed attempts spend
// it. The limit is the registered one, not a value the test supplies.
func TestEveryMutationRouteIsRateLimitedAtItsBudget(t *testing.T) {
	for _, route := range sessionRoutes() {
		// Logout is never limited, so an operator can always end a session.
		if !route.Mutation || route.Control == controlStepUp || route.Control == controlLogout {
			continue
		}
		budget := adminWriteLimit
		if criticalWrite(route) {
			budget = adminCriticalLimit
		}
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			handler, fixture := matrixHandler(t)
			now := time.Date(2026, time.September, 30, 12, 0, 0, 0, time.UTC)
			handler.now = func() time.Time { return now }
			principal := fixture.sessions.principals["current"]
			principal.StepUpAt = timePointer(now.Add(-time.Minute))
			fixture.sessions.principals["current"] = principal
			var statuses []int
			for attempt := 0; attempt <= budget; attempt++ {
				response := httptest.NewRecorder()
				req := matrixRequest(route)
				// Malformed: the wrong CSRF token, so the handler never runs.
				req.Header.Set(CSRFHeader, "not-the-token")
				handler.ServeHTTP(response, req)
				statuses = append(statuses, response.Code)
			}
			for index, status := range statuses[:budget] {
				if status == http.StatusTooManyRequests {
					t.Fatalf("attempt %d of %d was limited early", index+1, budget)
				}
			}
			if last := statuses[budget]; last != http.StatusTooManyRequests {
				t.Fatalf("attempt %d got %d, want 429", budget+1, last)
			}
		})
	}
}
