package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/jackc/pgx/v5"
)

type createTeamRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	SchoolID    string   `json:"school_id"`
	GameIDs     []string `json:"game_ids"`
	Password    string   `json:"password"`
}

type joinTeamRequest struct {
	Password string `json:"password"`
}

type setTeamCaptainRequest struct {
	UserID  string `json:"user_id"`
	Captain bool   `json:"captain"`
}

type transferTeamOwnershipRequest struct {
	NewOwnerUserID string `json:"new_owner_user_id"`
}

func (r *Router) handleTeams(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/teams" {
		http.NotFound(w, req)
		return
	}
	if req.Method == http.MethodPost {
		r.handleCreateTeam(w, req)
		return
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}
	if r.teams == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	params := teamstore.ListParams{
		GameSlug:   req.URL.Query().Get("game"),
		SchoolSlug: req.URL.Query().Get("school"),
		Limit:      25,
		Offset:     0,
	}
	var err error
	if value := req.URL.Query().Get("limit"); value != "" {
		params.Limit, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
	}
	if value := req.URL.Query().Get("offset"); value != "" {
		params.Offset, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_offset")
			return
		}
	}
	params = teamstore.NormalizeListParams(params)
	result, err := r.teams.ListPublic(req.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "teams_unavailable")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"teams":  result,
		"limit":  params.Limit,
		"offset": params.Offset,
	})
}

func (r *Router) handleCreateTeam(w http.ResponseWriter, req *http.Request) {
	if r.teams == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allow("team-create:"+userID, req) {
		rateLimitExceeded(w, r)
		return
	}

	var request createTeamRequest
	if !decodeJSON(w, req, &request) {
		return
	}

	input := teamstore.CreateInput{
		Name:        request.Name,
		Description: request.Description,
		OwnerUserID: userID,
		SchoolID:    request.SchoolID,
		GameIDs:     request.GameIDs,
		Password:    request.Password,
	}
	if err := teamstore.ValidateCreateInput(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}

	passwordHash, err := auth.HashPassword(input.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "team_create_failed")
		return
	}
	team, err := r.teams.Create(req.Context(), teamstore.CreateParams{
		CreateInput:  input,
		PasswordHash: passwordHash,
	})
	if err != nil {
		writeTeamMutationError(w, err, "team_create_failed")
		return
	}
	writeJSON(w, http.StatusCreated, team)
}

func (r *Router) handleTeamPath(w http.ResponseWriter, req *http.Request) {
	if r.teams == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	parts, err := pathParts(req.URL.Path, "/teams/")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_team_slug")
		return
	}
	if len(parts) == 2 && parts[1] == "join" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		r.handleJoinTeam(w, req, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "captains" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		r.handleSetTeamCaptain(w, req, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "transfer-ownership" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		r.handleTransferTeamOwnership(w, req, parts[0])
		return
	}
	if len(parts) != 1 || parts[0] == "" {
		http.NotFound(w, req)
		return
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	slug := parts[0]
	team, err := r.teams.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, teamstore.ErrTeamNotFound) {
		writeError(w, http.StatusNotFound, "team_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "team_unavailable")
		return
	}
	if err := r.decorateTeamForViewer(req, slug, &team); err != nil {
		writeError(w, http.StatusInternalServerError, "team_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (r *Router) handleJoinTeam(w http.ResponseWriter, req *http.Request, slug string) {
	if r.teams == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allow("team-join:"+slug+":"+userID, req) {
		rateLimitExceeded(w, r)
		return
	}

	var request joinTeamRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	passwordHash, err := r.teams.PasswordHash(req.Context(), slug)
	if errors.Is(err, teamstore.ErrTeamNotFound) {
		writeError(w, http.StatusNotFound, "team_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "team_join_failed")
		return
	}
	if !auth.ComparePassword(passwordHash, strings.TrimSpace(request.Password)) {
		writeError(w, http.StatusUnauthorized, "invalid_team_password")
		return
	}
	team, err := r.teams.Join(req.Context(), slug, userID)
	if err != nil {
		writeTeamMutationError(w, err, "team_join_failed")
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (r *Router) handleSetTeamCaptain(w http.ResponseWriter, req *http.Request, slug string) {
	if r.teams == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}

	var request setTeamCaptainRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	team, err := r.teams.SetCaptain(req.Context(), slug, userID, request.UserID, request.Captain)
	if err != nil {
		writeTeamMutationError(w, err, "team_captain_failed")
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (r *Router) handleTransferTeamOwnership(w http.ResponseWriter, req *http.Request, slug string) {
	if r.teams == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}

	var request transferTeamOwnershipRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	team, err := r.teams.TransferOwnership(req.Context(), slug, userID, request.NewOwnerUserID)
	if err != nil {
		writeTeamMutationError(w, err, "team_transfer_failed")
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (r *Router) decorateTeamForViewer(req *http.Request, slug string, team *teamstore.Team) error {
	userID, ok := auth.UserID(req.Context())
	if !ok || !looksLikeUUID(userID) {
		return nil
	}
	role, err := r.teams.MembershipRole(req.Context(), slug, userID)
	if err != nil {
		return err
	}
	if role != "" {
		team.ViewerRole = &role
	}
	if role == teamstore.RoleOwner {
		members, err := r.teams.ListMembers(req.Context(), slug)
		if err != nil {
			return err
		}
		team.Members = members
	}
	return nil
}

func writeTeamMutationError(w http.ResponseWriter, err error, fallbackCode string) {
	switch {
	case errors.Is(err, teamstore.ErrTeamNotFound):
		writeError(w, http.StatusNotFound, "team_not_found")
	case errors.Is(err, teamstore.ErrSchoolNotFound):
		writeError(w, http.StatusUnprocessableEntity, "team_school_not_found")
	case errors.Is(err, teamstore.ErrGameNotFound):
		writeError(w, http.StatusUnprocessableEntity, "team_game_not_found")
	case errors.Is(err, teamstore.ErrSlugUnavailable):
		writeError(w, http.StatusConflict, "team_slug_unavailable")
	case errors.Is(err, teamstore.ErrNotTeamOwner):
		writeError(w, http.StatusForbidden, "not_team_owner")
	case errors.Is(err, teamstore.ErrTeamMemberNotFound):
		writeError(w, http.StatusUnprocessableEntity, "team_member_not_found")
	case errors.Is(err, teamstore.ErrInvalidTeamRole):
		writeError(w, http.StatusBadRequest, "invalid_team_role")
	case isValidationError(err):
		writeError(w, http.StatusBadRequest, "invalid_request")
	default:
		writeError(w, http.StatusInternalServerError, fallbackCode)
	}
}

func pathParts(path string, prefix string) ([]string, error) {
	trimmed := strings.TrimPrefix(path, prefix)
	trimmed = strings.TrimSuffix(trimmed, "/")
	if trimmed == "" {
		return nil, nil
	}
	rawParts := strings.Split(trimmed, "/")
	parts := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		unescaped, err := url.PathUnescape(part)
		if err != nil {
			return nil, err
		}
		parts = append(parts, unescaped)
	}
	return parts, nil
}
