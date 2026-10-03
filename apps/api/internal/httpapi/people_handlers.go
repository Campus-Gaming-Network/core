package httpapi

import (
	"errors"
	"net/http"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/people"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/jackc/pgx/v5"
)

// The people lists name members of the community, so only a signed-in visitor
// may read them, and no response is cacheable: it depends on who is asking and,
// for a private event, on what they have unlocked.

// peopleListRequest is a validated request for one page of a people list.
type peopleListRequest struct {
	limit  int
	params people.ListParams
}

// startPeopleList runs the checks every people list shares, in order: the
// response is marked uncacheable, the viewer must be signed in, and the page
// size and cursors must be valid. It writes the error response and returns
// false when a check fails. varyOn names request headers beyond the session
// cookie that change the response.
func (r *Router) startPeopleList(w http.ResponseWriter, req *http.Request, varyOn ...string) (peopleListRequest, bool) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Vary", "Cookie, Authorization")
	for _, header := range varyOn {
		w.Header().Add("Vary", header)
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return peopleListRequest{}, false
	}
	if r.people == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return peopleListRequest{}, false
	}
	if _, err := auth.RequireUser(req.Context()); err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return peopleListRequest{}, false
	}
	limit, err := parseListLimit(req.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return peopleListRequest{}, false
	}
	after, before, err := parseKeyListCursors(req.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return peopleListRequest{}, false
	}
	// One extra row tells the page whether another follows it.
	return peopleListRequest{
		limit:  limit,
		params: people.ListParams{Limit: limit + 1, After: after, Before: before},
	}, true
}

func writePeopleList(w http.ResponseWriter, list peopleListRequest, result []people.Person) {
	page := makeKeyCursorPage(result, list.limit, list.params.After, list.params.Before, func(person people.Person) (string, string) {
		return person.SortKey, person.ID
	})
	items := page.Items
	if items == nil {
		items = []people.Person{}
	}

	payload := map[string]any{
		"people":       items,
		"limit":        list.limit,
		"has_more":     page.HasMore,
		"has_previous": page.HasPrevious,
	}
	if page.NextCursor != "" {
		payload["next_cursor"] = page.NextCursor
	}
	if page.PreviousCursor != "" {
		payload["previous_cursor"] = page.PreviousCursor
	}
	writeJSON(w, http.StatusOK, payload)
}

// handleEventAttendees answers GET /events/{slug}/attendees with the people
// who RSVPed yes (the default) or maybe. A viewer who may not see the event
// page gets the same 404 as for a missing event, so the list leaks neither
// that a private event exists nor who is going.
func (r *Router) handleEventAttendees(w http.ResponseWriter, req *http.Request, slug string) {
	list, ok := r.startPeopleList(w, req, "X-CGN-Event-Unlock")
	if !ok {
		return
	}
	response := eventstore.RSVPYes
	if req.URL.Query().Has("response") {
		response = req.URL.Query().Get("response")
	}
	if response != eventstore.RSVPYes && response != eventstore.RSVPMaybe {
		writeError(w, http.StatusBadRequest, "invalid_response")
		return
	}

	event, err := r.events.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, eventstore.ErrEventNotFound) {
		writeError(w, http.StatusNotFound, "event_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unavailable")
		return
	}
	if event.IsPrivate() {
		allowed, err := r.canAccessPrivateEvent(req, slug)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "event_unavailable")
			return
		}
		if !allowed {
			writeError(w, http.StatusNotFound, "event_not_found")
			return
		}
	}

	result, err := r.people.ListEventAttendees(req.Context(), event.ID, response, list.params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "people_unavailable")
		return
	}
	writePeopleList(w, list, result)
}

// handleSchoolMembers answers GET /schools/{slug}/members with the people whose
// home school it is.
func (r *Router) handleSchoolMembers(w http.ResponseWriter, req *http.Request, slug string) {
	list, ok := r.startPeopleList(w, req)
	if !ok {
		return
	}
	if r.schools == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	school, err := r.schools.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, schools.ErrSchoolNotFound) {
		writeError(w, http.StatusNotFound, "school_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "school_unavailable")
		return
	}

	result, err := r.people.ListSchoolMembers(req.Context(), school.ID, list.params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "people_unavailable")
		return
	}
	writePeopleList(w, list, result)
}

// handleTeamMembers answers GET /teams/{slug}/members with the team's members
// and their roles. The team page itself is public; only this list needs a
// session. The owner's roster inside the team detail is a separate, unfiltered
// list used for captain management.
func (r *Router) handleTeamMembers(w http.ResponseWriter, req *http.Request, slug string) {
	list, ok := r.startPeopleList(w, req)
	if !ok {
		return
	}

	team, err := r.teams.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, teamstore.ErrTeamNotFound) {
		writeError(w, http.StatusNotFound, "team_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "team_unavailable")
		return
	}

	result, err := r.people.ListTeamMembers(req.Context(), team.ID, list.params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "people_unavailable")
		return
	}
	writePeopleList(w, list, result)
}
