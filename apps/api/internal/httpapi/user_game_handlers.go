package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
)

// userGameLists stores the games users list on their profiles.
type userGameLists interface {
	UserLists(ctx context.Context, userID string) (games.UserLists, error)
	AddToList(ctx context.Context, userID string, list games.List, gameIDs []string) error
	RemoveFromLists(ctx context.Context, userID, gameID string) error
	MoveInList(ctx context.Context, userID, gameID string, position int) error
}

// addUserGamesRequest names a list and the games to add to it, picked the
// same way an event or team form picks its games.
type addUserGamesRequest struct {
	List    games.List `json:"list"`
	GameIDs []string   `json:"game_ids"`
	pickedGames
}

type moveUserGameRequest struct {
	Position *int `json:"position"`
}

// handleMyGames answers GET /me/games with the viewer's lists and POST
// /me/games by adding games to one of them.
func (r *Router) handleMyGames(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}
	userID, ok := r.requireUserGames(w, req)
	if !ok {
		return
	}
	if req.Method == http.MethodGet {
		r.writeUserLists(w, req, userID)
		return
	}
	if !r.allowAccount("user-games", userID) {
		rateLimitExceeded(w, r)
		return
	}

	var request addUserGamesRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	added := len(request.GameIDs) + len(request.IGDBGameIDs)
	if strings.TrimSpace(request.OtherGame) != "" {
		added++
	}
	if !request.List.Valid() || added == 0 || added > games.MaximumAddedGames {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	for _, gameID := range request.GameIDs {
		if !looksLikeUUID(gameID) {
			writeError(w, http.StatusBadRequest, "invalid_id")
			return
		}
	}
	if !r.checkPickedGames(w, userID, request.pickedGames) {
		return
	}
	// Picked games are imported only once the rest of the request is valid.
	gameIDs, ok := r.resolvePickedGames(w, req, request.GameIDs, request.pickedGames)
	if !ok {
		return
	}
	if err := r.userGames.AddToList(req.Context(), userID, request.List, gameIDs); err != nil {
		writeApplicationError(w, err, "user_games_update_failed")
		return
	}
	r.writeUserLists(w, req, userID)
}

// handleRemoveMyGame answers DELETE /me/games/{gameID} by taking the game off
// whichever of the viewer's lists holds it.
func (r *Router) handleRemoveMyGame(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.requireUserGames(w, req)
	if !ok {
		return
	}
	gameID := req.PathValue("gameID")
	if !looksLikeUUID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	if !r.allowAccount("user-games", userID) {
		rateLimitExceeded(w, r)
		return
	}
	if err := r.userGames.RemoveFromLists(req.Context(), userID, gameID); err != nil {
		writeApplicationError(w, err, "user_games_update_failed")
		return
	}
	r.writeUserLists(w, req, userID)
}

// handleMoveMyGame answers POST /me/games/{gameID}/position by moving a
// listed game to a position in its list.
func (r *Router) handleMoveMyGame(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.requireUserGames(w, req)
	if !ok {
		return
	}
	gameID := req.PathValue("gameID")
	if !looksLikeUUID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	if !r.allowAccount("user-games", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var request moveUserGameRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if request.Position == nil || *request.Position < 0 {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := r.userGames.MoveInList(req.Context(), userID, gameID, *request.Position); err != nil {
		writeApplicationError(w, err, "user_games_update_failed")
		return
	}
	r.writeUserLists(w, req, userID)
}

// requireUserGames checks the lists are available and the request is signed
// in. It writes the error response and reports false otherwise.
func (r *Router) requireUserGames(w http.ResponseWriter, req *http.Request) (string, bool) {
	if r.userGames == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return "", false
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return "", false
	}
	return userID, true
}

func (r *Router) writeUserLists(w http.ResponseWriter, req *http.Request, userID string) {
	lists, err := r.userLists(req.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "user_games_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, lists)
}

// userLists reads a user's lists with each stored cover served by the site.
func (r *Router) userLists(ctx context.Context, userID string) (games.UserLists, error) {
	lists, err := r.userGames.UserLists(ctx, userID)
	if err != nil {
		return games.UserLists{}, err
	}
	for _, game := range lists.Games() {
		*game = r.withSiteCoverURL(*game)
	}
	return lists, nil
}
