package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestPassV0SuccessResponseContracts(t *testing.T) {
	t.Run("signup", func(t *testing.T) {
		router := &Router{account: newPassV0ContractAccountService(&passV0ContractUsers{})}
		response := serveContractRequest(
			http.HandlerFunc(router.handleSignup),
			httptest.NewRequest(http.MethodPost, "/auth/signup", strings.NewReader(validPassV0SignupJSON())),
		)

		payload := requireJSONContract(t, response, http.StatusCreated, profileContractKeys)
		requireStringContract(t, payload, "email", "player@example.com")
		requireStringContract(t, payload, "home_school_id", "33333333-3333-3333-3333-333333333333")
	})

	t.Run("resend verification", func(t *testing.T) {
		router := &Router{account: newPassV0ContractAccountService(&passV0ContractUsers{})}
		response := serveContractRequest(
			http.HandlerFunc(router.handleResendVerification),
			httptest.NewRequest(http.MethodPost, "/auth/resend-verification", strings.NewReader(`{"email":"player@example.com"}`)),
		)

		payload := requireJSONContract(t, response, http.StatusAccepted, []string{"status"})
		requireStringContract(t, payload, "status", "if_account_exists_email_sent")
	})

	t.Run("create event", func(t *testing.T) {
		repository := &fakeEventRepository{}
		response := serveContractRequest(
			authenticatedEventsHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/events", validCreateEventJSON(eventstore.VisibilityPublic, "")),
		)

		payload := requireJSONContract(t, response, http.StatusCreated, eventContractKeys)
		requireStringContract(t, payload, "slug", "campus-scrim-night")
		requireEventAssociationsContract(t, payload)
	})

	t.Run("unlock private event", func(t *testing.T) {
		passwordHash, err := auth.HashPassword("PrivatePass8")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		event := testEvent(eventstore.VisibilityPrivate)
		repository := &fakeEventRepository{detail: event, privateHash: passwordHash}
		router := &Router{events: repository}
		response := serveContractRequest(
			http.HandlerFunc(router.handleEventPath),
			httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/unlock", strings.NewReader(`{"password":"PrivatePass8"}`)),
		)

		payload := requireJSONContract(t, response, http.StatusOK, []string{"event", "expires_at", "unlock_token"})
		requireNonEmptyStringContract(t, payload, "unlock_token")
		requireNonEmptyStringContract(t, payload, "expires_at")
		requireEventContract(t, payload["event"], eventContractKeys)
	})

	t.Run("cancel event", func(t *testing.T) {
		repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
		response := serveContractRequest(
			authenticatedEventPathHandler(repository),
			authenticatedEventRequest(http.MethodDelete, "/events/campus-scrim-night", ""),
		)

		requireNoContentContract(t, response)
	})

	t.Run("rsvp", func(t *testing.T) {
		repository := &fakeEventRepository{
			detail:      testEvent(eventstore.VisibilityPrivate),
			unlockValid: true,
		}
		request := authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`)
		request.Header.Set("X-CGN-Event-Unlock", "unlock-token")
		response := serveContractRequest(
			authenticatedEventPathHandler(repository),
			request,
		)

		payload := requireJSONContract(t, response, http.StatusOK, appendContractKeys(eventContractKeys, "viewer_rsvp"))
		requireStringContract(t, payload, "viewer_rsvp", eventstore.RSVPYes)
		requireEventAssociationsContract(t, payload)
		if !repository.unlockChecked {
			t.Fatal("private RSVP did not validate X-CGN-Event-Unlock")
		}
	})

	for _, contract := range []struct {
		name       string
		method     string
		interested bool
	}{
		{name: "mark interested", method: http.MethodPost, interested: true},
		{name: "remove interest", method: http.MethodDelete, interested: false},
	} {
		t.Run(contract.name, func(t *testing.T) {
			repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPublic)}
			response := serveContractRequest(
				authenticatedEventPathHandler(repository),
				authenticatedEventRequest(contract.method, "/events/campus-scrim-night/interest", ""),
			)

			expectedKeys := eventContractKeys
			if contract.interested {
				expectedKeys = appendContractKeys(expectedKeys, "viewer_interested")
			}
			payload := requireJSONContract(t, response, http.StatusOK, expectedKeys)
			if contract.interested && payload["viewer_interested"] != true {
				t.Fatalf("viewer_interested = %#v, want true", payload["viewer_interested"])
			}
			requireEventAssociationsContract(t, payload)
		})
	}

	t.Run("join team", func(t *testing.T) {
		passwordHash, err := auth.HashPassword("TeamPass8")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		repository := &fakeTeamRepository{detail: testTeam(), passwordHash: passwordHash}
		response := serveContractRequest(
			authenticatedTeamPathHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/join", `{"password":"TeamPass8"}`),
		)

		payload := requireJSONContract(t, response, http.StatusOK, appendContractKeys(teamContractKeys, "viewer_role"))
		requireStringContract(t, payload, "viewer_role", teamstore.RoleMember)
		requireTeamAssociationsContract(t, payload)
	})

	t.Run("transfer team ownership", func(t *testing.T) {
		repository := &fakeTeamRepository{detail: testTeam()}
		response := serveContractRequest(
			authenticatedTeamPathHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/transfer-ownership", `{"new_owner_user_id":"`+testTeamCaptainID+`"}`),
		)

		payload := requireJSONContract(t, response, http.StatusOK, appendContractKeys(teamContractKeys, "viewer_role"))
		requireStringContract(t, payload, "owner_user_id", testTeamCaptainID)
		requireStringContract(t, payload, "viewer_role", teamstore.RoleMember)
		requireTeamAssociationsContract(t, payload)
	})

	t.Run("dashboard events", func(t *testing.T) {
		upcoming := testEvent(eventstore.VisibilityPublic)
		yes := eventstore.RSVPYes
		upcoming.ViewerRSVP = &yes
		repository := &fakeEventRepository{
			upcomingRSVPs:        []eventstore.Event{upcoming},
			followedSchoolEvents: []eventstore.Event{testEvent(eventstore.VisibilityPublic)},
		}
		response := serveContractRequest(
			authenticatedMyEventsHandler(repository),
			authenticatedEventRequest(http.MethodGet, "/me/events?limit=5", ""),
		)

		payload := requireJSONContract(t, response, http.StatusOK, []string{"followed_school_events", "upcoming_rsvps"})
		upcomingEvents := requireJSONArrayContract(t, payload, "upcoming_rsvps", 1)
		followedEvents := requireJSONArrayContract(t, payload, "followed_school_events", 1)
		requireEventContract(t, upcomingEvents[0], appendContractKeys(eventContractKeys, "viewer_rsvp"))
		requireEventContract(t, followedEvents[0], eventContractKeys)
	})

	t.Run("dashboard teams", func(t *testing.T) {
		team := testTeam()
		role := teamstore.RoleCaptain
		team.ViewerRole = &role
		repository := &fakeTeamRepository{listedForUser: []teamstore.Team{team}}
		response := serveContractRequest(
			authenticatedMyTeamsHandler(repository),
			authenticatedEventRequest(http.MethodGet, "/me/teams?limit=10", ""),
		)

		payload := requireJSONContract(t, response, http.StatusOK, []string{"limit", "teams"})
		if payload["limit"] != float64(10) {
			t.Fatalf("limit = %#v, want 10", payload["limit"])
		}
		teams := requireJSONArrayContract(t, payload, "teams", 1)
		requireTeamContract(t, teams[0], appendContractKeys(teamContractKeys, "viewer_role"))
	})
}

func TestPassV0ErrorResponseContracts(t *testing.T) {
	t.Run("rate limited", func(t *testing.T) {
		router := &Router{
			cfg:     config.Config{AuthRateWindow: time.Minute},
			account: newPassV0ContractAccountService(&passV0ContractUsers{}),
			limiter: ratelimit.New(1, time.Minute),
		}
		handler := http.HandlerFunc(router.handleSignup)
		first := serveContractRequest(handler, httptest.NewRequest(http.MethodPost, "/auth/signup", strings.NewReader(validPassV0SignupJSON())))
		requireJSONContract(t, first, http.StatusCreated, profileContractKeys)
		response := serveContractRequest(handler, httptest.NewRequest(http.MethodPost, "/auth/signup", strings.NewReader(validPassV0SignupJSON())))

		requireErrorContract(t, response, http.StatusTooManyRequests, "rate_limited")
		if retryAfter := response.Header().Get("Retry-After"); retryAfter != "60" {
			t.Fatalf("Retry-After = %q, want 60", retryAfter)
		}
	})

	t.Run("duplicate signup", func(t *testing.T) {
		userStore := &passV0ContractUsers{createErr: &pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"}}
		router := &Router{account: newPassV0ContractAccountService(userStore)}
		response := serveContractRequest(
			http.HandlerFunc(router.handleSignup),
			httptest.NewRequest(http.MethodPost, "/auth/signup", strings.NewReader(validPassV0SignupJSON())),
		)

		requireErrorContract(t, response, http.StatusConflict, "email_already_registered")
	})

	t.Run("blocked event text", func(t *testing.T) {
		repository := &fakeEventRepository{}
		body := strings.Replace(validCreateEventJSON(eventstore.VisibilityPublic, ""), "Campus Scrim Night", "Bullshit Tournament", 1)
		response := serveContractRequest(
			authenticatedEventsHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/events", body),
		)

		requireErrorContract(t, response, http.StatusBadRequest, "invalid_request")
		if repository.createCalled {
			t.Fatal("blocked event text reached the repository")
		}
	})

	t.Run("invalid private password", func(t *testing.T) {
		passwordHash, err := auth.HashPassword("PrivatePass8")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPrivate), privateHash: passwordHash}
		router := &Router{events: repository}
		response := serveContractRequest(
			http.HandlerFunc(router.handleEventPath),
			httptest.NewRequest(http.MethodPost, "/events/campus-scrim-night/unlock", strings.NewReader(`{"password":"WrongPass8"}`)),
		)

		requireErrorContract(t, response, http.StatusUnauthorized, "invalid_private_password")
	})

	t.Run("private event locked", func(t *testing.T) {
		repository := &fakeEventRepository{detail: testEvent(eventstore.VisibilityPrivate)}
		response := serveContractRequest(
			authenticatedEventPathHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`),
		)

		requireErrorContract(t, response, http.StatusForbidden, "private_event_locked")
	})

	t.Run("event full", func(t *testing.T) {
		repository := &fakeEventRepository{
			detail:  testEvent(eventstore.VisibilityPublic),
			rsvpErr: eventstore.ErrEventFull,
		}
		response := serveContractRequest(
			authenticatedEventPathHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/events/campus-scrim-night/rsvp", `{"response":"yes"}`),
		)

		requireErrorContract(t, response, http.StatusConflict, "event_full")
	})

	t.Run("invalid team password", func(t *testing.T) {
		passwordHash, err := auth.HashPassword("TeamPass8")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		repository := &fakeTeamRepository{detail: testTeam(), passwordHash: passwordHash}
		response := serveContractRequest(
			authenticatedTeamPathHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/join", `{"password":"WrongPass8"}`),
		)

		requireErrorContract(t, response, http.StatusUnauthorized, "invalid_team_password")
	})

	t.Run("team transfer failed", func(t *testing.T) {
		repository := &fakeTeamRepository{detail: testTeam(), err: errors.New("database unavailable")}
		response := serveContractRequest(
			authenticatedTeamPathHandler(repository),
			authenticatedEventRequest(http.MethodPost, "/teams/varsity-rocket-league/transfer-ownership", `{"new_owner_user_id":"`+testTeamCaptainID+`"}`),
		)

		requireErrorContract(t, response, http.StatusInternalServerError, "team_transfer_failed")
	})
}

