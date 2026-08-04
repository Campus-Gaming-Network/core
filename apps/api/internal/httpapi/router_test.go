package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

const (
	testUserID        = "11111111-1111-1111-1111-111111111111"
	testTeamMemberID  = "66666666-6666-6666-6666-666666666666"
	testTeamCaptainID = "77777777-7777-7777-7777-777777777777"
)

type fakeSessionStore struct {
	session auth.Session
	err     error
}

func (s fakeSessionStore) FindSession(_ context.Context, _ []byte) (auth.Session, error) {
	return s.session, s.err
}

type fakeFollowRepository struct {
	listFollowedCalled bool
	followed           []schools.School
	err                error
}

type fakeUserRepository struct {
	profile users.Profile
	err     error
}

func (r *fakeUserRepository) Create(context.Context, users.CreateParams) (users.Profile, error) {
	return users.Profile{}, nil
}

func (r *fakeUserRepository) FindByID(_ context.Context, id string) (users.Profile, error) {
	if r.err != nil {
		return users.Profile{}, r.err
	}
	if r.profile.ID != id {
		return users.Profile{}, pgx.ErrNoRows
	}
	return r.profile, nil
}

func (r *fakeUserRepository) FindByEmail(context.Context, string) (users.Profile, error) {
	return users.Profile{}, nil
}

func (r *fakeUserRepository) UpdateProfile(context.Context, string, users.ProfileUpdate) (users.Profile, error) {
	return users.Profile{}, nil
}

type fakeEventMailer struct {
	called    bool
	recipient string
	event     eventstore.Event
	err       error
}

func (m *fakeEventMailer) SendRSVPConfirmation(_ context.Context, recipient string, event eventstore.Event) error {
	m.called = true
	m.recipient = recipient
	m.event = event
	return m.err
}

type fakeSafetyRepository struct {
	supportCalled      bool
	supportInput       safety.SupportTicketInput
	supportTicket      safety.SupportTicket
	reportEventCalled  bool
	reportEventUserID  string
	reportEventSlug    string
	reportEventReason  string
	reportUserCalled   bool
	reportUserReporter string
	reportUserTarget   string
	reportUserReason   string
	report             safety.Report
	err                error
}

func (r *fakeSafetyRepository) CreateSupportTicket(_ context.Context, input safety.SupportTicketInput) (safety.SupportTicket, error) {
	r.supportCalled = true
	r.supportInput = input
	if r.err != nil {
		return safety.SupportTicket{}, r.err
	}
	if r.supportTicket.ID != "" {
		return r.supportTicket, nil
	}
	return safety.SupportTicket{
		ID:           "99999999-9999-9999-9999-999999999999",
		ContactEmail: input.ContactEmail,
		Status:       "open",
	}, nil
}

func (r *fakeSafetyRepository) ReportEvent(_ context.Context, reporterUserID string, eventSlug string, reason string) (safety.Report, error) {
	r.reportEventCalled = true
	r.reportEventUserID = reporterUserID
	r.reportEventSlug = eventSlug
	r.reportEventReason = reason
	if r.err != nil {
		return safety.Report{}, r.err
	}
	return r.reportOrDefault(safety.ReportTargetEvent)
}

func (r *fakeSafetyRepository) ReportUser(_ context.Context, reporterUserID string, targetUserID string, reason string) (safety.Report, error) {
	r.reportUserCalled = true
	r.reportUserReporter = reporterUserID
	r.reportUserTarget = targetUserID
	r.reportUserReason = reason
	if r.err != nil {
		return safety.Report{}, r.err
	}
	return r.reportOrDefault(safety.ReportTargetUser)
}

func (r *fakeSafetyRepository) reportOrDefault(targetType string) (safety.Report, error) {
	if r.report.ID != "" {
		return r.report, nil
	}
	return safety.Report{
		ID:         "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		TargetType: targetType,
		TargetID:   "22222222-2222-2222-2222-222222222222",
		Status:     "open",
	}, nil
}

type fakeTeamRepository struct {
	listPublicCalled   bool
	listParams         teamstore.ListParams
	listForUserCalled  bool
	listForUserID      string
	listForUserLimit   int
	listed             []teamstore.Team
	listedForUser      []teamstore.Team
	detail             teamstore.Team
	createCalled       bool
	createParams       teamstore.CreateParams
	created            teamstore.Team
	passwordHash       string
	joinCalled         bool
	joinSlug           string
	joinUserID         string
	joined             teamstore.Team
	viewerRole         string
	members            []teamstore.MemberSummary
	listMembersCalled  bool
	setCaptainCalled   bool
	setCaptainSlug     string
	setCaptainOwnerID  string
	setCaptainUserID   string
	setCaptainValue    bool
	transferCalled     bool
	transferSlug       string
	transferOwnerID    string
	transferNewOwnerID string
	err                error
}

func (r *fakeTeamRepository) Create(_ context.Context, params teamstore.CreateParams) (teamstore.Team, error) {
	r.createCalled = true
	r.createParams = params
	if r.err != nil {
		return teamstore.Team{}, r.err
	}
	if r.created.ID != "" {
		return r.created, nil
	}
	team := testTeam()
	team.Name = params.Name
	team.Description = params.Description
	return team, nil
}

func (r *fakeTeamRepository) ListPublic(_ context.Context, params teamstore.ListParams) ([]teamstore.Team, error) {
	r.listPublicCalled = true
	r.listParams = params
	return r.listed, r.err
}

func (r *fakeTeamRepository) ListForUser(_ context.Context, userID string, limit int) ([]teamstore.Team, error) {
	r.listForUserCalled = true
	r.listForUserID = userID
	r.listForUserLimit = limit
	return r.listedForUser, r.err
}

