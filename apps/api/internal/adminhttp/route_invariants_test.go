package adminhttp

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
)

// These tests walk the route registry, so a route added later is held to the
// Admin API invariants without anyone extending a list: a session and a named
// capability, an exact origin and CSRF token on every state-changing method,
// and an audit or security record for every mutation. They need no database;
// the audit rows themselves are proven in mutation_audit_db_test.go.

func TestEveryRouteDeclaresItsAuthorizationAndMutationPolicy(t *testing.T) {
	if err := validateRoutePolicies(routes); err != nil {
		t.Fatal(err)
	}
	for _, route := range routes {
		name := route.Method + " " + route.Path
		if got := isMutationMethod(route.Method); got != route.Mutation && route.Control != controlExchange {
			t.Errorf("%s: state-changing method = %v but Mutation = %v, so CSRF would be skipped", name, got, route.Mutation)
		}
		switch route.Control {
		case controlCapability:
			if route.Capability == "" {
				t.Errorf("%s: no capability", name)
			}
		case controlExchange, controlStepUp, controlLogout:
			// The only routes without a capability: exchange creates the
			// session, and step-up and logout act on the caller's own session.
		default:
			t.Errorf("%s: unknown control %q", name, route.Control)
		}
	}
}

// Every registered route is served by a handler, not by the not-found
// fallback, so a registration cannot silently expose nothing or something
// unreviewed.
func TestEveryRegisteredRouteReachesAHandler(t *testing.T) {
	for _, route := range routes {
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			handler, _ := matrixHandler(t)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, matrixRequest(route))
			if response.Code == http.StatusNotFound || response.Code == http.StatusMethodNotAllowed {
				t.Fatalf("status = %d: %s", response.Code, response.Body.String())
			}
		})
	}
}

// A mutation refused for a missing or bad CSRF token leaves a denial in the
// security log tied to the acting session.
func TestEveryRefusedMutationLeavesOneDenialRecord(t *testing.T) {
	for _, route := range sessionRoutes() {
		if !route.Mutation {
			continue
		}
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			for _, mutate := range []func(*http.Request){
				func(req *http.Request) { req.Header.Del(CSRFHeader) },
				func(req *http.Request) { req.Header.Set(CSRFHeader, "not-the-token") },
			} {
				handler, fixture := matrixHandler(t)
				req := matrixRequest(route)
				mutate(req)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, req)

				if response.Code != http.StatusForbidden {
					t.Fatalf("status = %d: %s", response.Code, response.Body.String())
				}
				events := fixture.security.events
				if len(events) != 1 || events[0].Outcome != adminsecurity.OutcomeDenied ||
					events[0].AdminSessionID != "session-id" || events[0].Metadata.ReasonCode != "csrf_failed" {
					t.Fatalf("security events = %#v", events)
				}
			}
		})
	}
}

// Every capability mutation names its audit case, so the database test that
// proves one audit row, and a rollback without it, cannot miss a new route.
func TestEveryCapabilityMutationNamesItsAuditProof(t *testing.T) {
	logoTests, err := os.ReadFile("logos_db_test.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range routes {
		if !route.Mutation || route.Control != controlCapability {
			continue
		}
		_, tested := mutationCases[route.Operation]
		proof, elsewhere := mutationsCoveredByLogoTests[route.Operation]
		if tested == elsewhere {
			t.Errorf("mutation route %s %s (%s) must be in exactly one of the mutation table and the logo-test list", route.Method, route.Path, route.Operation)
		}
		if !elsewhere {
			continue
		}
		for _, name := range strings.Split(proof, ", ") {
			if !strings.Contains(string(logoTests), "func "+name+"(") {
				t.Errorf("%s names %s, which does not exist", route.Operation, name)
			}
		}
	}
	for operation := range mutationCases {
		found := false
		for _, route := range routes {
			found = found || route.Operation == operation
		}
		if !found {
			t.Errorf("mutation table names %s, which is not a registered route", operation)
		}
	}
}

// Session mutations outside the catalog record a security event in the same
// transaction as their effect. Each is listed by control, and the list is
// checked against the registry.
func TestEverySessionControlMutationRecordsASecurityEvent(t *testing.T) {
	want := map[routeControl]adminsecurity.EventType{
		controlStepUp: adminsecurity.EventStepUpSucceeded,
		controlLogout: adminsecurity.EventLogout,
	}
	for _, route := range routes {
		if route.Control != controlCapability && route.Control != controlExchange && want[route.Control] == "" {
			t.Fatalf("%s %s: session control %q has no security event", route.Method, route.Path, route.Control)
		}
	}
	for _, route := range routes {
		eventType, ok := want[route.Control]
		if !ok {
			continue
		}
		t.Run(route.Method+" "+route.Path, func(t *testing.T) {
			handler, fixture := matrixHandler(t)
			req := matrixRequest(route)
			req.Header.Set(AccessAssertionHeader, "fresh-assertion")
			fixture.identities.identity.Authenticated = time.Now().Add(-time.Second)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)

			if response.Code < 200 || response.Code >= 300 {
				t.Fatalf("status = %d: %s", response.Code, response.Body.String())
			}
			events := fixture.security.events
			if len(events) != 1 || events[0].Type != eventType || events[0].Outcome != adminsecurity.OutcomeSucceeded ||
				events[0].ActorUserID != "user-id" || events[0].AdminSessionID != "session-id" {
				t.Fatalf("security events = %#v", events)
			}
		})
	}
}