var profileContractKeys = []string{
	"email",
	"home_school_id",
	"id",
	"name",
	"timezone",
	"verification_level",
}

var eventContractKeys = []string{
	"description",
	"ends_at",
	"format",
	"games",
	"host_school",
	"id",
	"interest_count",
	"is_paid",
	"lifecycle",
	"rsvp_yes_count",
	"slug",
	"starts_at",
	"timezone",
	"title",
	"visibility",
}

var teamContractKeys = []string{
	"description",
	"games",
	"id",
	"member_count",
	"name",
	"owner_user_id",
	"school",
	"slug",
}

func serveContractRequest(handler http.Handler, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func requireJSONContract(t *testing.T, response *httptest.ResponseRecorder, status int, keys []string) map[string]any {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	requireExactKeysContract(t, payload, keys)
	return payload
}

func requireNoContentContract(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusNoContent, response.Body.String())
	}
	if response.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty body", response.Body.String())
	}
}

func requireErrorContract(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	payload := requireJSONContract(t, response, status, []string{"error"})
	requireStringContract(t, payload, "error", code)
}

func requireEventContract(t *testing.T, value any, keys []string) map[string]any {
	t.Helper()
	event, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("event = %#v, want JSON object", value)
	}
	requireExactKeysContract(t, event, keys)
	requireEventAssociationsContract(t, event)
	return event
}

