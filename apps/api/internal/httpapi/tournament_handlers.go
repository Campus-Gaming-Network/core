package httpapi

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
)

// eventTournaments manages the tournament settings and status on an event.
type eventTournaments interface {
	PutTournament(ctx context.Context, input eventstore.TournamentInput) (eventstore.Tournament, bool, error)
	DeleteTournament(ctx context.Context, slug string, userID string) error
	SetTournamentStatus(ctx context.Context, slug string, userID string, status string) (eventstore.Tournament, error)
}

type tournamentRequest struct {
	GameID               string     `json:"game_id"`
	EntryType            string     `json:"entry_type"`
	TeamSize             *int       `json:"team_size"`
	Substitutes          int        `json:"substitutes"`
	EntrantCap           *int       `json:"entrant_cap"`
	RegistrationClosesAt *time.Time `json:"registration_closes_at"`
	Format               string     `json:"format"`
	Rules                string     `json:"rules"`
	Prizes               string     `json:"prizes"`
}

type tournamentStatusRequest struct {
	Status string `json:"status"`
}

// tournamentStatuses are the statuses a request may name.
var tournamentStatuses = []string{
	eventstore.TournamentDraft,
	eventstore.TournamentRegistrationOpen,
	eventstore.TournamentInProgress,
	eventstore.TournamentCompleted,
	eventstore.TournamentCancelled,
}

// tournamentUser starts a tournament request: the store is wired and someone
// is signed in.
func (r *Router) tournamentUser(w http.ResponseWriter, req *http.Request) (string, bool) {
	if r.tournaments == nil {
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

// handleTournament answers PUT /events/{slug}/tournament, which creates
// (201) or replaces (200) the settings, and DELETE, which removes a draft's.
func (r *Router) handleTournament(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	if req.Method == http.MethodDelete {
		if err := r.tournaments.DeleteTournament(req.Context(), slug, userID); err != nil {
			writeApplicationError(w, err, "tournament_delete_failed")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var request tournamentRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	tournament, created, err := r.tournaments.PutTournament(req.Context(), eventstore.TournamentInput{
		Slug:                 slug,
		EditorUserID:         userID,
		GameID:               request.GameID,
		EntryType:            request.EntryType,
		TeamSize:             request.TeamSize,
		Substitutes:          request.Substitutes,
		EntrantCap:           request.EntrantCap,
		RegistrationClosesAt: request.RegistrationClosesAt,
		Format:               request.Format,
		Rules:                request.Rules,
		Prizes:               request.Prizes,
	})
	if err != nil {
		writeApplicationError(w, err, "tournament_update_failed")
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, tournament)
}

// handleTournamentStatus answers POST /events/{slug}/tournament/status.
func (r *Router) handleTournamentStatus(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	var request tournamentStatusRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if !slices.Contains(tournamentStatuses, request.Status) {
		writeError(w, http.StatusBadRequest, "invalid_tournament_status")
		return
	}
	tournament, err := r.tournaments.SetTournamentStatus(req.Context(), slug, userID, request.Status)
	if err != nil {
		writeApplicationError(w, err, "tournament_status_failed")
		return
	}
	writeJSON(w, http.StatusOK, tournament)
}
