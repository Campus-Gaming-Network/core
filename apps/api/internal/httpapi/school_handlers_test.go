package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
)

func TestHandleMySchoolsRequiresAuthentication(t *testing.T) {
	repository := &fakeFollowRepository{}
	handler := authenticatedMySchoolsHandler(repository)
	request := httptest.NewRequest(http.MethodGet, "/me/schools", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.listFollowedCalled {
		t.Fatal("ListFollowed was called for an unauthenticated request")
	}
}

func TestHandleMySchoolsReturnsFollowedSchools(t *testing.T) {
	repository := &fakeFollowRepository{followed: []schools.School{
		{
			ID:           "22222222-2222-2222-2222-222222222222",
			Name:         "Example University",
			Slug:         "example-university",
			City:         "Irvine",
			State:        "CA",
			IsMainCampus: true,
		},
	}}
	handler := authenticatedMySchoolsHandler(repository)
	rawToken, _, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/me/schools", nil)
	request.AddCookie(&http.Cookie{Name: "session", Value: rawToken})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Schools []schools.School `json:"schools"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Schools) != 1 || payload.Schools[0].Slug != "example-university" {
		t.Fatalf("schools = %#v, want followed school payload", payload.Schools)
	}
}

func TestHandleSchoolsReturnsExplicitPageMetadata(t *testing.T) {
	listed := make([]schools.School, 0, 26)
	for index := 0; index < 26; index++ {
		listed = append(listed, schools.School{
			ID:    fmt.Sprintf("33333333-3333-3333-3333-%012d", index+1),
			Name:  fmt.Sprintf("Example University %02d", index+1),
			Slug:  fmt.Sprintf("example-university-%02d", index+1),
			State: "CA",
		})
	}
	repository := &fakeSchoolRepository{listed: listed}
	router := &Router{schools: repository}
	request := httptest.NewRequest(http.MethodGet, "/schools?q=example&state=ca&limit=25&offset=25", nil)
	response := httptest.NewRecorder()

	router.handleSchools(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listCalled || repository.listParams.Query != "example" || repository.listParams.State != "CA" {
		t.Fatalf("list params = %#v, want normalized filters", repository.listParams)
	}
	if repository.listParams.Limit != 26 || repository.listParams.Offset != 25 {
		t.Fatalf("list params = %#v, want a lookahead page at offset 25", repository.listParams)
	}
	var payload struct {
		Schools []schools.School `json:"schools"`
		Limit   int              `json:"limit"`
		Offset  int              `json:"offset"`
		HasMore bool             `json:"has_more"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Schools) != 25 || payload.Limit != 25 || payload.Offset != 25 || !payload.HasMore {
		t.Fatalf("page = %#v, want 25 schools with another page", payload)
	}
}

func TestHandleSchoolsRejectsNegativeOffset(t *testing.T) {
	repository := &fakeSchoolRepository{}
	router := &Router{schools: repository}
	request := httptest.NewRequest(http.MethodGet, "/schools?offset=-1", nil)
	response := httptest.NewRecorder()

	router.handleSchools(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if repository.listCalled {
		t.Fatal("List was called for a negative offset")
	}
}