func requireEventAssociationsContract(t *testing.T, event map[string]any) {
	t.Helper()
	school, ok := event["host_school"].(map[string]any)
	if !ok {
		t.Fatalf("host_school = %#v, want JSON object", event["host_school"])
	}
	requireExactKeysContract(t, school, []string{"city", "id", "name", "slug", "state"})
	games := requireJSONArrayContract(t, event, "games", 1)
	game, ok := games[0].(map[string]any)
	if !ok {
		t.Fatalf("games[0] = %#v, want JSON object", games[0])
	}
	requireExactKeysContract(t, game, []string{"id", "name", "slug"})
}

func requireTeamContract(t *testing.T, value any, keys []string) map[string]any {
	t.Helper()
	team, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("team = %#v, want JSON object", value)
	}
	requireExactKeysContract(t, team, keys)
	requireTeamAssociationsContract(t, team)
	return team
}

func requireTeamAssociationsContract(t *testing.T, team map[string]any) {
	t.Helper()
	school, ok := team["school"].(map[string]any)
	if !ok {
		t.Fatalf("school = %#v, want JSON object", team["school"])
	}
	requireExactKeysContract(t, school, []string{"city", "id", "name", "slug", "state"})
	games := requireJSONArrayContract(t, team, "games", 1)
	game, ok := games[0].(map[string]any)
	if !ok {
		t.Fatalf("games[0] = %#v, want JSON object", games[0])
	}
	requireExactKeysContract(t, game, []string{"id", "name", "slug"})
}

