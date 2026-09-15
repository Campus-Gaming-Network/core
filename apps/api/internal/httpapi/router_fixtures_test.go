package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
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

type fakeSchoolRepository struct {
	listCalled bool
	listParams schools.ListParams
	listed     []schools.School
	err        error
}

func (r *fakeSchoolRepository) List(_ context.Context, params schools.ListParams) ([]schools.School, error) {
	r.listCalled = true
	r.listParams = params
	return r.listed, r.err
}

func (r *fakeSchoolRepository) GetByID(context.Context, string) (schools.School, error) {
	return schools.School{}, schools.ErrSchoolNotFound
}

func (r *fakeSchoolRepository) GetBySlug(context.Context, string) (schools.School, error) {
	return schools.School{}, schools.ErrSchoolNotFound
}

func (r *fakeSchoolRepository) ExistsActive(context.Context, string) (bool, error) {
	return false, nil
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

func recurringCreateEventJSON(rule string, until string) string {
	body := strings.TrimSuffix(strings.TrimSpace(validCreateEventJSON(eventstore.VisibilityPublic, "")), "}")
	return body + `,"recurrence_rule":"` + rule + `","recurrence_until":"` + until + `"}`
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
