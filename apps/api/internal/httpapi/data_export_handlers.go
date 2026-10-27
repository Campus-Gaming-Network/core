package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/dataexport"
)

type dataExports interface {
	Export(ctx context.Context, userID string) (dataexport.Export, error)
}

type dataExportRequest struct {
	CurrentPassword string `json:"current_password"`
}

// handleDataExport answers POST /me/export: everything held about the
// signed-in account, once its holder confirms their password. Each download
// is recorded in the audit history.
func (r *Router) handleDataExport(w http.ResponseWriter, req *http.Request) {
	if r.account == nil || r.dataExports == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allowAccount("data-export", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var input dataExportRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if err := r.account.VerifyCurrentPassword(req.Context(), userID, input.CurrentPassword); err != nil {
		writeApplicationError(w, err, "data_export_failed")
		return
	}
	export, err := r.dataExports.Export(req.Context(), userID)
	if errors.Is(err, dataexport.ErrAccountNotFound) {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if err != nil {
		writeApplicationError(w, err, "data_export_failed")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, export)
}