func requireJSONArrayContract(t *testing.T, payload map[string]any, key string, length int) []any {
	t.Helper()
	values, ok := payload[key].([]any)
	if !ok {
		t.Fatalf("%s = %#v, want JSON array", key, payload[key])
	}
	if len(values) != length {
		t.Fatalf("len(%s) = %d, want %d", key, len(values), length)
	}
	return values
}

func requireStringContract(t *testing.T, payload map[string]any, key string, expected string) {
	t.Helper()
	if value, ok := payload[key].(string); !ok || value != expected {
		t.Fatalf("%s = %#v, want %q", key, payload[key], expected)
	}
}

func requireNonEmptyStringContract(t *testing.T, payload map[string]any, key string) {
	t.Helper()
	if value, ok := payload[key].(string); !ok || strings.TrimSpace(value) == "" {
		t.Fatalf("%s = %#v, want non-empty string", key, payload[key])
	}
}

func requireExactKeysContract(t *testing.T, payload map[string]any, expected []string) {
	t.Helper()
	actual := make([]string, 0, len(payload))
	for key := range payload {
		actual = append(actual, key)
	}
	sort.Strings(actual)
	want := append([]string(nil), expected...)
	sort.Strings(want)
	if strings.Join(actual, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("JSON keys = %v, want %v", actual, want)
	}
}

