package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

func TestMapApplicationError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		fallback   string
		wantStatus int
		wantCode   string
	}{
		{
			name:       "validation",
			err:        apperror.Validation("title is required"),
			fallback:   "event_create_failed",
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_request",
		},
		{
			name:       "unprocessable reference",
			err:        apperror.New(apperror.KindUnprocessable, "game_not_found", "game not found"),
			fallback:   "event_create_failed",
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "game_not_found",
		},
		{
			name:       "not found",
			err:        apperror.New(apperror.KindNotFound, "event_not_found", "event not found"),
			fallback:   "event_unavailable",
			wantStatus: http.StatusNotFound,
			wantCode:   "event_not_found",
		},
		{
			name:       "conflict through wrapping",
			err:        fmt.Errorf("create event: %w", apperror.New(apperror.KindConflict, "event_full", "event is full")),
			fallback:   "event_create_failed",
			wantStatus: http.StatusConflict,
			wantCode:   "event_full",
		},
		{
			name:       "authentication",
			err:        apperror.New(apperror.KindAuthentication, "invalid_credentials", "invalid credentials"),
			fallback:   "login_failed",
			wantStatus: http.StatusUnauthorized,
			wantCode:   "invalid_credentials",
		},
		{
			name:       "authorization",
			err:        apperror.New(apperror.KindAuthorization, "not_event_organizer", "event organizer required"),
			fallback:   "event_update_failed",
			wantStatus: http.StatusForbidden,
			wantCode:   "not_event_organizer",
		},
		{
			name:       "wording does not classify an unexpected error",
			err:        errors.New("required value was not valid or allowed"),
			fallback:   "operation_failed",
			wantStatus: http.StatusInternalServerError,
			wantCode:   "operation_failed",
		},
		{
			name:       "empty fallback uses generic code",
			err:        errors.New("database unavailable"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "internal_error",
		},
		{
			name:       "unknown application class uses fallback",
			err:        apperror.New(apperror.KindUnknown, "internal_database_detail", "database detail"),
			fallback:   "operation_failed",
			wantStatus: http.StatusInternalServerError,
			wantCode:   "operation_failed",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := mapApplicationError(test.err, test.fallback)
			if got.status != test.wantStatus || got.code != test.wantCode {
				t.Fatalf("mapApplicationError() = (%d, %q), want (%d, %q)", got.status, got.code, test.wantStatus, test.wantCode)
			}
		})
	}
}

func TestMapDomainErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "duplicate email", err: users.ErrDuplicateEmail, wantStatus: http.StatusConflict, wantCode: "email_already_registered"},
		{name: "home school", err: auth.ErrHomeSchoolNotFound, wantStatus: http.StatusUnprocessableEntity, wantCode: "home_school_not_found"},
		{name: "credentials", err: auth.ErrInvalidCredentials, wantStatus: http.StatusUnauthorized, wantCode: "invalid_credentials"},
		{name: "email verification", err: auth.ErrEmailUnverified, wantStatus: http.StatusForbidden, wantCode: "email_not_verified"},
		{name: "token", err: auth.ErrInvalidToken, wantStatus: http.StatusBadRequest, wantCode: "invalid_or_expired_token"},
		{name: "session", err: auth.ErrUnauthenticated, wantStatus: http.StatusUnauthorized, wantCode: "authentication_required"},
		{name: "school", err: schools.ErrSchoolNotFound, wantStatus: http.StatusNotFound, wantCode: "school_not_found"},
		{name: "event", err: eventstore.ErrEventNotFound, wantStatus: http.StatusNotFound, wantCode: "event_not_found"},
		{name: "event organizer", err: eventstore.ErrOrganizerRequired, wantStatus: http.StatusForbidden, wantCode: "not_event_organizer"},
		{name: "event host school", err: eventstore.ErrHostSchoolNotFound, wantStatus: http.StatusUnprocessableEntity, wantCode: "host_school_not_found"},
		{name: "event game", err: eventstore.ErrGameNotFound, wantStatus: http.StatusUnprocessableEntity, wantCode: "game_not_found"},
		{name: "event slug", err: eventstore.ErrSlugUnavailable, wantStatus: http.StatusConflict, wantCode: "event_slug_unavailable"},
		{name: "event full", err: eventstore.ErrEventFull, wantStatus: http.StatusConflict, wantCode: "event_full"},
		{name: "event RSVP closed", err: eventstore.ErrRSVPClosed, wantStatus: http.StatusConflict, wantCode: "event_rsvp_closed"},
		{name: "team", err: teamstore.ErrTeamNotFound, wantStatus: http.StatusNotFound, wantCode: "team_not_found"},
		{name: "team school", err: teamstore.ErrSchoolNotFound, wantStatus: http.StatusUnprocessableEntity, wantCode: "team_school_not_found"},
		{name: "team game", err: teamstore.ErrGameNotFound, wantStatus: http.StatusUnprocessableEntity, wantCode: "team_game_not_found"},
		{name: "team slug", err: teamstore.ErrSlugUnavailable, wantStatus: http.StatusConflict, wantCode: "team_slug_unavailable"},
		{name: "team owner", err: teamstore.ErrNotTeamOwner, wantStatus: http.StatusForbidden, wantCode: "not_team_owner"},
		{name: "team member", err: teamstore.ErrTeamMemberNotFound, wantStatus: http.StatusUnprocessableEntity, wantCode: "team_member_not_found"},
		{name: "team role", err: teamstore.ErrInvalidTeamRole, wantStatus: http.StatusBadRequest, wantCode: "invalid_team_role"},
		{name: "report target", err: safety.ErrReportTargetNotFound, wantStatus: http.StatusNotFound, wantCode: "report_target_not_found"},
		{name: "self report", err: safety.ErrCannotReportSelf, wantStatus: http.StatusBadRequest, wantCode: "cannot_report_self"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := mapApplicationError(fmt.Errorf("domain operation: %w", test.err), "operation_failed")
			if got.status != test.wantStatus || got.code != test.wantCode {
				t.Fatalf("mapApplicationError() = (%d, %q), want (%d, %q)", got.status, got.code, test.wantStatus, test.wantCode)
			}
		})
	}
}
