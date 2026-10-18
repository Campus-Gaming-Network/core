package httpapi

import (
	"context"
	"net/http"
	"net/mail"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

// organizerInviteTTL is how long an invite link to co-organize stays usable.
const organizerInviteTTL = 7 * 24 * time.Hour

// eventOrganizers manages an event's co-organizers and the invites that add
// them.
type eventOrganizers interface {
	InviteOrganizer(ctx context.Context, params eventstore.OrganizerInviteParams) (eventstore.OrganizerInvite, error)
	ListOrganizerInvites(ctx context.Context, slug string, creatorUserID string) ([]eventstore.OrganizerInvite, error)
	RevokeOrganizerInvite(ctx context.Context, slug string, creatorUserID string, inviteID string) error
	AcceptOrganizerInvite(ctx context.Context, tokenHash []byte, userID string) (string, error)
	RemoveOrganizer(ctx context.Context, slug string, actorUserID string, organizerUserID string) error
	TransferCreator(ctx context.Context, slug string, creatorUserID string, organizerUserID string) error
}

type organizerInviteRequest struct {
	Email string `json:"email"`
}

type acceptOrganizerInviteRequest struct {
	Token string `json:"token"`
}

// organizerUser starts an organizer request: the store is wired and someone
// is signed in.
func (r *Router) organizerUser(w http.ResponseWriter, req *http.Request) (string, bool) {
	if r.organizers == nil {
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

// handleOrganizerInvites answers GET and POST /events/{slug}/organizer-invites:
// the creator's pending invites, or a new one. A new invite answers the same
// way whether or not its address has an account.
func (r *Router) handleOrganizerInvites(w http.ResponseWriter, req *http.Request, slug string) {
	userID, ok := r.organizerUser(w, req)
	if !ok {
		return
	}
	if req.Method == http.MethodGet {
		invites, err := r.organizers.ListOrganizerInvites(req.Context(), slug, userID)
		if err != nil {
			writeApplicationError(w, err, "organizer_invites_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
		return
	}
	if !r.allowAccount("organizer-invite", userID) {
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
		writeError(w, http.StatusInternalServerError, "organizer_invite_failed")
		return
	}
	invite, err := r.organizers.InviteOrganizer(req.Context(), eventstore.OrganizerInviteParams{
		Slug:          slug,
		CreatorUserID: userID,
		Email:         email,
		RawToken:      token,
		TokenHash:     tokenHash,
		ExpiresAt:     time.Now().Add(organizerInviteTTL),
	})
	if err != nil {
		writeApplicationError(w, err, "organizer_invite_failed")
		return
	}
	writeJSON(w, http.StatusCreated, invite)
}

// handleRevokeOrganizerInvite answers DELETE
// /events/{slug}/organizer-invites/{id}.
func (r *Router) handleRevokeOrganizerInvite(w http.ResponseWriter, req *http.Request, slug string, inviteID string) {
	userID, ok := r.organizerUser(w, req)
	if !ok {
		return
	}
	if !looksLikeUUID(inviteID) {
		writeError(w, http.StatusNotFound, "organizer_invite_not_found")
		return
	}
	if err := r.organizers.RevokeOrganizerInvite(req.Context(), slug, userID, inviteID); err != nil {
		writeApplicationError(w, err, "organizer_invite_revoke_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRemoveOrganizer answers DELETE /events/{slug}/organizers/{user_id}:
// the creator removing a co-organizer, or a co-organizer stepping down.
func (r *Router) handleRemoveOrganizer(w http.ResponseWriter, req *http.Request, slug string, organizerID string) {
	userID, ok := r.organizerUser(w, req)
	if !ok {
		return
	}
	if !looksLikeUUID(organizerID) {
		writeError(w, http.StatusNotFound, "organizer_not_found")
		return
	}
	if err := r.organizers.RemoveOrganizer(req.Context(), slug, userID, organizerID); err != nil {
		writeApplicationError(w, err, "organizer_remove_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleTransferEventCreator answers POST
// /events/{slug}/organizers/{user_id}/creator.
func (r *Router) handleTransferEventCreator(w http.ResponseWriter, req *http.Request, slug string, organizerID string) {
	userID, ok := r.organizerUser(w, req)
	if !ok {
		return
	}
	if !looksLikeUUID(organizerID) {
		writeError(w, http.StatusNotFound, "organizer_not_found")
		return
	}
	if err := r.organizers.TransferCreator(req.Context(), slug, userID, organizerID); err != nil {
		writeApplicationError(w, err, "creator_transfer_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAcceptOrganizerInvite answers POST /organizer-invites/accept with the
// slug of the event the signed-in account now organizes.
func (r *Router) handleAcceptOrganizerInvite(w http.ResponseWriter, req *http.Request) {
	userID, ok := r.organizerUser(w, req)
	if !ok {
		return
	}
	if !r.allowAccount("organizer-invite-accept", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var request acceptOrganizerInviteRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	if request.Token == "" {
		writeError(w, http.StatusNotFound, "organizer_invite_not_found")
		return
	}
	slug, err := r.organizers.AcceptOrganizerInvite(req.Context(), auth.HashToken(request.Token), userID)
	if err != nil {
		writeApplicationError(w, err, "organizer_invite_accept_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"event_slug": slug})
}
