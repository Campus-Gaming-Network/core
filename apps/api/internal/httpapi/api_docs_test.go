package httpapi

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminhttp"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
)

// The API docs list every route as a Markdown table row whose first cell is
// the HTTP method and whose second cell is the path in backticks:
//
//	| GET | `/events/:slug` | Notes |
//
// Path parameters are written `:name`. A query string after `?` is ignored. A
// route is not implemented yet when its row says **(planned)** or sits under a
// heading that says (later). These tests compare those rows with the routes the
// Go API registers, in both directions.
//
// The public routes are documented in docs/04-api.md. The Admin API routes are
// documented in docs/20-admin-console-v1-engineering-plan.md, because the
// Admin API section of docs/04-api.md summarizes them in prose.

const (
	publicAPIDoc = "04-api.md"
	adminAPIDoc  = "20-admin-console-v1-engineering-plan.md"
	adminPrefix  = "/admin/v1"
)

// knownPublicDocDrift lists public routes whose docs/04-api.md row disagrees
// with the router today. The key is "METHOD /path" with parameters as {}. Fix
// the doc, then delete the entry; a listed entry that no longer disagrees fails
// the test.
var knownPublicDocDrift = map[string]string{}

// knownAdminDocDrift is the same allowlist for the Admin API routes against
// the engineering plan.
var knownAdminDocDrift = map[string]string{}

var (
	docRoutePattern = regexp.MustCompile("^\\|\\s*(GET|POST|PUT|PATCH|DELETE)\\s*\\|\\s*`([^`]+)`\\s*\\|(.*)$")
	docParamPattern = regexp.MustCompile(`:[A-Za-z_]+|\{[A-Za-z_]+\}`)
	probeMethods    = []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}
)

const notFoundBody = "404 page not found\n"

type docRoute struct {
	Method  string
	Path    string // parameters normalized to {}
	Probe   string // the path with parameters filled in
	Planned bool
	Line    int
}

func (route docRoute) key() string { return route.Method + " " + route.Path }

func normalizeRoutePath(path string) string {
	return docParamPattern.ReplaceAllString(path, "{}")
}

func readDocRoutes(t *testing.T, name string) []docRoute {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", name))
	if err != nil {
		t.Fatal(err)
	}
	var routes []docRoute
	later := false
	for index, line := range strings.Split(string(content), "\n") {
		if strings.HasPrefix(line, "#") {
			later = strings.Contains(line, "(later)")
			continue
		}
		match := docRoutePattern.FindStringSubmatch(line)
		if match == nil || !strings.HasPrefix(match[2], "/") {
			continue
		}
		path, _, _ := strings.Cut(match[2], "?")
		routes = append(routes, docRoute{
			Method:  match[1],
			Path:    normalizeRoutePath(path),
			Probe:   docParamPattern.ReplaceAllString(path, "00000000-0000-0000-0000-000000000001"),
			Planned: later || strings.Contains(match[3], "(planned)"),
			Line:    index + 1,
		})
	}
	return routes
}

func sortedKeys(set map[string]string) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// checkDrift fails for every disagreement not in the allowlist, and for every
// allowlist entry that no longer corresponds to a disagreement.
func checkDrift(t *testing.T, found map[string]string, allowed map[string]string) {
	t.Helper()
	for _, key := range sortedKeys(found) {
		if _, ok := allowed[key]; !ok {
			t.Errorf("%s", found[key])
		}
	}
	for _, key := range sortedKeys(allowed) {
		if _, ok := found[key]; !ok {
			t.Errorf("the known-drift allowlist lists %q, which no longer disagrees with the docs; delete the entry", key)
		}
	}
}

func TestAdminAPIRoutesMatchTheEngineeringPlan(t *testing.T) {
	registered := map[string]bool{}
	for _, route := range adminhttp.Routes() {
		registered[route.Method+" "+normalizeRoutePath(route.Path)] = true
	}
	documented := map[string]docRoute{}
	for _, route := range readDocRoutes(t, adminAPIDoc) {
		if strings.HasPrefix(route.Path, adminPrefix+"/") {
			documented[route.key()] = route
		}
	}

	found := map[string]string{}
	for key := range registered {
		if route, ok := documented[key]; !ok || route.Planned {
			found[key] = "the Admin API registers " + key + ", which docs/" + adminAPIDoc + " does not document"
		}
	}
	for key, route := range documented {
		if !registered[key] && !route.Planned {
			found[key] = "docs/" + adminAPIDoc + ":" + strconv.Itoa(route.Line) + " documents " + key + ", which the Admin API does not register"
		}
	}
	checkDrift(t, found, knownAdminDocDrift)
}

