package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/jackc/pgx/v5"
)

// eventTournaments manages the tournament settings and status on an event.
type eventTournaments interface {
	PutTournament(ctx context.Context, input eventstore.TournamentInput) (eventstore.Tournament, bool, error)
	DeleteTournament(ctx context.Context, slug string, userID string) error
	SetTournamentStatus(ctx context.Context, slug string, userID string, status string) (eventstore.Tournament, error)
	Register(ctx context.Context, input eventstore.RegisterInput) (eventstore.TournamentEntry, error)
	UpdateRoster(ctx context.Context, slug string, userID string, entryID string, roster []string) (eventstore.TournamentEntry, error)
	DeleteEntry(ctx context.Context, slug string, userID string, entryID string) error
	ListEntries(ctx context.Context, slug string, userID string) ([]eventstore.TournamentEntry, []eventstore.TournamentEntry, error)
	DecideEntry(ctx context.Context, slug string, userID string, entryID string, approve bool) (eventstore.TournamentEntry, error)
	ViewerEntry(ctx context.Context, slug string, userID string) (*eventstore.ViewerEntry, error)
	RegistrationTeams(ctx context.Context, slug string, userID string) ([]eventstore.RegistrationTeam, error)
	SetSeeds(ctx context.Context, slug string, userID string, entryIDs []string) ([]eventstore.TournamentEntry, error)
	GenerateBracket(ctx context.Context, slug string, userID string) ([]eventstore.TournamentMatch, error)
	ListMatches(ctx context.Context, slug string, userID string) ([]eventstore.TournamentMatch, error)
	RecordResult(ctx context.Context, input eventstore.ResultInput) ([]eventstore.TournamentMatch, error)
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
	BracketURL           string     `json:"bracket_url"`
	RegistrationMode     string     `json:"registration_mode"`
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
		BracketURL:           request.BracketURL,
		RegistrationMode:     request.RegistrationMode,
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

type registerRequest struct {
	TeamSlug string   `json:"team_slug"`
	Roster   []string `json:"roster"`
}

type rosterRequest struct {
	Roster []string `json:"roster"`
}

type seedsRequest struct {
	EntryIDs []string `json:"entry_ids"`
}

type resultRequest struct {
	WinnerEntryID string `json:"winner_entry_id"`
	Scores        []int  `json:"scores"`
	Walkover      bool   `json:"walkover"`
}

// tournamentEventVisible answers for an event that is missing, or private and
// not unlocked by the viewer, and reports whether the request may go on.
func (r *Router) tournamentEventVisible(w http.ResponseWriter, req *http.Request, slug string) bool {
	event, err := r.events.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "event_not_found")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unavailable")
		return false
	}
	if !event.IsPrivate() {
		return true
	}
	allowed, err := r.canAccessPrivateEvent(req, slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unavailable")
		return false
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "private_event_locked")
	}
	return allowed
}