func (r *fakeTeamRepository) GetBySlug(_ context.Context, slug string) (teamstore.Team, error) {
	if r.err != nil {
		return teamstore.Team{}, r.err
	}
	if r.detail.Slug != slug {
		return teamstore.Team{}, pgx.ErrNoRows
	}
	return r.detail, nil
}

func (r *fakeTeamRepository) PasswordHash(_ context.Context, slug string) (string, error) {
	if r.err != nil {
		return "", r.err
	}
	if r.detail.Slug != slug {
		return "", teamstore.ErrTeamNotFound
	}
	return r.passwordHash, nil
}

func (r *fakeTeamRepository) Join(_ context.Context, slug string, userID string) (teamstore.Team, error) {
	r.joinCalled = true
	r.joinSlug = slug
	r.joinUserID = userID
	if r.err != nil {
		return teamstore.Team{}, r.err
	}
	if r.joined.ID != "" {
		return r.joined, nil
	}
	team := r.detail
	if team.ID == "" {
		team = testTeam()
	}
	role := teamstore.RoleMember
	team.ViewerRole = &role
	team.MemberCount += 1
	return team, nil
}

func (r *fakeTeamRepository) MembershipRole(_ context.Context, _ string, _ string) (string, error) {
	return r.viewerRole, r.err
}

func (r *fakeTeamRepository) ListMembers(_ context.Context, _ string) ([]teamstore.MemberSummary, error) {
	r.listMembersCalled = true
	if r.err != nil {
		return nil, r.err
	}
	if r.members != nil {
		return r.members, nil
	}
	return testTeamMembers(), nil
}

func (r *fakeTeamRepository) SetCaptain(_ context.Context, slug string, ownerUserID string, memberUserID string, captain bool) (teamstore.Team, error) {
	r.setCaptainCalled = true
	r.setCaptainSlug = slug
	r.setCaptainOwnerID = ownerUserID
	r.setCaptainUserID = memberUserID
	r.setCaptainValue = captain
	if r.err != nil {
		return teamstore.Team{}, r.err
	}
	team := r.detail
	if team.ID == "" {
		team = testTeam()
	}
	role := teamstore.RoleOwner
	team.ViewerRole = &role
	team.Members = testTeamMembers()
	return team, nil
}

func (r *fakeTeamRepository) TransferOwnership(_ context.Context, slug string, ownerUserID string, newOwnerUserID string) (teamstore.Team, error) {
	r.transferCalled = true
	r.transferSlug = slug
	r.transferOwnerID = ownerUserID
	r.transferNewOwnerID = newOwnerUserID
	if r.err != nil {
		return teamstore.Team{}, r.err
	}
	team := r.detail
	if team.ID == "" {
		team = testTeam()
	}
	team.OwnerUserID = newOwnerUserID
	role := teamstore.RoleMember
	team.ViewerRole = &role
	return team, nil
}

type fakeEventRepository struct {
	listPublicCalled               bool
	listParams                     eventstore.ListParams
	listed                         []eventstore.Event
	listUpcomingRSVPsCalled        bool
	listUpcomingRSVPsUserID        string
	listUpcomingRSVPsLimit         int
	upcomingRSVPs                  []eventstore.Event
	listFollowedSchoolEventsCalled bool
	listFollowedSchoolEventsUserID string
	listFollowedSchoolEventsLimit  int
	followedSchoolEvents           []eventstore.Event
	detail                         eventstore.Event
	createCalled                   bool
	createParams                   eventstore.CreateParams
	created                        eventstore.Event
	updateCalled                   bool
	updateParams                   eventstore.UpdateParams
	updated                        eventstore.Event
	deleteCalled                   bool
	deleteSlug                     string
	deleteUserID                   string
	isOrganizer                    bool
	privateHash                    string
	unlockValid                    bool
	unlockChecked                  bool
	unlockCreated                  bool
	unlockSlug                     string
	unlockTokenHash                []byte
	unlockExpiresAt                time.Time
	setRSVPCalled                  bool
	rsvpInput                      eventstore.RSVPInput
	rsvpEvent                      eventstore.Event
	rsvpErr                        error
	viewerRSVP                     string
	setInterestCalled              bool
	interestSlug                   string
	interestUserID                 string
	interestValue                  bool
	interestEvent                  eventstore.Event
	viewerInterested               bool
	err                            error
}

func (r *fakeEventRepository) Create(_ context.Context, params eventstore.CreateParams) (eventstore.Event, error) {
	r.createCalled = true
	r.createParams = params
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.created.ID != "" {
		return r.created, nil
	}
	event := testEvent(params.Visibility)
	event.Title = params.Title
	event.Description = params.Description
	return event, nil
}

func (r *fakeEventRepository) Update(_ context.Context, params eventstore.UpdateParams) (eventstore.Event, error) {
	r.updateCalled = true
	r.updateParams = params
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.updated.ID != "" {
		return r.updated, nil
	}
	event := testEvent(params.Visibility)
	event.Slug = params.Slug
	event.Title = params.Title
	event.Description = params.Description
	return event, nil
}

func (r *fakeEventRepository) Delete(_ context.Context, slug string, userID string) error {
	r.deleteCalled = true
	r.deleteSlug = slug
	r.deleteUserID = userID
	return r.err
}

func (r *fakeEventRepository) IsOrganizer(_ context.Context, _ string, _ string) (bool, error) {
	return r.isOrganizer, r.err
}

