package httpapi

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
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

type clubRequestRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
	clubs.ClaimEvidence
}

// handleClubClaim answers POST /clubs/{slug}/claims: a signed-in officer
// claims a published, unclaimed club for site admins to review.
func (r *Router) handleClubClaim(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubClaimant(w, req)
	if !ok {
		return
	}
	var evidence clubs.ClaimEvidence
	if !decodeJSON(w, req, &evidence) {
		return
	}
	receipt, err := r.clubs.SubmitClaim(req.Context(), clubs.ClaimInput{
		UserID: userID, ClubSlug: req.PathValue("slug"), ClaimEvidence: evidence,
	})
	if err != nil {
		writeApplicationError(w, err, "club_claim_failed")
		return
	}
	writeJSON(w, http.StatusCreated, receipt)
}

// handleClubRequest answers POST /schools/{slug}/club-requests: a signed-in
// officer asks for a club the school does not list yet.
func (r *Router) handleClubRequest(w http.ResponseWriter, req *http.Request, schoolSlug string) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	userID, ok := r.clubClaimant(w, req)
	if !ok {
		return
	}
	var request clubRequestRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	receipt, err := r.clubs.SubmitRequest(req.Context(), clubs.RequestInput{
		UserID: userID, SchoolSlug: schoolSlug, Name: request.Name, Type: request.Type, ClaimEvidence: request.ClaimEvidence,
	})
	if err != nil {
		writeApplicationError(w, err, "club_request_failed")
		return
	}
	writeJSON(w, http.StatusCreated, receipt)
}

// clubClaimant returns the signed-in user, within the per-account limit that
// claims and requests share.
func (r *Router) clubClaimant(w http.ResponseWriter, req *http.Request) (string, bool) {
	if r.clubs == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return "", false
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return "", false
	}
	if !r.allowAccount("club-claim", userID) {
		rateLimitExceeded(w, r)
		return "", false
	}
	return userID, true
}