// publicRouteFixture serves the router's real public route registration over
// fake stores, behind a signed-in session, so a handler reaches its method and
// path checks instead of answering 503 or 401 first.
func publicRouteFixture() http.Handler {
	people := newPeopleFixture(eventstore.Event{})
	verification, _, _ := newVerificationRouter("token")
	directory := &fakeSchoolDirectory{school: schools.School{Slug: "sample"}}
	router := &Router{
		cfg:     config.Config{SessionCookie: "session", SessionTTL: time.Hour, MaintenanceToken: "maintenance"},
		mux:     http.NewServeMux(),
		schools: directory,
		catalog: schools.NewCachedRepository(directory, nil),
		follows: &fakeFollowRepository{},
		events:  people.events,
		teams:   people.teams,
		people:  people.people,
		safety:  &fakeSafetyRepository{},
		account: verification.account,
	}
	router.registerPublicRoutes()
	return auth.WithSession(
		fakeSessionStore{session: auth.Session{
			ID:        "session-id",
			UserID:    testUserID,
			ExpiresAt: time.Now().Add(time.Hour),
		}},
		auth.SessionCookieConfig{Name: "session", TTL: time.Hour},
	)(router.mux)
}

// routed reports whether the router has a handler for the method and path.
// Unmatched requests get the standard plain-text 404; an unsupported method
// gets the API's 405. Any other answer, including a JSON 404 such as
// school_not_found, came from a handler.
func routed(handler http.Handler, method, path string) bool {
	request := httptest.NewRequest(method, path, strings.NewReader("{}"))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "session", Value: "current"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code == http.StatusMethodNotAllowed {
		return false
	}
	return !(response.Code == http.StatusNotFound && response.Body.String() == notFoundBody)
}

func firstSegment(path string) string {
	return strings.SplitN(strings.TrimPrefix(path, "/"), "/", 2)[0]
}

// registeredTopLevelSegments returns the first path segment of every pattern
// that registerPublicRoutes passes to the mux, read from the Go source.
func registeredTopLevelSegments(t *testing.T) map[string]bool {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "router.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	segments := map[string]bool{}
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Name.Name != "registerPublicRoutes" {
			continue
		}
		ast.Inspect(function, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			literal, ok := call.Args[0].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			pattern, err := strconv.Unquote(literal.Value)
			if err == nil && pattern != "/" {
				segments[firstSegment(pattern)] = true
			}
			return true
		})
	}
	if len(segments) == 0 {
		t.Fatal("found no routes in registerPublicRoutes")
	}
	return segments
}

func TestPublicAPIRoutesMatchTheAPIDoc(t *testing.T) {
	handler := publicRouteFixture()
	var documented []docRoute
	for _, route := range readDocRoutes(t, publicAPIDoc) {
		if !strings.HasPrefix(route.Path, adminPrefix) {
			documented = append(documented, route)
		}
	}
	documentedKeys := map[string]bool{}
	documentedSegments := map[string]bool{}
	found := map[string]string{}
	where := func(route docRoute) string { return "docs/" + publicAPIDoc + ":" + strconv.Itoa(route.Line) }

	for _, route := range documented {
		documentedKeys[route.key()] = true
		documentedSegments[firstSegment(route.Path)] = true
		switch isRouted := routed(handler, route.Method, route.Probe); {
		case isRouted && route.Planned:
			found[route.key()] = where(route) + " marks " + route.key() + " as planned or later, but the router serves it"
		case !isRouted && !route.Planned:
			found[route.key()] = where(route) + " documents " + route.key() + ", which the router does not serve"
		}
	}

	// A method the router accepts on a documented path must be documented too.
	for _, route := range documented {
		for _, method := range probeMethods {
			key := method + " " + route.Path
			if !documentedKeys[key] && routed(handler, method, route.Probe) {
				found[key] = "the router serves " + key + ", which docs/" + publicAPIDoc + " does not document"
			}
		}
	}

	// A path the router registers must start with a documented segment.
	for segment := range registeredTopLevelSegments(t) {
		if segment != "admin" && !documentedSegments[segment] {
			found["/"+segment] = "the router registers /" + segment + ", which docs/" + publicAPIDoc + " does not document"
		}
	}
	checkDrift(t, found, knownPublicDocDrift)
}