func (r *fakeEventRepository) PrivatePasswordHash(_ context.Context, slug string) (string, error) {
	if r.err != nil {
		return "", r.err
	}
	if r.detail.Slug != slug {
		return "", eventstore.ErrEventNotFound
	}
	return r.privateHash, nil
}

func (r *fakeEventRepository) CreatePrivateUnlock(_ context.Context, slug string, tokenHash []byte, expiresAt time.Time) error {
	r.unlockCreated = true
	r.unlockSlug = slug
	r.unlockTokenHash = tokenHash
	r.unlockExpiresAt = expiresAt
	return r.err
}

func (r *fakeEventRepository) IsPrivateUnlockValid(_ context.Context, slug string, tokenHash []byte) (bool, error) {
	r.unlockChecked = true
	r.unlockSlug = slug
	r.unlockTokenHash = tokenHash
	return r.unlockValid, r.err
}

func (r *fakeEventRepository) SetRSVP(_ context.Context, input eventstore.RSVPInput) (eventstore.Event, error) {
	r.setRSVPCalled = true
	r.rsvpInput = input
	if r.rsvpErr != nil {
		return eventstore.Event{}, r.rsvpErr
	}
	if r.rsvpEvent.ID != "" {
		return r.rsvpEvent, nil
	}
	event := r.detail
	if event.ID == "" {
		event = testEvent(eventstore.VisibilityPublic)
	}
	event.ViewerRSVP = &input.Response
	if input.Response == eventstore.RSVPYes && event.RSVPYesCount == 0 {
		event.RSVPYesCount = 1
	}
	return event, nil
}

func (r *fakeEventRepository) GetRSVP(_ context.Context, _ string, _ string) (string, error) {
	return r.viewerRSVP, r.err
}

func (r *fakeEventRepository) SetInterest(_ context.Context, slug string, userID string, interested bool) (eventstore.Event, error) {
	r.setInterestCalled = true
	r.interestSlug = slug
	r.interestUserID = userID
	r.interestValue = interested
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.interestEvent.ID != "" {
		return r.interestEvent, nil
	}
	event := r.detail
	if event.ID == "" {
		event = testEvent(eventstore.VisibilityPublic)
	}
	event.ViewerInterested = interested
	if interested && event.InterestCount == 0 {
		event.InterestCount = 1
	}
	return event, nil
}

func (r *fakeEventRepository) IsInterested(_ context.Context, _ string, _ string) (bool, error) {
	return r.viewerInterested, r.err
}

func (r *fakeEventRepository) ListPublic(_ context.Context, params eventstore.ListParams) ([]eventstore.Event, error) {
	r.listPublicCalled = true
	r.listParams = params
	return r.listed, r.err
}

func (r *fakeEventRepository) ListUpcomingRSVPs(_ context.Context, userID string, limit int) ([]eventstore.Event, error) {
	r.listUpcomingRSVPsCalled = true
	r.listUpcomingRSVPsUserID = userID
	r.listUpcomingRSVPsLimit = limit
	return r.upcomingRSVPs, r.err
}

func (r *fakeEventRepository) ListFollowedSchoolEvents(_ context.Context, userID string, limit int) ([]eventstore.Event, error) {
	r.listFollowedSchoolEventsCalled = true
	r.listFollowedSchoolEventsUserID = userID
	r.listFollowedSchoolEventsLimit = limit
	return r.followedSchoolEvents, r.err
}

func (r *fakeEventRepository) GetBySlug(_ context.Context, slug string) (eventstore.Event, error) {
	if r.err != nil {
		return eventstore.Event{}, r.err
	}
	if r.detail.Slug != slug {
		return eventstore.Event{}, pgx.ErrNoRows
	}
	return r.detail, nil
}

func (r *fakeFollowRepository) Follow(_ context.Context, _ string, _ string) error {
	return nil
}

func (r *fakeFollowRepository) Unfollow(_ context.Context, _ string, _ string) error {
	return nil
}

func (r *fakeFollowRepository) IsFollowing(_ context.Context, _ string, _ string) (bool, error) {
	return false, nil
}

func (r *fakeFollowRepository) ListFollowed(_ context.Context, userID string) ([]schools.School, error) {
	r.listFollowedCalled = true
	if userID != testUserID {
		return nil, schools.ErrSchoolNotFound
	}
	return r.followed, r.err
}

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

