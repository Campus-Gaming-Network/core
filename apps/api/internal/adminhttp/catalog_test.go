package adminhttp

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
)

func TestCatalogRoutesEnforceActorAndMutationBoundaries(t *testing.T) {
	for _, route := range catalogRoutes {
		for _, scenario := range []string{"public-session", "revoked-grant", "school-admin", "changed-grant", "unavailable", "csrf", "origin", "step-up"} {
			if (scenario == "csrf" || scenario == "origin") && !route.Mutation {
				continue
			}
			if scenario == "step-up" && !route.RequiresRecentAuth {
				continue
			}
			t.Run(string(route.Operation)+"/"+scenario, func(t *testing.T) {
				handler, fixture := testHandler(true)
				path := strings.NewReplacer("{id}", testReportID, "{grant_id}", testTicketID).Replace(route.Path)
				req := trustedRequest(route.Method, path)
				req.Header.Set("Origin", "https://admin.example.test")
				req.Header.Set(CSRFHeader, "current-csrf")
				req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: "current-csrf"})
				principal := fixture.sessions.principals["current"]
				stepUp := time.Now().Add(-time.Minute)
				principal.StepUpAt = &stepUp
				fixture.sessions.principals["current"] = principal
				want := 403
				if scenario == "public-session" {
					req.AddCookie(&http.Cookie{Name: "cgn_session", Value: "current"})
					want = 401
				} else {
					req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
				}
				switch scenario {
				case "revoked-grant":
					fixture.grants.err = adminaccess.ErrGrantNotFound
				case "school-admin":
					fixture.grants.grant.Role = "school_admin"
				case "changed-grant":
					fixture.grants.grant.ID = "stale"
				case "unavailable":
					fixture.grants.err = errors.New("database unavailable")
					want = 503
				case "csrf":
					req.Header.Del(CSRFHeader)
				case "origin":
					req.Header.Set("Origin", "https://attacker.test")
				case "step-up":
					principal.StepUpAt = nil
					fixture.sessions.principals["current"] = principal
				}
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, req)
				if response.Code != want {
					t.Fatalf("status %d want %d: %s", response.Code, want, response.Body.String())
				}
				assertPrivateHeaders(t, response.Header())
			})
		}
	}
}
