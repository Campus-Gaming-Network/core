package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

// fakeClubs serves one club at one school.
type fakeClubs struct{}

func (fakeClubs) GetBySlug(_ context.Context, slug string) (clubs.Club, error) {
	if slug != "esports-program" {
		return clubs.Club{}, clubs.ErrClubNotFound
	}
	return clubs.Club{ID: "club-1", Name: "Esports Program", Slug: slug, Type: clubs.TypeUniversityProgram, Games: []clubs.GameSummary{}, Links: []clubs.Link{}}, nil
}

func (fakeClubs) ListBySchool(_ context.Context, schoolSlug string) ([]clubs.ListItem, error) {
	if schoolSlug != "club-university" {
		return nil, clubs.ErrSchoolNotFound
	}
	return []clubs.ListItem{{ID: "club-1", Name: "Esports Program", Slug: "esports-program", Type: clubs.TypeUniversityProgram, Games: []clubs.GameSummary{}}}, nil
}

// List answers with two clubs from two schools and records what it was asked.
func (fakeClubs) List(_ context.Context, params clubs.ListParams) ([]clubs.ListItem, error) {
	listed = append(listed, params)
	all := []clubs.ListItem{
		{ID: "11111111-1111-1111-1111-111111111111", Name: "Esports Program", Slug: "esports-program", Type: clubs.TypeUniversityProgram, Games: []clubs.GameSummary{}, School: &clubs.SchoolSummary{ID: "school-1", Name: "Club University", Slug: "club-university"}, SortKey: "esports program"},
		{ID: "22222222-2222-2222-2222-222222222222", Name: "Smash Club", Slug: "smash-club", Type: clubs.TypeStudentClub, Games: []clubs.GameSummary{}, School: &clubs.SchoolSummary{ID: "school-2", Name: "Quiet College", Slug: "quiet-college"}, SortKey: "smash club"},
	}
	if params.Limit < len(all) {
		return all[:params.Limit], nil
	}
	return all, nil
}

var listed []clubs.ListParams

// SubmitClaim and SubmitRequest record what they were sent and accept it.
func (fakeClubs) SubmitClaim(_ context.Context, input clubs.ClaimInput) (clubs.ClaimReceipt, error) {
	submitted = append(submitted, input)
	return clubs.ClaimReceipt{Status: clubs.ClaimPending}, nil
}

func (fakeClubs) SubmitRequest(_ context.Context, input clubs.RequestInput) (clubs.ClaimReceipt, error) {
	submitted = append(submitted, input)
	return clubs.ClaimReceipt{Status: clubs.ClaimPending}, nil
}

var submitted []any

func TestClubRoutes(t *testing.T) {
	router := &Router{mux: http.NewServeMux(), clubs: fakeClubs{}}
	router.registerPublicRoutes()
	for _, test := range []struct {
		method, path string
		status       int
		body         string
	}{
		{http.MethodGet, "/clubs/esports-program", http.StatusOK, `{"id":"club-1","name":"Esports Program","slug":"esports-program","type":"university_program","summary":"","school":{"id":"","name":"","slug":""},"games":[],"links":[],"claimed":false,"member_count":0}` + "\n"},
		{http.MethodGet, "/clubs/hidden-guild", http.StatusNotFound, `{"error":"club_not_found"}` + "\n"},
		{http.MethodPost, "/clubs/esports-program", http.StatusMethodNotAllowed, ""},
		{http.MethodGet, "/schools/club-university/clubs", http.StatusOK, `{"clubs":[{"id":"club-1","name":"Esports Program","slug":"esports-program","type":"university_program","summary":"","games":[],"claimed":false}]}` + "\n"},
		{http.MethodGet, "/schools/no-such-school/clubs", http.StatusNotFound, `{"error":"school_not_found"}` + "\n"},
		{http.MethodGet, "/clubs", http.StatusOK, `{"clubs":[{"id":"11111111-1111-1111-1111-111111111111","name":"Esports Program","slug":"esports-program","type":"university_program","summary":"","games":[],"claimed":false,"school":{"id":"school-1","name":"Club University","slug":"club-university"}},{"id":"22222222-2222-2222-2222-222222222222","name":"Smash Club","slug":"smash-club","type":"student_club","summary":"","games":[],"claimed":false,"school":{"id":"school-2","name":"Quiet College","slug":"quiet-college"}}],"has_more":false,"has_previous":false,"limit":25}` + "\n"},
		{http.MethodGet, "/clubs?type=guild", http.StatusBadRequest, `{"error":"invalid_type"}` + "\n"},
		{http.MethodGet, "/clubs?after=not-a-cursor", http.StatusBadRequest, `{"error":"invalid_cursor"}` + "\n"},
		{http.MethodGet, "/clubs?limit=0", http.StatusBadRequest, `{"error":"invalid_limit"}` + "\n"},
		{http.MethodGet, "/clubs?q=" + strings.Repeat("a", 101), http.StatusBadRequest, `{"error":"invalid_query"}` + "\n"},
		{http.MethodPost, "/clubs", http.StatusMethodNotAllowed, ""},
	} {
		response := httptest.NewRecorder()
		router.mux.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.status || (test.body != "" && response.Body.String() != test.body) {
			t.Errorf("%s %s = %d %s, want %d %s", test.method, test.path, response.Code, response.Body.String(), test.status, test.body)
		}
	}
}

