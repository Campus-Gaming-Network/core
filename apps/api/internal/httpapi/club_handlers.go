package httpapi

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
)

// handleClub answers GET /clubs/{slug} with one published club.
func (r *Router) handleClub(w http.ResponseWriter, req *http.Request) {
	if r.clubs == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	club, err := r.clubs.GetBySlug(req.Context(), req.PathValue("slug"))
	if err != nil {
		writeApplicationError(w, err, "club_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, club)
}

// handleSchoolClubs answers GET /schools/{slug}/clubs with the school's
// published clubs.
func (r *Router) handleSchoolClubs(w http.ResponseWriter, req *http.Request, schoolSlug string) {
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if r.clubs == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	result, err := r.clubs.ListBySchool(req.Context(), schoolSlug)
	if err != nil {
		writeApplicationError(w, err, "clubs_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string][]clubs.ListItem{"clubs": result})
}

// handleClubs answers GET /clubs: one page of published clubs across schools,
// by name, narrowed by name search, school, type, and game.
func (r *Router) handleClubs(w http.ResponseWriter, req *http.Request) {
	if r.clubs == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	values := req.URL.Query()
	limit, err := parseListLimit(values)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	after, before, err := parseKeyListCursors(values)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	query := strings.TrimSpace(values.Get("q"))
	if utf8.RuneCountInString(query) > maximumClubQueryLength {
		writeError(w, http.StatusBadRequest, "invalid_query")
		return
	}
	clubType := values.Get("type")
	if clubType != "" && clubType != clubs.TypeStudentClub && clubType != clubs.TypeUniversityProgram {
		writeError(w, http.StatusBadRequest, "invalid_type")
		return
	}
	// One extra row tells the page whether another follows it.
	params := clubs.ListParams{
		Query: query, SchoolSlug: values.Get("school"), Type: clubType, GameSlug: values.Get("game"),
		Limit: limit + 1, After: after, Before: before,
	}
	result, err := r.clubs.List(req.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "clubs_unavailable")
		return
	}
	page := makeKeyCursorPage(result, limit, after, before, func(club clubs.ListItem) (string, string) {
		return club.SortKey, club.ID
	})
	items := page.Items
	if items == nil {
		items = []clubs.ListItem{}
	}
	payload := map[string]any{
		"clubs":        items,
		"limit":        limit,
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

// maximumClubQueryLength bounds the directory's name search, in characters.
const maximumClubQueryLength = 100
