package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/jackc/pgx/v5"
)

const privateEventUnlockTTL = 24 * time.Hour

type createEventRequest struct {
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	HostSchoolID    string    `json:"host_school_id"`
	GameIDs         []string  `json:"game_ids"`
	Visibility      string    `json:"visibility"`
	Format          string    `json:"format"`
	StartsAt        time.Time `json:"starts_at"`
	EndsAt          time.Time `json:"ends_at"`
	Timezone        string    `json:"timezone"`
	LocationName    string    `json:"location_name"`
	Address         string    `json:"address"`
	OnlineURL       string    `json:"online_url"`
	PrivatePassword string    `json:"private_password"`
	Capacity        *int      `json:"capacity"`
	IsPaid          bool      `json:"is_paid"`
	PaymentNote     string    `json:"payment_note"`
	PaymentURL      string    `json:"payment_url"`
}

type unlockPrivateEventRequest struct {
	Password string `json:"password"`
}

type unlockPrivateEventResponse struct {
	Event       eventstore.Event `json:"event"`
	UnlockToken string           `json:"unlock_token"`
	ExpiresAt   time.Time        `json:"expires_at"`
}

type rsvpEventRequest struct {
	Response string `json:"response"`
}

type myEventsResponse struct {
	UpcomingRSVPs        []eventstore.Event `json:"upcoming_rsvps"`
	FollowedSchoolEvents []eventstore.Event `json:"followed_school_events"`
}

func (r *Router) handleMyEvents(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}

	limit := 5
	if value := req.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
	}
	if limit < 1 || limit > 25 {
		limit = 5
	}

	upcomingRSVPs, err := r.events.ListUpcomingRSVPs(req.Context(), userID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "events_unavailable")
		return
	}
	followedSchoolEvents, err := r.events.ListFollowedSchoolEvents(req.Context(), userID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "events_unavailable")
		return
	}

	writeJSON(w, http.StatusOK, myEventsResponse{
		UpcomingRSVPs:        upcomingRSVPs,
		FollowedSchoolEvents: followedSchoolEvents,
	})
}

func (r *Router) handleCreateEvent(w http.ResponseWriter, req *http.Request) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allow("event-create:"+userID, req) {
		rateLimitExceeded(w, r)
		return
	}

	var request createEventRequest
	if !decodeJSON(w, req, &request) {
		return
	}

	input := createEventInputFromRequest(request, userID)
	if err := eventstore.ValidateCreateInput(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}

	var privatePasswordHash string
	if input.Visibility == eventstore.VisibilityPrivate {
		privatePasswordHash, err = auth.HashPassword(input.PrivatePassword)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "event_create_failed")
			return
		}
	}

	event, err := r.events.Create(req.Context(), eventstore.CreateParams{
		CreateInput:         input,
		PrivatePasswordHash: privatePasswordHash,
	})
	if err != nil {
		writeEventMutationError(w, err, "event_create_failed")
		return
	}
	writeJSON(w, http.StatusCreated, event)
}

func (r *Router) handleUpdateEvent(w http.ResponseWriter, req *http.Request, slug string) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}

	var request createEventRequest
	if !decodeJSON(w, req, &request) {
		return
	}

	input := updateEventInputFromRequest(request, slug, userID)
	if err := eventstore.ValidateUpdateInput(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}

	var privatePasswordHash string
	if input.Visibility == eventstore.VisibilityPrivate && input.PrivatePassword != "" {
		privatePasswordHash, err = auth.HashPassword(input.PrivatePassword)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "event_update_failed")
			return
		}
	}

	event, err := r.events.Update(req.Context(), eventstore.UpdateParams{
		UpdateInput:         input,
		PrivatePasswordHash: privatePasswordHash,
	})
	if err != nil {
		writeEventMutationError(w, err, "event_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, event)
}

func (r *Router) handleDeleteEvent(w http.ResponseWriter, req *http.Request, slug string) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if err := r.events.Delete(req.Context(), slug, userID); err != nil {
		writeEventMutationError(w, err, "event_delete_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r *Router) handleUnlockEvent(w http.ResponseWriter, req *http.Request, slug string) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.allow("event-unlock:"+slug, req) {
		rateLimitExceeded(w, r)
		return
	}

	var request unlockPrivateEventRequest
	if !decodeJSON(w, req, &request) {
		return
	}

	passwordHash, err := r.events.PrivatePasswordHash(req.Context(), slug)
	if errors.Is(err, eventstore.ErrEventNotFound) {
		writeError(w, http.StatusNotFound, "event_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unlock_failed")
		return
	}
	if !auth.ComparePassword(passwordHash, strings.TrimSpace(request.Password)) {
		writeError(w, http.StatusUnauthorized, "invalid_private_password")
		return
	}

	token, tokenHash, err := auth.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unlock_failed")
		return
	}
	expiresAt := time.Now().Add(privateEventUnlockTTL)
	if err := r.events.CreatePrivateUnlock(req.Context(), slug, tokenHash, expiresAt); err != nil {
		writeEventMutationError(w, err, "event_unlock_failed")
		return
	}
	event, err := r.events.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "event_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unlock_failed")
		return
	}

	writeJSON(w, http.StatusOK, unlockPrivateEventResponse{
		Event:       event,
		UnlockToken: token,
		ExpiresAt:   expiresAt,
	})
}

