package adminhttp

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
)

// SystemProbe reports whether one external dependency answers.
type SystemProbe interface {
	Check(context.Context) error
}

// OutboxReader reports how much email is waiting to be delivered.
type OutboxReader interface {
	Backlog(context.Context) (emailoutbox.Backlog, error)
}

// SystemDependencies holds what the system page reports on. A nil probe is a
// dependency this deployment has not configured.
type SystemDependencies struct {
	ObjectStorage SystemProbe
	IGDB          SystemProbe
	Outbox        OutboxReader
}

const systemProbeTimeout = 3 * time.Second

const (
	systemCheckOK            = "ok"
	systemCheckUnreachable   = "unreachable"
	systemCheckNotConfigured = "not_configured"
)

type systemCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// getSystem answers with each dependency's state and the email backlog. A
// failed probe is a result, not an error: its cause goes to the log and never
// to the response.
func (handler *Handler) getSystem(w http.ResponseWriter, req *http.Request) {
	deps := handler.dependencies.System
	if deps == nil || deps.Outbox == nil {
		writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
		return
	}
	probes := []struct {
		name  string
		probe SystemProbe
	}{
		{"object_storage", deps.ObjectStorage},
		{"igdb", deps.IGDB},
	}
	checks := make([]systemCheck, len(probes))
	var wait sync.WaitGroup
	for index, entry := range probes {
		checks[index] = systemCheck{Name: entry.name, Status: systemCheckNotConfigured}
		if entry.probe == nil {
			continue
		}
		wait.Go(func() {
			ctx, cancel := context.WithTimeout(req.Context(), systemProbeTimeout)
			defer cancel()
			if err := entry.probe.Check(ctx); err != nil {
				checks[index].Status = systemCheckUnreachable
				slog.WarnContext(req.Context(), "admin system check failed", "check", entry.name, "error", err)
				return
			}
			checks[index].Status = systemCheckOK
		})
	}
	wait.Wait()

	backlog, err := deps.Outbox.Backlog(req.Context())
	if err != nil {
		writeAdminApplicationError(w, req, err, "admin_query_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"checks": checks, "email_outbox": backlog})
}
