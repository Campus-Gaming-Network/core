package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
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

func TestClubRoutes(t *testing.T) {
	router := &Router{mux: http.NewServeMux(), clubs: fakeClubs{}}
	router.registerPublicRoutes()
	for _, test := range []struct {
		method, path string
		status       int
		body         string
	}{
		{http.MethodGet, "/clubs/esports-program", http.StatusOK, `{"id":"club-1","name":"Esports Program","slug":"esports-program","type":"university_program","summary":"","school":{"id":"","name":"","slug":""},"games":[],"links":[],"claimed":false}` + "\n"},
		{http.MethodGet, "/clubs/hidden-guild", http.StatusNotFound, `{"error":"club_not_found"}` + "\n"},
		{http.MethodPost, "/clubs/esports-program", http.StatusMethodNotAllowed, ""},
		{http.MethodGet, "/schools/club-university/clubs", http.StatusOK, `{"clubs":[{"id":"club-1","name":"Esports Program","slug":"esports-program","type":"university_program","summary":"","games":[],"claimed":false}]}` + "\n"},
		{http.MethodGet, "/schools/no-such-school/clubs", http.StatusNotFound, `{"error":"school_not_found"}` + "\n"},
	} {
		response := httptest.NewRecorder()
		router.mux.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.status || (test.body != "" && response.Body.String() != test.body) {
			t.Errorf("%s %s = %d %s, want %d %s", test.method, test.path, response.Code, response.Body.String(), test.status, test.body)
		}
	}
}
