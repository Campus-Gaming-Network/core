package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
)

func TestHandleTeamsReturnsPublicTeamsWithFilters(t *testing.T) {
	repository := &fakeTeamRepository{listed: []teamstore.Team{testTeam()}}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodGet, "/teams?game=rocket-league&school=example-university&limit=5", nil)
	response := httptest.NewRecorder()

	router.handleTeams(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listPublicCalled {
		t.Fatal("ListPublic was not called")
	}
	if repository.listParams.GameSlug != "rocket-league" || repository.listParams.SchoolSlug != "example-university" {
		t.Fatalf("list params = %#v, want game and school filters", repository.listParams)
	}
	if repository.listParams.Limit != 6 || repository.listParams.After != nil || repository.listParams.Before != nil {
		t.Fatalf("list params = %#v, want a six-row first-page fetch", repository.listParams)
	}
	var payload struct {
		Teams       []teamstore.Team `json:"teams"`
		Limit       int              `json:"limit"`
		HasMore     bool             `json:"has_more"`
		HasPrevious bool             `json:"has_previous"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Teams) != 1 || payload.Teams[0].Slug != "varsity-rocket-league" {
		t.Fatalf("teams = %#v, want public team payload", payload.Teams)
	}
	if payload.Limit != 5 || payload.HasMore || payload.HasPrevious {
		t.Fatalf("pagination = %#v, want a single first page", payload)
	}
}

func TestHandleTeamsProvidesStableNextAndPreviousCursors(t *testing.T) {
	teams := make([]teamstore.Team, 0, 6)
	for index := 0; index < 6; index++ {
		team := testTeam()
		team.ID = fmt.Sprintf("55555555-5555-5555-5555-%012d", index+1)
		team.CreatedAt = time.Date(2026, time.September, 5, 12-index, 0, 0, 0, time.UTC)
		teams = append(teams, team)
	}
	repository := &fakeTeamRepository{listed: teams}
	router := &Router{teams: repository}
	firstResponse := httptest.NewRecorder()

	router.handleTeams(firstResponse, httptest.NewRequest(http.MethodGet, "/teams?limit=5", nil))

	var firstPage struct {
		Teams      []teamstore.Team `json:"teams"`
		HasMore    bool             `json:"has_more"`
		NextCursor string           `json:"next_cursor"`
	}
	if err := json.NewDecoder(firstResponse.Body).Decode(&firstPage); err != nil {
		t.Fatalf("decode first page: %v", err)
	}
	if len(firstPage.Teams) != 5 || !firstPage.HasMore || firstPage.NextCursor == "" {
		t.Fatalf("first page = %#v, want five teams and a next cursor", firstPage)
	}

	repository.listed = teams[5:]
	secondResponse := httptest.NewRecorder()
	router.handleTeams(secondResponse, httptest.NewRequest(http.MethodGet, "/teams?limit=5&after="+firstPage.NextCursor, nil))

	if repository.listParams.After == nil || repository.listParams.After.ID != teams[4].ID || !repository.listParams.After.Timestamp.Equal(teams[4].CreatedAt) {
		t.Fatalf("after cursor = %#v, want the first page boundary", repository.listParams.After)
	}
	var secondPage struct {
		Teams          []teamstore.Team `json:"teams"`
		HasMore        bool             `json:"has_more"`
		HasPrevious    bool             `json:"has_previous"`
		PreviousCursor string           `json:"previous_cursor"`
	}
	if err := json.NewDecoder(secondResponse.Body).Decode(&secondPage); err != nil {
		t.Fatalf("decode second page: %v", err)
	}
	if len(secondPage.Teams) != 1 || secondPage.HasMore || !secondPage.HasPrevious || secondPage.PreviousCursor == "" {
		t.Fatalf("second page = %#v, want the final team and a previous cursor", secondPage)
	}
}

func TestHandleMyTeamsRequiresAuthentication(t *testing.T) {
	repository := &fakeTeamRepository{}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodGet, "/me/teams", nil)
	response := httptest.NewRecorder()

	router.handleMyTeams(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.listForUserCalled {
		t.Fatal("ListForUser was called for unauthenticated request")
	}
}

func TestHandleMyTeamsReturnsUserTeams(t *testing.T) {
	role := teamstore.RoleCaptain
	team := testTeam()
	team.ViewerRole = &role
	repository := &fakeTeamRepository{listedForUser: []teamstore.Team{team}}
	handler := authenticatedMyTeamsHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/me/teams?limit=3", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listForUserCalled {
		t.Fatal("ListForUser was not called")
	}
	if repository.listForUserID != testUserID || repository.listForUserLimit != 3 {
		t.Fatalf("ListForUser = user %q limit %d, want session user and query limit", repository.listForUserID, repository.listForUserLimit)
	}
	var payload struct {
		Teams []teamstore.Team `json:"teams"`
		Limit int              `json:"limit"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Limit != 3 {
		t.Fatalf("limit = %d, want 3", payload.Limit)
	}
	if len(payload.Teams) != 1 || payload.Teams[0].ViewerRole == nil || *payload.Teams[0].ViewerRole != teamstore.RoleCaptain {
		t.Fatalf("teams = %#v, want team with captain viewer role", payload.Teams)
	}
}

func TestHandleCreateTeamRequiresAuthentication(t *testing.T) {
	repository := &fakeTeamRepository{}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodPost, "/teams", strings.NewReader(validCreateTeamJSON()))
	response := httptest.NewRecorder()

	router.handleTeams(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.createCalled {
		t.Fatal("Create was called for unauthenticated request")
	}
}

func TestHandleCreateTeamCreatesTeam(t *testing.T) {
	repository := &fakeTeamRepository{}
	handler := authenticatedTeamsHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams", validCreateTeamJSON())
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.createCalled {
		t.Fatal("Create was not called")
	}
	if repository.createParams.OwnerUserID != testUserID {
		t.Fatalf("OwnerUserID = %q, want session user", repository.createParams.OwnerUserID)
	}
	if repository.createParams.PasswordHash == "" || repository.createParams.PasswordHash == "TeamPass8" {
		t.Fatalf("PasswordHash = %q, want non-plaintext hash", repository.createParams.PasswordHash)
	}
	if !auth.ComparePassword(repository.createParams.PasswordHash, "TeamPass8") {
		t.Fatal("PasswordHash does not verify against original password")
	}
	if len(repository.createParams.GameIDs) != 1 || repository.createParams.GameIDs[0] != "44444444-4444-4444-4444-444444444444" {
		t.Fatalf("GameIDs = %#v, want request game IDs", repository.createParams.GameIDs)
	}
}

func TestHandleCreateTeamMapsMissingSchoolAndGame(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{name: "missing school", err: teamstore.ErrSchoolNotFound, code: "team_school_not_found"},
		{name: "missing game", err: teamstore.ErrGameNotFound, code: "team_game_not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeTeamRepository{err: tc.err}
			handler := authenticatedTeamsHandler(repository)
			request := authenticatedEventRequest(http.MethodPost, "/teams", validCreateTeamJSON())
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusUnprocessableEntity, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), tc.code) {
				t.Fatalf("body = %s, want %q", response.Body.String(), tc.code)
			}
		})
	}
}