func appendContractKeys(keys []string, additional ...string) []string {
	result := append([]string(nil), keys...)
	return append(result, additional...)
}

func validPassV0SignupJSON() string {
	return `{
		"email":"player@example.com",
		"password":"Password12345!",
		"name":"Player One",
		"home_school_id":"33333333-3333-3333-3333-333333333333",
		"age_confirmed":true,
		"timezone":"America/Los_Angeles"
	}`
}

type passV0ContractUsers struct {
	createErr error
}

func (r *passV0ContractUsers) Create(_ context.Context, params users.CreateParams) (users.Profile, error) {
	if r.createErr != nil {
		return users.Profile{}, r.createErr
	}
	return users.Profile{
		ID:                testUserID,
		Email:             params.Email,
		VerificationLevel: "basic",
		Name:              params.Name,
		Timezone:          params.Timezone,
		HomeSchoolID:      params.HomeSchoolID,
	}, nil
}

func (r *passV0ContractUsers) FindByID(context.Context, string) (users.Profile, error) {
	return users.Profile{}, pgx.ErrNoRows
}

func (r *passV0ContractUsers) FindByEmail(context.Context, string) (users.Profile, error) {
	return users.Profile{}, pgx.ErrNoRows
}

func (r *passV0ContractUsers) UpdateProfile(context.Context, string, users.ProfileUpdate) (users.Profile, error) {
	return users.Profile{}, nil
}

func (r *passV0ContractUsers) FindCredentialsByEmail(context.Context, string) (users.Credentials, error) {
	return users.Credentials{}, pgx.ErrNoRows
}

func (r *passV0ContractUsers) MarkEmailVerified(context.Context, string) error {
	return nil
}

func (r *passV0ContractUsers) UpdatePassword(context.Context, string, string) error {
	return nil
}

func (r *passV0ContractUsers) ReplaceSocialLinks(context.Context, string, []users.SocialLink) error {
	return nil
}

func (r *passV0ContractUsers) DeleteAccount(context.Context, string) error {
	return nil
}

type passV0ContractSchools struct{}

func (passV0ContractSchools) List(context.Context, schools.ListParams) ([]schools.School, error) {
	return nil, nil
}

func (passV0ContractSchools) GetByID(context.Context, string) (schools.School, error) {
	return schools.School{}, nil
}

func (passV0ContractSchools) GetBySlug(context.Context, string) (schools.School, error) {
	return schools.School{}, nil
}

func (passV0ContractSchools) ExistsActive(context.Context, string) (bool, error) {
	return true, nil
}

type passV0ContractSessions struct{}

func (passV0ContractSessions) CreateSession(context.Context, string, []byte, time.Time) error {
	return nil
}

func (passV0ContractSessions) RevokeSession(context.Context, []byte) error {
	return nil
}

type passV0ContractTokens struct{}

func (passV0ContractTokens) CreateEmailVerificationToken(context.Context, string, []byte, time.Time) error {
	return nil
}

func (passV0ContractTokens) ConsumeEmailVerificationToken(context.Context, []byte, time.Time) (string, error) {
	return "", pgx.ErrNoRows
}

func (passV0ContractTokens) CreatePasswordResetToken(context.Context, string, []byte, time.Time) error {
	return nil
}

func (passV0ContractTokens) UsePasswordResetToken(context.Context, []byte, time.Time, string) error {
	return nil
}

type passV0ContractMailer struct{}

func (passV0ContractMailer) SendVerification(context.Context, string, string) error {
	return nil
}

func (passV0ContractMailer) SendPasswordReset(context.Context, string, string) error {
	return nil
}

func newPassV0ContractAccountService(userStore *passV0ContractUsers) *auth.AccountService {
	return auth.NewAccountService(
		userStore,
		passV0ContractSchools{},
		passV0ContractSessions{},
		passV0ContractTokens{},
		passV0ContractMailer{},
		time.Hour,
		time.Hour,
		time.Hour,
	)
}