func (r *Router) handleRSVPEvent(w http.ResponseWriter, req *http.Request, slug string) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}

	var request rsvpEventRequest
	if !decodeJSON(w, req, &request) {
		return
	}
	event, err := r.events.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) {
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
			writeError(w, http.StatusForbidden, "private_event_locked")
			return
		}
	}

	event, err = r.events.SetRSVP(req.Context(), eventstore.RSVPInput{
		Slug:     slug,
		UserID:   userID,
		Response: request.Response,
	})
	if err != nil {
		writeEventMutationError(w, err, "event_rsvp_failed")
		return
	}
	if event.ViewerRSVP != nil && *event.ViewerRSVP == eventstore.RSVPYes {
		if err := r.sendRSVPConfirmation(req, userID, event); err != nil {
			writeError(w, http.StatusInternalServerError, "event_rsvp_email_failed")
			return
		}
	}
	writeJSON(w, http.StatusOK, event)
}

func (r *Router) handleEventInterest(w http.ResponseWriter, req *http.Request, slug string) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	event, err := r.events.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) {
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
			writeError(w, http.StatusForbidden, "private_event_locked")
			return
		}
	}

	event, err = r.events.SetInterest(req.Context(), slug, userID, req.Method == http.MethodPost)
	if err != nil {
		writeEventMutationError(w, err, "event_interest_failed")
		return
	}
	writeJSON(w, http.StatusOK, event)
}

func (r *Router) sendRSVPConfirmation(req *http.Request, userID string, event eventstore.Event) error {
	if r.eventMailer == nil || r.users == nil {
		return nil
	}
	profile, err := r.users.FindByID(req.Context(), userID)
	if err != nil {
		return err
	}
	return r.eventMailer.SendRSVPConfirmation(req.Context(), profile.Email, event)
}

func createEventInputFromRequest(request createEventRequest, userID string) eventstore.CreateInput {
	return eventstore.CreateInput{
		Title:           request.Title,
		Description:     request.Description,
		CreatorUserID:   userID,
		HostSchoolID:    request.HostSchoolID,
		GameIDs:         request.GameIDs,
		Visibility:      request.Visibility,
		Format:          request.Format,
		StartsAt:        request.StartsAt,
		EndsAt:          request.EndsAt,
		Timezone:        request.Timezone,
		LocationName:    request.LocationName,
		Address:         request.Address,
		OnlineURL:       request.OnlineURL,
		PrivatePassword: request.PrivatePassword,
		Capacity:        request.Capacity,
		IsPaid:          request.IsPaid,
		PaymentNote:     request.PaymentNote,
		PaymentURL:      request.PaymentURL,
	}
}

func updateEventInputFromRequest(request createEventRequest, slug string, userID string) eventstore.UpdateInput {
	return eventstore.UpdateInput{
		Slug:            slug,
		EditorUserID:    userID,
		Title:           request.Title,
		Description:     request.Description,
		HostSchoolID:    request.HostSchoolID,
		GameIDs:         request.GameIDs,
		Visibility:      request.Visibility,
		Format:          request.Format,
		StartsAt:        request.StartsAt,
		EndsAt:          request.EndsAt,
		Timezone:        request.Timezone,
		LocationName:    request.LocationName,
		Address:         request.Address,
		OnlineURL:       request.OnlineURL,
		PrivatePassword: request.PrivatePassword,
		Capacity:        request.Capacity,
		IsPaid:          request.IsPaid,
		PaymentNote:     request.PaymentNote,
		PaymentURL:      request.PaymentURL,
	}
}

func writeEventMutationError(w http.ResponseWriter, err error, fallbackCode string) {
	switch {
	case errors.Is(err, eventstore.ErrEventNotFound):
		writeError(w, http.StatusNotFound, "event_not_found")
	case errors.Is(err, eventstore.ErrOrganizerRequired):
		writeError(w, http.StatusForbidden, "not_event_organizer")
	case errors.Is(err, eventstore.ErrHostSchoolNotFound):
		writeError(w, http.StatusUnprocessableEntity, "host_school_not_found")
	case errors.Is(err, eventstore.ErrGameNotFound):
		writeError(w, http.StatusUnprocessableEntity, "game_not_found")
	case errors.Is(err, eventstore.ErrSlugUnavailable):
		writeError(w, http.StatusConflict, "event_slug_unavailable")
	case errors.Is(err, eventstore.ErrEventFull):
		writeError(w, http.StatusConflict, "event_full")
	case errors.Is(err, eventstore.ErrRSVPClosed):
		writeError(w, http.StatusConflict, "event_rsvp_closed")
	case isValidationError(err):
		writeError(w, http.StatusBadRequest, "invalid_request")
	default:
		writeError(w, http.StatusInternalServerError, fallbackCode)
	}
}