func TestHandleTeamPathReturnsPublicDetail(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam()}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodGet, "/teams/varsity-rocket-league", nil)
	response := httptest.NewRecorder()

	router.handleTeamPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload teamstore.Team
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Name != "Varsity Rocket League" {
		t.Fatalf("name = %q, want team detail", payload.Name)
	}
}

func TestHandleTeamPathReturnsViewerRoleForAuthenticatedDetail(t *testing.T) {
	repository := &fakeTeamRepository{
		detail:     testTeam(),
		viewerRole: teamstore.RoleOwner,
		members:    testTeamMembers(),
	}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/teams/varsity-rocket-league", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload teamstore.Team
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerRole == nil || *payload.ViewerRole != teamstore.RoleOwner {
		t.Fatalf("ViewerRole = %#v, want owner", payload.ViewerRole)
	}
	if !repository.listMembersCalled {
		t.Fatal("ListMembers was not called for owner viewer")
	}
	if len(payload.Members) != 3 || payload.Members[1].Role != teamstore.RoleCaptain {
		t.Fatalf("Members = %#v, want owner roster with captain", payload.Members)
	}
}

func TestHandleJoinTeamRequiresAuthentication(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam()}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodPost, "/teams/varsity-rocket-league/join", strings.NewReader(`{"password":"TeamPass8"}`))
	response := httptest.NewRecorder()

	router.handleTeamPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.joinCalled {
		t.Fatal("Join was called for unauthenticated request")
	}
}

func TestHandleJoinTeamRejectsWrongPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("TeamPass8")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	repository := &fakeTeamRepository{
		detail:       testTeam(),
		passwordHash: passwordHash,
	}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/join", `{"password":"WrongPass8"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if repository.joinCalled {
		t.Fatal("Join was called for wrong password")
	}
	if !strings.Contains(response.Body.String(), "invalid_team_password") {
		t.Fatalf("body = %s, want invalid_team_password", response.Body.String())
	}
}

func TestHandleJoinTeamJoinsWithCorrectPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("TeamPass8")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	repository := &fakeTeamRepository{
		detail:       testTeam(),
		passwordHash: passwordHash,
	}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/join", `{"password":"TeamPass8"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.joinCalled {
		t.Fatal("Join was not called")
	}
	if repository.joinSlug != "varsity-rocket-league" || repository.joinUserID != testUserID {
		t.Fatalf("join = slug %q user %q, want slug and session user", repository.joinSlug, repository.joinUserID)
	}
	var payload teamstore.Team
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerRole == nil || *payload.ViewerRole != teamstore.RoleMember {
		t.Fatalf("ViewerRole = %#v, want member", payload.ViewerRole)
	}
}

func TestHandleSetTeamCaptainRequiresAuthentication(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam()}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodPost, "/teams/varsity-rocket-league/captains", strings.NewReader(`{"user_id":"`+testTeamMemberID+`","captain":true}`))
	response := httptest.NewRecorder()

	router.handleTeamPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.setCaptainCalled {
		t.Fatal("SetCaptain was called for unauthenticated request")
	}
}

func TestHandleSetTeamCaptainPromotesMember(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam()}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/captains", `{"user_id":"`+testTeamMemberID+`","captain":true}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.setCaptainCalled {
		t.Fatal("SetCaptain was not called")
	}
	if repository.setCaptainSlug != "varsity-rocket-league" ||
		repository.setCaptainOwnerID != testUserID ||
		repository.setCaptainUserID != testTeamMemberID ||
		!repository.setCaptainValue {
		t.Fatalf("SetCaptain call = slug %q owner %q user %q captain %v",
			repository.setCaptainSlug,
			repository.setCaptainOwnerID,
			repository.setCaptainUserID,
			repository.setCaptainValue)
	}
}

func TestHandleSetTeamCaptainMapsNonOwner(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam(), err: teamstore.ErrNotTeamOwner}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/captains", `{"user_id":"`+testTeamMemberID+`","captain":false}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "not_team_owner") {
		t.Fatalf("body = %s, want not_team_owner", response.Body.String())
	}
}

func TestHandleTransferTeamOwnershipTransfersToMember(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam()}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/transfer-ownership", `{"new_owner_user_id":"`+testTeamCaptainID+`"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.transferCalled {
		t.Fatal("TransferOwnership was not called")
	}
	if repository.transferSlug != "varsity-rocket-league" ||
		repository.transferOwnerID != testUserID ||
		repository.transferNewOwnerID != testTeamCaptainID {
		t.Fatalf("TransferOwnership call = slug %q owner %q new owner %q",
			repository.transferSlug,
			repository.transferOwnerID,
			repository.transferNewOwnerID)
	}
	var payload teamstore.Team
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.OwnerUserID != testTeamCaptainID {
		t.Fatalf("OwnerUserID = %q, want transferred owner", payload.OwnerUserID)
	}
}

func TestHandleTransferTeamOwnershipMapsMissingMember(t *testing.T) {
	repository := &fakeTeamRepository{detail: testTeam(), err: teamstore.ErrTeamMemberNotFound}
	handler := authenticatedTeamPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/transfer-ownership", `{"new_owner_user_id":"`+testTeamCaptainID+`"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusUnprocessableEntity, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "team_member_not_found") {
		t.Fatalf("body = %s, want team_member_not_found", response.Body.String())
	}
}