func TestHandleEventsReturnsPublicEventsWithFilters(t *testing.T) {
	repository := &fakeEventRepository{listed: []eventstore.Event{
		testEvent(eventstore.VisibilityPublic),
	}}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events?game=rocket-league&school=example-university&limit=5&offset=10", nil)
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listPublicCalled {
		t.Fatal("ListPublic was not called")
	}
	if repository.listParams.GameSlug != "rocket-league" || repository.listParams.SchoolSlug != "example-university" {
		t.Fatalf("list params = %#v, want game and school filters", repository.listParams)
	}
	if repository.listParams.Limit != 5 || repository.listParams.Offset != 10 {
		t.Fatalf("list params = %#v, want pagination filters", repository.listParams)
	}
	var payload struct {
		Events []eventstore.Event `json:"events"`
		Limit  int                `json:"limit"`
		Offset int                `json:"offset"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Events) != 1 || payload.Events[0].Slug != "campus-scrim-night" {
		t.Fatalf("events = %#v, want public event payload", payload.Events)
	}
}

func TestHandleEventsRejectsInvalidPagination(t *testing.T) {
	router := &Router{events: &fakeEventRepository{}}
	request := httptest.NewRequest(http.MethodGet, "/events?limit=not-a-number", nil)
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestHandleTeamsReturnsPublicTeamsWithFilters(t *testing.T) {
	repository := &fakeTeamRepository{listed: []teamstore.Team{testTeam()}}
	router := &Router{teams: repository}
	request := httptest.NewRequest(http.MethodGet, "/teams?game=rocket-league&school=example-university&limit=5&offset=10", nil)
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
	if repository.listParams.Limit != 5 || repository.listParams.Offset != 10 {
		t.Fatalf("list params = %#v, want pagination filters", repository.listParams)
	}
	var payload struct {
		Teams  []teamstore.Team `json:"teams"`
		Limit  int              `json:"limit"`
		Offset int              `json:"offset"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Teams) != 1 || payload.Teams[0].Slug != "varsity-rocket-league" {
		t.Fatalf("teams = %#v, want public team payload", payload.Teams)
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

func TestHandleMyEventsRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/me/events", nil)
	response := httptest.NewRecorder()

	router.handleMyEvents(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.listUpcomingRSVPsCalled || repository.listFollowedSchoolEventsCalled {
		t.Fatal("dashboard event queries were called for unauthenticated request")
	}
}

func TestHandleMyEventsReturnsDashboardEvents(t *testing.T) {
	upcoming := testEvent(eventstore.VisibilityPublic)
	yes := eventstore.RSVPYes
	upcoming.ViewerRSVP = &yes
	followed := testEvent(eventstore.VisibilityPublic)
	followed.ID = "88888888-8888-8888-8888-888888888888"
	followed.Slug = "followed-campus-final"
	followed.Title = "Followed Campus Final"
	repository := &fakeEventRepository{
		upcomingRSVPs:        []eventstore.Event{upcoming},
		followedSchoolEvents: []eventstore.Event{followed},
	}
	handler := authenticatedMyEventsHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/me/events?limit=4", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.listUpcomingRSVPsCalled || !repository.listFollowedSchoolEventsCalled {
		t.Fatal("dashboard event queries were not called")
	}
	if repository.listUpcomingRSVPsUserID != testUserID ||
		repository.listFollowedSchoolEventsUserID != testUserID ||
		repository.listUpcomingRSVPsLimit != 4 ||
		repository.listFollowedSchoolEventsLimit != 4 {
		t.Fatalf("queries = upcoming user %q limit %d followed user %q limit %d",
			repository.listUpcomingRSVPsUserID,
			repository.listUpcomingRSVPsLimit,
			repository.listFollowedSchoolEventsUserID,
			repository.listFollowedSchoolEventsLimit)
	}
	var payload struct {
		UpcomingRSVPs        []eventstore.Event `json:"upcoming_rsvps"`
		FollowedSchoolEvents []eventstore.Event `json:"followed_school_events"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.UpcomingRSVPs) != 1 || payload.UpcomingRSVPs[0].ViewerRSVP == nil || *payload.UpcomingRSVPs[0].ViewerRSVP != eventstore.RSVPYes {
		t.Fatalf("upcoming_rsvps = %#v, want RSVP event", payload.UpcomingRSVPs)
	}
	if len(payload.FollowedSchoolEvents) != 1 || payload.FollowedSchoolEvents[0].Slug != "followed-campus-final" {
		t.Fatalf("followed_school_events = %#v, want followed school event", payload.FollowedSchoolEvents)
	}
}

func TestHandleSupportTicketsAllowsAnonymousSubmission(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{safety: repository}
	request := httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(`{
		"contact_email":"player@example.com",
		"name":"Player One",
		"subject":"Need help",
		"message":"I need help with my account."
	}`))
	response := httptest.NewRecorder()

	router.handleSupportTickets(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.supportCalled {
		t.Fatal("CreateSupportTicket was not called")
	}
	if repository.supportInput.SubmitterUserID != "" {
		t.Fatalf("SubmitterUserID = %q, want empty for anonymous support", repository.supportInput.SubmitterUserID)
	}
	if repository.supportInput.ContactEmail != "player@example.com" ||
		repository.supportInput.Subject != "Need help" {
		t.Fatalf("support input = %#v, want request fields", repository.supportInput)
	}
}

func TestHandleSupportTicketsMapsValidationError(t *testing.T) {
	repository := &fakeSafetyRepository{err: errors.New("subject is required")}
	router := &Router{safety: repository}
	request := httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(`{
		"contact_email":"player@example.com",
		"message":"I need help."
	}`))
	response := httptest.NewRecorder()

	router.handleSupportTickets(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "invalid_request") {
		t.Fatalf("body = %s, want invalid_request", response.Body.String())
	}
}

func TestHandleSupportTicketsRateLimitsSubmissions(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{
		cfg: config.Config{
			AuthRateLimit:  1,
			AuthRateWindow: time.Minute,
		},
		limiter: ratelimit.New(1, time.Minute),
		safety:  repository,
	}
	body := `{"contact_email":"player@example.com","subject":"Need help","message":"Please help."}`
	first := httptest.NewRecorder()
	router.handleSupportTickets(first, httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(body)))
	second := httptest.NewRecorder()
	router.handleSupportTickets(second, httptest.NewRequest(http.MethodPost, "/support-tickets", strings.NewReader(body)))

	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d", first.Code, http.StatusCreated)
	}
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d; body = %s", second.Code, http.StatusTooManyRequests, second.Body.String())
	}
}

func TestHandleReportEventRequiresAuthentication(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{
		events: &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)},
		safety: repository,
	}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/report", strings.NewReader(`{"reason":"Spam listing"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.reportEventCalled {
		t.Fatal("ReportEvent was called for unauthenticated request")
	}
}

func TestHandleReportEventCreatesReport(t *testing.T) {
	repository := &fakeSafetyRepository{}
	handler := authenticatedEventReportHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/report", `{"reason":"Spam listing"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.reportEventCalled {
		t.Fatal("ReportEvent was not called")
	}
	if repository.reportEventUserID != testUserID ||
		repository.reportEventSlug != "campus-scrim-night" ||
		repository.reportEventReason != "Spam listing" {
		t.Fatalf("ReportEvent call = user %q slug %q reason %q",
			repository.reportEventUserID,
			repository.reportEventSlug,
			repository.reportEventReason)
	}
}

func TestHandleReportEventRateLimitsSubmissions(t *testing.T) {
	repository := &fakeSafetyRepository{}
	router := &Router{
		cfg: config.Config{
			SessionCookie:  "session",
			SessionTTL:     time.Hour,
			AuthRateLimit:  1,
			AuthRateWindow: time.Minute,
		},
		events:  &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)},
		limiter: ratelimit.New(1, time.Minute),
		safety:  repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}
	handler := auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEventPath))
	body := `{"reason":"Spam listing"}`
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/report", body))
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/report", body))

	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d; body = %s", first.Code, http.StatusCreated, first.Body.String())
	}
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want %d; body = %s", second.Code, http.StatusTooManyRequests, second.Body.String())
	}
}

