package httpapi

import (
	"net/http"

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
