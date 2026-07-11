package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
)

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
	case isValidationError(err):
		writeError(w, http.StatusBadRequest, "invalid_request")
	default:
		writeError(w, http.StatusInternalServerError, fallbackCode)
	}
}