func TestHandleReportUserCreatesReport(t *testing.T) {
	repository := &fakeSafetyRepository{}
	handler := authenticatedUserReportHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/users/22222222-2222-2222-2222-222222222222/report", `{"reason":"Harassment"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.reportUserCalled {
		t.Fatal("ReportUser was not called")
	}
	if repository.reportUserReporter != testUserID ||
		repository.reportUserTarget != "22222222-2222-2222-2222-222222222222" ||
		repository.reportUserReason != "Harassment" {
		t.Fatalf("ReportUser call = reporter %q target %q reason %q",
			repository.reportUserReporter,
			repository.reportUserTarget,
			repository.reportUserReason)
	}
}

func TestHandleReportUserMapsSelfReport(t *testing.T) {
	repository := &fakeSafetyRepository{err: safety.ErrCannotReportSelf}
	handler := authenticatedUserReportHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/users/22222222-2222-2222-2222-222222222222/report", `{"reason":"Oops"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "cannot_report_self") {
		t.Fatalf("body = %s, want cannot_report_self", response.Body.String())
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

func TestHandleCreateEventRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(validCreateEventJSON(eventstore.VisibilityPublic, "")))
	response := httptest.NewRecorder()

	router.handleEvents(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.createCalled {
		t.Fatal("Create was called for unauthenticated request")
	}
}

func TestHandleCreateEventCreatesPublicEvent(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, ""))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !repository.createCalled {
		t.Fatal("Create was not called")
	}
	if repository.createParams.CreatorUserID != testUserID {
		t.Fatalf("CreatorUserID = %q, want session user", repository.createParams.CreatorUserID)
	}
	if repository.createParams.PrivatePasswordHash != "" {
		t.Fatalf("PrivatePasswordHash = %q, want empty for public event", repository.createParams.PrivatePasswordHash)
	}
	if len(repository.createParams.GameIDs) != 1 || repository.createParams.GameIDs[0] != "44444444-4444-4444-4444-444444444444" {
		t.Fatalf("GameIDs = %#v, want request game IDs", repository.createParams.GameIDs)
	}
}

func TestHandleCreateEventHashesPrivatePassword(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPrivate, "PrivatePass8"))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if repository.createParams.PrivatePasswordHash == "" || repository.createParams.PrivatePasswordHash == "PrivatePass8" {
		t.Fatalf("PrivatePasswordHash = %q, want non-plaintext hash", repository.createParams.PrivatePasswordHash)
	}
	if !auth.ComparePassword(repository.createParams.PrivatePasswordHash, "PrivatePass8") {
		t.Fatal("PrivatePasswordHash does not verify against original password")
	}
}

func TestHandleCreateEventRejectsInvalidInput(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventsHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPrivate, "short"))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if repository.createCalled {
		t.Fatal("Create was called for invalid input")
	}
}

func TestHandleCreateEventMapsMissingSchoolAndGame(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{name: "missing school", err: eventstore.ErrHostSchoolNotFound, code: "host_school_not_found"},
		{name: "missing game", err: eventstore.ErrGameNotFound, code: "game_not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeEventRepository{err: tc.err}
			handler := authenticatedEventsHandler(repository)
			request := authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, ""))
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

func TestHandleEventPathReturnsPublicDetail(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Title != "Campus Scrim Night" {
		t.Fatalf("title = %q, want public detail", payload.Title)
	}
}

