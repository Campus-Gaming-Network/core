package httpapi

import (
	"context"
	"net/http"
	"net/mail"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

// clubEditorInviteTTL is how long an invite link to edit a club stays usable.
const clubEditorInviteTTL = 7 * 24 * time.Hour

// clubOfficers runs the commands of a club's owners, editors, and members.
// Every check happens in the store, against the person's role in the club.
type clubOfficers interface {
	Viewer(ctx context.Context, clubID, userID string) (clubs.Viewer, error)
	Join(ctx context.Context, slug, userID string) error
	ListForUser(ctx context.Context, userID string) ([]clubs.UserClub, error)
	Manage(ctx context.Context, slug, userID string) (clubs.Management, error)
	EditProfile(ctx context.Context, slug, userID string, edit clubs.ProfileEdit) error
	EditLinks(ctx context.Context, slug, userID string, links []clubs.Link) error
	Confirm(ctx context.Context, slug, userID string) error
	InviteEditor(ctx context.Context, params clubs.EditorInviteParams) (clubs.EditorInvite, error)
	RevokeEditorInvite(ctx context.Context, slug, ownerUserID, inviteID string) error
	AcceptEditorInvite(ctx context.Context, tokenHash []byte, userID string) (string, error)
	RemoveMember(ctx context.Context, slug, actorUserID, targetUserID string) error
	Leave(ctx context.Context, slug, userID string) error
	OfferOwnership(ctx context.Context, slug, ownerUserID, recipientUserID string) error
	CancelOwnershipOffer(ctx context.Context, slug, userID string) error
	AcceptOwnership(ctx context.Context, slug, userID string) error
}

type clubUserRequest struct {
	UserID string `json:"user_id"`
}

// registerClubOfficerRoutes adds the routes that change a club's profile and
// people. Each needs a signed-in user.
func (r *Router) registerClubOfficerRoutes() {
	r.mux.HandleFunc("/me/clubs", requireMethod(http.MethodGet, r.handleMyClubs))
	r.mux.HandleFunc("/clubs/{slug}/manage", requireMethod(http.MethodGet, r.handleManageClub))
	r.mux.HandleFunc("/clubs/{slug}/profile", requireMethod(http.MethodPost, r.handleEditClubProfile))
	r.mux.HandleFunc("/clubs/{slug}/links", requireMethod(http.MethodPost, r.handleEditClubLinks))
	r.mux.HandleFunc("/clubs/{slug}/confirm", requireMethod(http.MethodPost, r.handleConfirmClub))
	r.mux.HandleFunc("/clubs/{slug}/editor-invites", requireMethod(http.MethodPost, r.handleInviteClubEditor))
	r.mux.HandleFunc("/clubs/{slug}/editor-invites/{id}", requireMethod(http.MethodDelete, r.handleRevokeClubEditorInvite))
	r.mux.HandleFunc("/club-editor-invites/accept", requireMethod(http.MethodPost, r.handleAcceptClubEditorInvite))
	r.mux.HandleFunc("/clubs/{slug}/remove-member", requireMethod(http.MethodPost, r.handleRemoveClubMember))
	r.mux.HandleFunc("/clubs/{slug}/join", requireMethod(http.MethodPost, r.handleJoinClub))
	r.mux.HandleFunc("/clubs/{slug}/leave", requireMethod(http.MethodPost, r.handleLeaveClub))
	r.mux.HandleFunc("/clubs/{slug}/members", r.handleClubMembers)
	r.mux.HandleFunc("/clubs/{slug}/ownership-offer", r.handleClubOwnershipOffer)
	r.mux.HandleFunc("/clubs/{slug}/ownership-offer/accept", requireMethod(http.MethodPost, r.handleAcceptClubOwnership))
}

// clubOfficer starts a request: the store is wired and someone is signed in.
func (r *Router) clubOfficer(w http.ResponseWriter, req *http.Request) (string, bool) {
	if r.clubOfficers == nil {
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

// handleMyClubs answers GET /me/clubs with the signed-in user's clubs and
// their role in each.
func (r *Router) handleMyClubs(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	result, err := r.clubOfficers.ListForUser(req.Context(), userID)
	if err != nil {
		writeApplicationError(w, err, "clubs_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"clubs": result})
}

// handleManageClub answers GET /clubs/{slug}/manage for an owner or editor.
func (r *Router) handleManageClub(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	management, err := r.clubOfficers.Manage(req.Context(), req.PathValue("slug"), userID)
	if err != nil {
		writeApplicationError(w, err, "club_manage_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, management)
}

func (r *Router) handleEditClubProfile(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	var edit clubs.ProfileEdit
	if !decodeJSON(w, req, &edit) {
		return
	}
	if err := r.clubOfficers.EditProfile(req.Context(), req.PathValue("slug"), userID, edit); err != nil {
		writeApplicationError(w, err, "club_edit_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r *Router) handleEditClubLinks(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	var request struct {
		Links []clubs.Link `json:"links"`
	}
	if !decodeJSON(w, req, &request) {
		return
	}
	if err := r.clubOfficers.EditLinks(req.Context(), req.PathValue("slug"), userID, request.Links); err != nil {
		writeApplicationError(w, err, "club_edit_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleConfirmClub answers POST /clubs/{slug}/confirm, an owner or editor
// confirming the club's details are current.
func (r *Router) handleConfirmClub(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	if err := r.clubOfficers.Confirm(req.Context(), req.PathValue("slug"), userID); err != nil {
		writeApplicationError(w, err, "club_confirm_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleInviteClubEditor answers POST /clubs/{slug}/editor-invites. The
// answer is the same whether or not the address has an account.
func (r *Router) handleInviteClubEditor(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	if !r.allowAccount("club-editor-invite", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var request organizerInviteRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	email := users.NormalizeEmail(request.Email)
	if _, err := mail.ParseAddress(email); err != nil || len(email) > 254 {
		writeError(w, http.StatusBadRequest, "invalid_email")
		return
	}
	token, tokenHash, err := auth.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "editor_invite_failed")
		return
	}
	invite, err := r.clubOfficers.InviteEditor(req.Context(), clubs.EditorInviteParams{
		Slug: req.PathValue("slug"), OwnerUserID: userID, Email: email,
		RawToken: token, TokenHash: tokenHash, ExpiresAt: time.Now().Add(clubEditorInviteTTL),
	})
	if err != nil {
		writeApplicationError(w, err, "editor_invite_failed")
		return
	}
	writeJSON(w, http.StatusCreated, invite)
}

func (r *Router) handleRevokeClubEditorInvite(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	inviteID := req.PathValue("id")
	if !looksLikeUUID(inviteID) {
		writeError(w, http.StatusNotFound, "editor_invite_not_found")
		return
	}
	if err := r.clubOfficers.RevokeEditorInvite(req.Context(), req.PathValue("slug"), userID, inviteID); err != nil {
		writeApplicationError(w, err, "editor_invite_revoke_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAcceptClubEditorInvite answers POST /club-editor-invites/accept with
// the slug of the club the signed-in user now edits.
func (r *Router) handleAcceptClubEditorInvite(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	if !r.allowAccount("club-editor-invite-accept", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var request acceptOrganizerInviteRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if request.Token == "" {
		writeError(w, http.StatusNotFound, "editor_invite_not_found")
		return
	}
	slug, err := r.clubOfficers.AcceptEditorInvite(req.Context(), auth.HashToken(request.Token), userID)
	if err != nil {
		writeApplicationError(w, err, "editor_invite_accept_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"club_slug": slug})
}

func (r *Router) handleRemoveClubMember(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	var request clubUserRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if !looksLikeUUID(request.UserID) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	if err := r.clubOfficers.RemoveMember(req.Context(), req.PathValue("slug"), userID, request.UserID); err != nil {
		writeApplicationError(w, err, "club_member_remove_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleJoinClub answers POST /clubs/{slug}/join: a signed-in user with a
// verified email lists themselves on the club. It grants nothing in the club
// itself.
func (r *Router) handleJoinClub(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	if !r.allowAccount("club-join", userID) {
		rateLimitExceeded(w, r)
		return
	}
	if err := r.clubOfficers.Join(req.Context(), req.PathValue("slug"), userID); err != nil {
		writeApplicationError(w, err, "club_join_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r *Router) handleLeaveClub(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	if err := r.clubOfficers.Leave(req.Context(), req.PathValue("slug"), userID); err != nil {
		writeApplicationError(w, err, "club_leave_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleClubOwnershipOffer answers POST /clubs/{slug}/ownership-offer, an
// owner's offer to a member, and DELETE, which an owner uses to withdraw the
// offer and its recipient to decline it.
func (r *Router) handleClubOwnershipOffer(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost && req.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodPost+", "+http.MethodDelete)
		return
	}
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	slug := req.PathValue("slug")
	if req.Method == http.MethodDelete {
		if err := r.clubOfficers.CancelOwnershipOffer(req.Context(), slug, userID); err != nil {
			writeApplicationError(w, err, "ownership_offer_failed")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var request clubUserRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if !looksLikeUUID(request.UserID) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	if err := r.clubOfficers.OfferOwnership(req.Context(), slug, userID, request.UserID); err != nil {
		writeApplicationError(w, err, "ownership_offer_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r *Router) handleAcceptClubOwnership(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.clubOfficer(w, req)
	if !ok {
		return
	}
	if err := r.clubOfficers.AcceptOwnership(req.Context(), req.PathValue("slug"), userID); err != nil {
		writeApplicationError(w, err, "ownership_accept_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