func TestClubDirectoryPassesFiltersAndPages(t *testing.T) {
	router := &Router{mux: http.NewServeMux(), clubs: fakeClubs{}}
	router.registerPublicRoutes()
	listed = nil

	response := httptest.NewRecorder()
	router.mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/clubs?q=+smash+&school=quiet-college&type=student_club&game=melee&limit=1", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET /clubs = %d %s", response.Code, response.Body.String())
	}
	want := []clubs.ListParams{{Query: "smash", SchoolSlug: "quiet-college", Type: clubs.TypeStudentClub, GameSlug: "melee", Limit: 2}}
	if !reflect.DeepEqual(listed, want) {
		t.Fatalf("List() params = %+v, want %+v", listed, want)
	}
	next := pagecursor.EncodeKey("esports program", "11111111-1111-1111-1111-111111111111")
	if !strings.Contains(response.Body.String(), `"has_more":true`) || !strings.Contains(response.Body.String(), `"next_cursor":"`+next+`"`) {
		t.Fatalf("GET /clubs?limit=1 = %s, want has_more and the first club's cursor", response.Body.String())
	}
}

func TestClubClaimsNeedASignedInUser(t *testing.T) {
	router := &Router{mux: http.NewServeMux(), clubs: fakeClubs{}}
	router.registerPublicRoutes()
	submitted = nil
	handler := signedIn(router.mux.ServeHTTP)
	for _, test := range []struct {
		request *http.Request
		status  int
		body    string
	}{
		{httptest.NewRequest(http.MethodPost, "/clubs/esports-program/claims", strings.NewReader(`{"evidence_text":"I am the president"}`)), http.StatusUnauthorized, `{"error":"authentication_required"}`},
		{httptest.NewRequest(http.MethodPost, "/schools/club-university/club-requests", strings.NewReader(`{"name":"Chess Club"}`)), http.StatusUnauthorized, `{"error":"authentication_required"}`},
		{authenticatedEventRequest(http.MethodPost, "/clubs/esports-program/claims", `{"evidence_text":"I am the president","evidence_url":"https://example.edu/esports"}`), http.StatusCreated, `{"status":"pending"}`},
		{authenticatedEventRequest(http.MethodPost, "/schools/club-university/club-requests", `{"name":"Chess Club","type":"student_club","evidence_text":"I am the treasurer"}`), http.StatusCreated, `{"status":"pending"}`},
		{authenticatedEventRequest(http.MethodGet, "/schools/club-university/club-requests", ""), http.StatusMethodNotAllowed, ""},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, test.request)
		if response.Code != test.status || (test.body != "" && strings.TrimSpace(response.Body.String()) != test.body) {
			t.Errorf("%s %s = %d %s, want %d %s", test.request.Method, test.request.URL.Path, response.Code, response.Body.String(), test.status, test.body)
		}
	}
	want := []any{
		clubs.ClaimInput{UserID: testUserID, ClubSlug: "esports-program", ClaimEvidence: clubs.ClaimEvidence{Text: "I am the president", URL: "https://example.edu/esports"}},
		clubs.RequestInput{UserID: testUserID, SchoolSlug: "club-university", Name: "Chess Club", Type: clubs.TypeStudentClub, ClaimEvidence: clubs.ClaimEvidence{Text: "I am the treasurer"}},
	}
	if !reflect.DeepEqual(submitted, want) {
		t.Fatalf("submitted = %+v, want %+v", submitted, want)
	}
}