func TestHandleEventPathReturnsViewerRSVPForAuthenticatedDetail(t *testing.T) {
	repository := &fakeEventRepository{
		detail:     testEvent(eventstore.VisibilityPublic),
		viewerRSVP: eventstore.RSVPMaybe,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerRSVP == nil || *payload.ViewerRSVP != eventstore.RSVPMaybe {
		t.Fatalf("ViewerRSVP = %#v, want maybe", payload.ViewerRSVP)
	}
}

func TestHandleEventPathReturnsViewerInterestForAuthenticatedDetail(t *testing.T) {
	repository := &fakeEventRepository{
		detail:           testEvent(eventstore.VisibilityPublic),
		viewerInterested: true,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.ViewerInterested {
		t.Fatalf("ViewerInterested = false, want true")
	}
}

func TestHandleEventPathReturnsEditPermissionForOrganizer(t *testing.T) {
	repository := &fakeEventRepository{
		detail:      testEvent(eventstore.VisibilityPublic),
		isOrganizer: true,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.ViewerCanEdit {
		t.Fatal("ViewerCanEdit = false, want true for organizer")
	}
}

func TestHandleUpdateEventRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPatch, "/events/campus-scrim-night", strings.NewReader(validCreateEventJSON(eventstore.VisibilityPublic, "")))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.updateCalled {
		t.Fatal("Update was called for unauthenticated request")
	}
}

func TestHandleUpdateEventUpdatesOrganizerEvent(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", validCreateEventJSON(eventstore.VisibilityPublic, ""))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.updateCalled {
		t.Fatal("Update was not called")
	}
	if repository.updateParams.Slug != "campus-scrim-night" || repository.updateParams.EditorUserID != testUserID {
		t.Fatalf("update params = %#v, want slug and session user", repository.updateParams)
	}
	if repository.updateParams.PrivatePasswordHash != "" {
		t.Fatalf("PrivatePasswordHash = %q, want empty for public update", repository.updateParams.PrivatePasswordHash)
	}
}

func TestHandleUpdateEventHashesNewPrivatePassword(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", validCreateEventJSON(eventstore.VisibilityPrivate, "PrivatePass8"))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if repository.updateParams.PrivatePasswordHash == "" || repository.updateParams.PrivatePasswordHash == "PrivatePass8" {
		t.Fatalf("PrivatePasswordHash = %q, want non-plaintext hash", repository.updateParams.PrivatePasswordHash)
	}
	if !auth.ComparePassword(repository.updateParams.PrivatePasswordHash, "PrivatePass8") {
		t.Fatal("PrivatePasswordHash does not verify against original password")
	}
}

func TestHandleUpdateEventMapsOrganizerError(t *testing.T) {
	repository := &fakeEventRepository{err: eventstore.ErrOrganizerRequired}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPatch, "/events/campus-scrim-night", validCreateEventJSON(eventstore.VisibilityPublic, ""))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "not_event_organizer") {
		t.Fatalf("body = %s, want not_event_organizer", response.Body.String())
	}
}

func TestHandleDeleteEventSoftDeletesOrganizerEvent(t *testing.T) {
	repository := &fakeEventRepository{}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodDelete, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusNoContent, response.Body.String())
	}
	if !repository.deleteCalled {
		t.Fatal("Delete was not called")
	}
	if repository.deleteSlug != "campus-scrim-night" || repository.deleteUserID != testUserID {
		t.Fatalf("delete = slug %q user %q, want slug and session user", repository.deleteSlug, repository.deleteUserID)
	}
}

func TestHandleDeleteEventMapsMissingEvent(t *testing.T) {
	repository := &fakeEventRepository{err: eventstore.ErrEventNotFound}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodDelete, "/events/missing-event", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusNotFound, response.Body.String())
	}
}

func TestHandleEventPathReturnsLockedShellForPrivateDetail(t *testing.T) {
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "Secret Scrim Night") {
		t.Fatalf("private response leaked title: %s", body)
	}
	var payload eventstore.LockedEvent
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Locked || payload.Visibility != eventstore.VisibilityPrivate {
		t.Fatalf("locked payload = %#v, want private locked shell", payload)
	}
}

func TestHandleEventPathReturnsPrivateDetailToOrganizer(t *testing.T) {
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event, isOrganizer: true}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodGet, "/events/campus-scrim-night", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Title != "Secret Scrim Night" {
		t.Fatalf("title = %q, want private organizer detail", payload.Title)
	}
}

func TestHandleEventPathReturnsPrivateDetailWithUnlockToken(t *testing.T) {
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event, unlockValid: true}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/campus-scrim-night", nil)
	request.Header.Set("X-CGN-Event-Unlock", "raw-unlock-token")
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.unlockChecked {
		t.Fatal("IsPrivateUnlockValid was not called")
	}
	if repository.unlockSlug != "campus-scrim-night" || len(repository.unlockTokenHash) == 0 {
		t.Fatalf("unlock check = slug %q hash %x, want slug and token hash", repository.unlockSlug, repository.unlockTokenHash)
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Title != "Secret Scrim Night" {
		t.Fatalf("title = %q, want unlocked private detail", payload.Title)
	}
}

func TestHandleUnlockEventCreatesTokenForCorrectPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("PrivatePass8")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	event := testEvent(eventstore.VisibilityPrivate)
	event.Title = "Secret Scrim Night"
	repository := &fakeEventRepository{detail: event, privateHash: passwordHash}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/unlock", strings.NewReader(`{"password":"PrivatePass8"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.unlockCreated {
		t.Fatal("CreatePrivateUnlock was not called")
	}
	if repository.unlockSlug != "campus-scrim-night" || len(repository.unlockTokenHash) == 0 {
		t.Fatalf("unlock = slug %q hash %x, want slug and token hash", repository.unlockSlug, repository.unlockTokenHash)
	}
	if !repository.unlockExpiresAt.After(time.Now()) {
		t.Fatalf("unlockExpiresAt = %s, want future expiration", repository.unlockExpiresAt)
	}
	var payload struct {
		Event       eventstore.Event `json:"event"`
		UnlockToken string           `json:"unlock_token"`
		ExpiresAt   time.Time        `json:"expires_at"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Event.Title != "Secret Scrim Night" || payload.UnlockToken == "" || payload.ExpiresAt.IsZero() {
		t.Fatalf("payload = %#v, want event, token, and expiration", payload)
	}
}

func TestHandleUnlockEventRejectsWrongPassword(t *testing.T) {
	passwordHash, err := auth.HashPassword("PrivatePass8")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	repository := &fakeEventRepository{
		detail:      testEvent(eventstore.VisibilityPrivate),
		privateHash: passwordHash,
	}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/unlock", strings.NewReader(`{"password":"WrongPass8"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if repository.unlockCreated {
		t.Fatal("CreatePrivateUnlock was called for a wrong password")
	}
	if !strings.Contains(response.Body.String(), "invalid_private_password") {
		t.Fatalf("body = %s, want invalid_private_password", response.Body.String())
	}
}

func TestHandleRSVPEventRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", strings.NewReader(`{"response":"yes"}`))
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.setRSVPCalled {
		t.Fatal("SetRSVP was called for unauthenticated request")
	}
}

