package adminhttp

import (
	"context"
	"net/http"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/metrics"
)

// MetricsReader summarizes active accounts and signups as of a UTC day.
type MetricsReader interface {
	Metrics(ctx context.Context, asOf time.Time) (metrics.Metrics, error)
}

// getMetrics answers with active-account and signup counts as of today in
// UTC.
func (handler *Handler) getMetrics(w http.ResponseWriter, req *http.Request) {
	if handler.dependencies.Metrics == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	result, err := handler.dependencies.Metrics.Metrics(req.Context(), handler.now())
	if err != nil {
		writeAdminApplicationError(w, req, err, "admin_query_failed")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
