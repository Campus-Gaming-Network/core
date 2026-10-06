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

// resolvePickedGames turns picked IGDB games and a typed name into catalog
// game IDs, appended to the IDs the form already named. It writes the error
// response and reports false when a game cannot be used.
func (r *Router) resolvePickedGames(w http.ResponseWriter, req *http.Request, gameIDs []string, picked pickedGames) ([]string, bool) {
	other := strings.TrimSpace(picked.OtherGame)
	if len(picked.IGDBGameIDs) > maxPickedIGDBGames {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return nil, false
	}
	if len(picked.IGDBGameIDs) > 0 && r.picker == nil {
		writeError(w, http.StatusServiceUnavailable, "igdb_not_configured")
		return nil, false
	}
	if other != "" && (r.customGames == nil || safety.ContainsBlockedLanguage(other)) {
		writeError(w, http.StatusBadRequest, "invalid_game_name")
		return nil, false
	}
	resolved := append([]string{}, gameIDs...)
	for _, igdbID := range picked.IGDBGameIDs {
		game, err := r.picker.EnsureFromIGDB(req.Context(), igdbID)
		if err != nil {
			writeGamePickerError(w, err, "game_import_failed")
			return nil, false
		}
		resolved = append(resolved, game.ID)
	}
	if other != "" {
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