func TestHandleRSVPEventSetsViewerResponse(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !repository.setRSVPCalled {
		t.Fatal("SetRSVP was not called")
	}
	if repository.rsvpInput.Slug != "campus-scrim-night" ||
		repository.rsvpInput.UserID != testUserID ||
		repository.rsvpInput.Response != eventstore.RSVPYes {
		t.Fatalf("RSVP input = %#v, want slug, session user, yes", repository.rsvpInput)
	}
	var payload eventstore.Event
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerRSVP == nil || *payload.ViewerRSVP != eventstore.RSVPYes {
		t.Fatalf("ViewerRSVP = %#v, want yes", payload.ViewerRSVP)
	}
}

func TestHandleRSVPEventSendsConfirmationEmailOnYes(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	mailer := &fakeEventMailer{}
	handler := authenticatedEventPathHandlerWithMailer(repository, mailer)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !mailer.called {
		t.Fatal("SendRSVPConfirmation was not called")
	}
	if mailer.recipient != "player@example.com" || mailer.event.Slug != "campus-scrim-night" {
		t.Fatalf("mailer recipient = %q event = %#v, want player email and event", mailer.recipient, mailer.event)
	}
}

func TestHandleRSVPEventSkipsConfirmationEmailForMaybe(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	mailer := &fakeEventMailer{}
	handler := authenticatedEventPathHandlerWithMailer(repository, mailer)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"maybe"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if mailer.called {
		t.Fatal("SendRSVPConfirmation was called for maybe RSVP")
	}
}