// handleTournamentEntries answers GET /events/{slug}/tournament/entries, the
// entrant list, and POST, a registration. A signed-out viewer sees team
// names and solo entrants by seed only.
func (r *Router) handleTournamentEntries(w http.ResponseWriter, req *http.Request, slug string) {
	if r.tournaments == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if req.Method == http.MethodGet {
		if !r.tournamentEventVisible(w, req, slug) {
			return
		}
		userID, signedIn := auth.UserID(req.Context())
		if !signedIn || !looksLikeUUID(userID) {
			userID, signedIn = "", false
		}
		entries, requests, err := r.tournaments.ListEntries(req.Context(), slug, userID)
		if err != nil {
			writeApplicationError(w, err, "tournament_entries_unavailable")
			return
		}
		if !signedIn {
			for index, entry := range entries {
				entries[index] = entry.ForSignedOut()
			}
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Vary", "Cookie, Authorization, X-CGN-Event-Unlock")
		body := map[string]any{"entries": entries}
		if requests != nil {
			body["requests"] = requests
		}
		writeJSON(w, http.StatusOK, body)
		return
	}
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	var request registerRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if !r.tournamentEventVisible(w, req, slug) {
		return
	}
	entry, err := r.tournaments.Register(req.Context(), eventstore.RegisterInput{
		Slug:     slug,
		UserID:   userID,
		TeamSlug: request.TeamSlug,
		Roster:   request.Roster,
	})
	if err != nil {
		writeApplicationError(w, err, "tournament_registration_failed")
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

// handleTournamentEntry answers PATCH /events/{slug}/tournament/entries/{id},
// a roster change, and DELETE, a withdrawal or removal.
func (r *Router) handleTournamentEntry(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	entryID := req.PathValue("id")
	if !looksLikeUUID(entryID) {
		writeError(w, http.StatusNotFound, "tournament_entry_not_found")
		return
	}
	if req.Method == http.MethodDelete {
		if err := r.tournaments.DeleteEntry(req.Context(), slug, userID, entryID); err != nil {
			writeApplicationError(w, err, "tournament_entry_delete_failed")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var request rosterRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	entry, err := r.tournaments.UpdateRoster(req.Context(), slug, userID, entryID, request.Roster)
	if err != nil {
		writeApplicationError(w, err, "tournament_roster_failed")
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

// handleTournamentDecision answers POST
// /events/{slug}/tournament/entries/{id}/approve and .../decline, an
// organizer's decision on a pending request.
func (r *Router) handleTournamentDecision(approve bool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, req *http.Request, slug string) {
		userID, ok := r.tournamentUser(w, req)
		if !ok {
			return
		}
		entryID := req.PathValue("id")
		if !looksLikeUUID(entryID) {
			writeError(w, http.StatusNotFound, "tournament_entry_not_found")
			return
		}
		entry, err := r.tournaments.DecideEntry(req.Context(), slug, userID, entryID, approve)
		if err != nil {
			writeApplicationError(w, err, "tournament_decision_failed")
			return
		}
		writeJSON(w, http.StatusOK, entry)
	}
}

// handleTournamentTeams answers GET /events/{slug}/tournament/my-teams: the
// teams the viewer owns or captains, with the members a roster may pick.
func (r *Router) handleTournamentTeams(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	teams, err := r.tournaments.RegistrationTeams(req.Context(), slug, userID)
	if err != nil {
		writeApplicationError(w, err, "tournament_teams_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"teams": teams})
}

// handleTournamentSeeds answers PUT /events/{slug}/tournament/seeds, which
// orders the registered entries from seed 1.
func (r *Router) handleTournamentSeeds(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	var request seedsRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	entries, err := r.tournaments.SetSeeds(req.Context(), slug, userID, request.EntryIDs)
	if err != nil {
		writeApplicationError(w, err, "tournament_seeding_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// handleTournamentBracket answers POST /events/{slug}/tournament/bracket,
// which generates or regenerates the bracket.
func (r *Router) handleTournamentBracket(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	matches, err := r.tournaments.GenerateBracket(req.Context(), slug, userID)
	if err != nil {
		writeApplicationError(w, err, "tournament_bracket_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches})
}

// handleTournamentMatches answers GET /events/{slug}/tournament/matches: the
// bracket, with solo entrants' names for signed-in viewers only.
func (r *Router) handleTournamentMatches(w http.ResponseWriter, req *http.Request, slug string) {
	if r.tournaments == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.tournamentEventVisible(w, req, slug) {
		return
	}
	userID, signedIn := auth.UserID(req.Context())
	if !signedIn || !looksLikeUUID(userID) {
		userID, signedIn = "", false
	}
	matches, err := r.tournaments.ListMatches(req.Context(), slug, userID)
	if err != nil {
		writeApplicationError(w, err, "tournament_matches_unavailable")
		return
	}
	if !signedIn {
		for index, match := range matches {
			matches[index] = match.ForSignedOut()
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Vary", "Cookie, Authorization, X-CGN-Event-Unlock")
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches})
}

// handleTournamentResult answers POST
// /events/{slug}/tournament/matches/{id}/result, which enters or corrects a
// match's result and returns the bracket.
func (r *Router) handleTournamentResult(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.tournamentUser(w, req)
	if !ok {
		return
	}
	matchID := req.PathValue("id")
	if !looksLikeUUID(matchID) {
		writeError(w, http.StatusNotFound, "tournament_match_not_found")
		return
	}
	var request resultRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	matches, err := r.tournaments.RecordResult(req.Context(), eventstore.ResultInput{
		Slug: slug, UserID: userID, MatchID: matchID,
		WinnerEntryID: request.WinnerEntryID, Scores: request.Scores, Walkover: request.Walkover,
	})
	if err != nil {
		writeApplicationError(w, err, "tournament_result_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches})
}
