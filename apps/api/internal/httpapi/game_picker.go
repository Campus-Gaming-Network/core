package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
)

// maxPickedIGDBGames bounds how many IGDB games one request may import.
const maxPickedIGDBGames = 5

// gamePicker searches IGDB and imports the games users pick.
type gamePicker interface {
	SearchForPicker(ctx context.Context, query string) ([]games.IGDBResult, error)
	EnsureFromIGDB(ctx context.Context, igdbID int64) (games.AdminGame, error)
}

// customGames stores games users type in.
type customGames interface {
	EnsureCustom(ctx context.Context, name string) (games.AdminGame, error)
}

// pickedGames are the games an event or team form names beyond catalog IDs.
type pickedGames struct {
	// IGDBGameIDs are IGDB search results the user chose.
	IGDBGameIDs []int64 `json:"igdb_game_ids"`
	// OtherGame is a name the user typed because no listed game fit.
	OtherGame string `json:"other_game"`
}

// handleGameSearch lets a signed-in user search IGDB from a game picker.
func (r *Router) handleGameSearch(w http.ResponseWriter, req *http.Request) {
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if r.picker == nil {
		writeError(w, http.StatusServiceUnavailable, "igdb_not_configured")
		return
	}
	if r.gameSearchLimiter != nil {
		// Typing in the picker searches as it goes, so the limit is per minute.
		if !r.gameSearchLimiter.Allow(userID) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
	}
	matches, err := r.picker.SearchForPicker(req.Context(), req.URL.Query().Get("q"))
	if err != nil {
		writeGamePickerError(w, err, "game_search_failed")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"games": matches})
}

// pendingGameID stands in for picked games while the rest of a request is
// validated, so "at least one game" passes before anything is imported.
const pendingGameID = "pending-picked-game"

// pending reports whether the form named a game beyond its catalog IDs.
func (picked pickedGames) pending() bool {
	return len(picked.IGDBGameIDs) > 0 || strings.TrimSpace(picked.OtherGame) != ""
}

// checkPickedGames rejects picks that can never be used, without calling IGDB
// or writing anything. It writes the error response and reports false.
func (r *Router) checkPickedGames(w http.ResponseWriter, userID string, picked pickedGames) bool {
	if !picked.pending() {
		return true
	}
	other := strings.TrimSpace(picked.OtherGame)
	switch {
	case len(picked.IGDBGameIDs) > maxPickedIGDBGames:
		writeError(w, http.StatusBadRequest, "invalid_request")
	case len(picked.IGDBGameIDs) > 0 && r.picker == nil:
		writeError(w, http.StatusServiceUnavailable, "igdb_not_configured")
	case other != "" && (r.customGames == nil || safety.ContainsBlockedLanguage(other)):
		writeError(w, http.StatusBadRequest, "invalid_game_name")
	// Requests that add games share the search budget, which bounds how often
	// one user can make the API call IGDB.
	case r.gameSearchLimiter != nil && !r.gameSearchLimiter.Allow(userID):
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limited")
	default:
		return true
	}
	return false
}

// resolvePickedGames imports the picked IGDB games and stores the typed name,
// and returns their catalog IDs after the IDs the form already named. Callers
// run it only after the request is validated and authorized. It writes the
// error response and reports false when a game cannot be used.
func (r *Router) resolvePickedGames(w http.ResponseWriter, req *http.Request, gameIDs []string, picked pickedGames) ([]string, bool) {
	resolved := append([]string{}, gameIDs...)
	for _, igdbID := range picked.IGDBGameIDs {
		game, err := r.picker.EnsureFromIGDB(req.Context(), igdbID)
		if err != nil {
			writeGamePickerError(w, err, "game_import_failed")
			return nil, false
		}
		resolved = append(resolved, game.ID)
	}
	if other := strings.TrimSpace(picked.OtherGame); other != "" {
		game, err := r.customGames.EnsureCustom(req.Context(), other)
		if err != nil {
			writeGamePickerError(w, err, "game_import_failed")
			return nil, false
		}
		resolved = append(resolved, game.ID)
	}
	return resolved, true
}

func writeGamePickerError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, igdb.ErrNotFound):
		writeError(w, http.StatusUnprocessableEntity, "igdb_game_not_found")
	case errors.Is(err, igdb.ErrRateLimited), errors.Is(err, igdb.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "igdb_unavailable")
	default:
		writeApplicationError(w, err, fallback)
	}
}