// The RSVP transaction commits before the confirmation email is attempted, so a
// delivery failure must still report success. Returning 500 here told the user
// their RSVP had failed while the row was already saved, and sent them into a
// retry loop against a committed write.
func TestHandleRSVPEventSucceedsWhenConfirmationEmailFails(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	mailer := &fakeEventMailer{err: errors.New("send failed")}
	handler := authenticatedEventPathHandlerWithMailer(repository, mailer)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "event_rsvp_email_failed") {
		t.Fatalf("body = %s, want the saved event rather than a mail error", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"viewer_rsvp":"yes"`) {
		t.Fatalf("body = %s, want the persisted RSVP reflected back", response.Body.String())
	}
}

func TestHandleRSVPEventRejectsLockedPrivateEvent(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPrivate)}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if repository.setRSVPCalled {
		t.Fatal("SetRSVP was called for locked private event")
	}
	if !strings.Contains(response.Body.String(), "private_event_locked") {
		t.Fatalf("body = %s, want private_event_locked", response.Body.String())
	}
}

func TestHandleRSVPEventMapsFullEvent(t *testing.T) {
	repository := &fakeEventRepository{
		detail:  testEvent(eventstore.VisibilityPublic),
		rsvpErr: eventstore.ErrEventFull,
	}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusConflict, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "event_full") {
		t.Fatalf("body = %s, want event_full", response.Body.String())
	}
}

func TestHandleEventInterestRequiresAuthentication(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/interest", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.setInterestCalled {
		t.Fatal("SetInterest was called for unauthenticated request")
	}
}

func TestHandleEventInterestSetsAndUnsetsViewerInterest(t *testing.T) {
	for _, tc := range []struct {
		name   string
		method string
		want   bool
	}{
		{name: "set", method: http.MethodPost, want: true},
		{name: "unset", method: http.MethodDelete, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
			handler := authenticatedEventPathHandler(repository)
			request := authenticatedEventRequest(tc.method, "/events/campus-scrim-night/interest", "")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
			}
			if !repository.setInterestCalled {
				t.Fatal("SetInterest was not called")
			}
			if repository.interestSlug != "campus-scrim-night" ||
				repository.interestUserID != testUserID ||
				repository.interestValue != tc.want {
				t.Fatalf("interest = slug %q user %q value %t, want slug, session user, %t",
					repository.interestSlug, repository.interestUserID, repository.interestValue, tc.want)
			}
			var payload eventstore.Event
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.ViewerInterested != tc.want {
				t.Fatalf("ViewerInterested = %t, want %t", payload.ViewerInterested, tc.want)
			}
		})
	}
}

func TestHandleEventInterestRejectsLockedPrivateEvent(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPrivate)}
	handler := authenticatedEventPathHandler(repository)
	request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/interest", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if repository.setInterestCalled {
		t.Fatal("SetInterest was called for locked private event")
	}
	if !strings.Contains(response.Body.String(), "private_event_locked") {
		t.Fatalf("body = %s, want private_event_locked", response.Body.String())
	}
}

func TestHandleEventPathReturnsNotFoundForMissingEvent(t *testing.T) {
	repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
	router := &Router{events: repository}
	request := httptest.NewRequest(http.MethodGet, "/events/missing-event", nil)
	response := httptest.NewRecorder()

	router.handleEventPath(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func authenticatedMySchoolsHandler(repository *fakeFollowRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		follows: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleMySchools))
}

func authenticatedEventsHandler(repository *fakeEventRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie:  "session",
			SessionTTL:     time.Hour,
			AuthRateLimit:  5,
			AuthRateWindow: time.Minute,
		},
		events: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEvents))
}

func authenticatedMyEventsHandler(repository *fakeEventRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		events: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleMyEvents))
}

func authenticatedEventReportHandler(repository *fakeSafetyRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		events: &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)},
		safety: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEventPath))
}

func authenticatedUserReportHandler(repository *fakeSafetyRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		safety: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleUserPath))
}

func authenticatedTeamsHandler(repository *fakeTeamRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie:  "session",
			SessionTTL:     time.Hour,
			AuthRateLimit:  5,
			AuthRateWindow: time.Minute,
		},
		teams: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleTeams))
}

func authenticatedMyTeamsHandler(repository *fakeTeamRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		teams: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleMyTeams))
}

func authenticatedTeamPathHandler(repository *fakeTeamRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie:  "session",
			SessionTTL:     time.Hour,
			AuthRateLimit:  5,
			AuthRateWindow: time.Minute,
		},
		teams: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleTeamPath))
}

func authenticatedEventPathHandler(repository *fakeEventRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		events: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEventPath))
}

func authenticatedEventPathHandlerWithMailer(repository *fakeEventRepository, mailer *fakeEventMailer) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		events: repository,
		users: &fakeUserRepository{profile: users.Profile{
			ID:    testUserID,
			Email: "player@example.com",
		}},
		eventMailer: mailer,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleEventPath))
}

func authenticatedEventRequest(method string, target string, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: "session", Value: "raw-token"})
	return request
}

func validCreateEventJSON(visibility string, privatePassword string) string {
	passwordField := ""
	if privatePassword != "" {
		passwordField = `,"private_password":"` + privatePassword + `"`
	}
	return `{
		"title":"Campus Scrim Night",
		"description":"Weekly games on campus.",
		"host_school_id":"33333333-3333-3333-3333-333333333333",
		"game_ids":["44444444-4444-4444-4444-444444444444"],
		"visibility":"` + visibility + `",
		"format":"in_person",
		"starts_at":"2026-08-15T20:00:00Z",
		"ends_at":"2026-08-15T22:00:00Z",
		"timezone":"America/Los_Angeles",
		"location_name":"Student Union",
		"address":"1 Campus Way",
		"capacity":24,
		"is_paid":true,
		"payment_note":"Pay at the venue.",
		"payment_url":"https://payments.example.test/scrim-night"` + passwordField + `
	}`
}

func validCreateTeamJSON() string {
	return `{
		"name":"Varsity Rocket League",
		"description":"Competitive team for campus players.",
		"school_id":"33333333-3333-3333-3333-333333333333",
		"game_ids":["44444444-4444-4444-4444-444444444444"],
		"password":"TeamPass8"
	}`
}

func testEvent(visibility string) eventstore.Event {
	return eventstore.Event{
		ID:          "22222222-2222-2222-2222-222222222222",
		Title:       "Campus Scrim Night",
		Slug:        "campus-scrim-night",
		Description: "Weekly games on campus.",
		Visibility:  visibility,
		Format:      eventstore.FormatInPerson,
		StartsAt:    time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:      time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		Timezone:    "America/Los_Angeles",
		Lifecycle:   eventstore.LifecycleUpcoming,
		HostSchool: eventstore.SchoolSummary{
			ID:    "33333333-3333-3333-3333-333333333333",
			Name:  "Example University",
			Slug:  "example-university",
			City:  "Irvine",
			State: "CA",
		},
		Games: []eventstore.GameSummary{
			{
				ID:   "44444444-4444-4444-4444-444444444444",
				Name: "Rocket League",
				Slug: "rocket-league",
			},
		},
	}
}

func testTeam() teamstore.Team {
	return teamstore.Team{
		ID:          "55555555-5555-5555-5555-555555555555",
		Name:        "Varsity Rocket League",
		Slug:        "varsity-rocket-league",
		Description: "Competitive team for campus players.",
		OwnerUserID: testUserID,
		MemberCount: 1,
		School: &teamstore.SchoolSummary{
			ID:    "33333333-3333-3333-3333-333333333333",
			Name:  "Example University",
			Slug:  "example-university",
			City:  "Irvine",
			State: "CA",
		},
		Games: []teamstore.GameSummary{
			{
				ID:   "44444444-4444-4444-4444-444444444444",
				Name: "Rocket League",
				Slug: "rocket-league",
			},
		},
	}
}

func testTeamMembers() []teamstore.MemberSummary {
	return []teamstore.MemberSummary{
		{
			UserID: testUserID,
			Name:   "Team Owner",
			Role:   teamstore.RoleOwner,
		},
		{
			UserID: testTeamCaptainID,
			Name:   "Team Captain",
			Role:   teamstore.RoleCaptain,
		},
		{
			UserID: testTeamMemberID,
			Name:   "Team Member",
			Role:   teamstore.RoleMember,
		},
	}
}

// net/http recovers handler panics on its own, but it closes the connection
// without a response and logs outside slog. The BFF then sees a transport
// failure rather than an API error.
func TestRouterRecoversPanicAsJSONError(t *testing.T) {
	panicking := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	handler := withPanicRecovery(panicking)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/events", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(response.Body.String(), "internal_error") {
		t.Fatalf("body = %s, want internal_error", response.Body.String())
	}
}

func TestRouterPassesThroughSuccessfulHandlers(t *testing.T) {
	handler := withPanicRecovery(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusTeapot, map[string]string{"status": "fine"})
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/events", nil))

	if response.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusTeapot)
	}
}
