package adminhttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
)

type fakeSystemProbe struct{ err error }

func (probe fakeSystemProbe) Check(context.Context) error { return probe.err }

type fakeOutboxReader struct {
	backlog emailoutbox.Backlog
	err     error
}

func (reader fakeOutboxReader) Backlog(context.Context) (emailoutbox.Backlog, error) {
	return reader.backlog, reader.err
}

func TestSystemReportsEachDependencyAndTheEmailBacklog(t *testing.T) {
	oldest := time.Date(2026, time.September, 20, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		system SystemDependencies
		status int
		body   string
	}{
		{
			name: "a failed probe is reported without its cause",
			system: SystemDependencies{
				ObjectStorage: fakeSystemProbe{err: errors.New("dial tcp 10.0.0.5:9000: connection refused")},
				Outbox:        fakeOutboxReader{backlog: emailoutbox.Backlog{Pending: 3, Retrying: 1, Failed: 2, OldestPendingAt: &oldest}},
			},
			status: http.StatusOK,
			body:   `{"checks":[{"name":"object_storage","status":"unreachable"},{"name":"igdb","status":"not_configured"}],"email_outbox":{"pending":3,"retrying":1,"failed":2,"oldest_pending_at":"2026-09-20T12:00:00Z"}}`,
		},
		{
			name: "answering dependencies and an empty outbox",
			system: SystemDependencies{
				ObjectStorage: fakeSystemProbe{}, IGDB: fakeSystemProbe{}, Outbox: fakeOutboxReader{},
			},
			status: http.StatusOK,
			body:   `{"checks":[{"name":"object_storage","status":"ok"},{"name":"igdb","status":"ok"}],"email_outbox":{"pending":0,"retrying":0,"failed":0,"oldest_pending_at":null}}`,
		},
		{
			name:   "an unreadable outbox fails the request",
			system: SystemDependencies{Outbox: fakeOutboxReader{err: errors.New("database unavailable")}},
			status: http.StatusInternalServerError,
			body:   `{"error":"admin_query_failed"}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, _ := testHandler(true)
			handler.dependencies.System = &test.system
			req := trustedRequest(http.MethodGet, "/admin/v1/system")
			req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)

			if body := strings.TrimSpace(response.Body.String()); response.Code != test.status || body != test.body {
				t.Fatalf("status = %d body = %s, want %d %s", response.Code, body, test.status, test.body)
			}
			assertPrivateHeaders(t, response.Header())
		})
	}
}
