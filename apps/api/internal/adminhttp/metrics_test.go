package adminhttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/metrics"
)

type fakeMetricsReader struct {
	result metrics.Metrics
	err    error
	asOf   []time.Time
}

func (reader *fakeMetricsReader) Metrics(_ context.Context, asOf time.Time) (metrics.Metrics, error) {
	reader.asOf = append(reader.asOf, asOf)
	return reader.result, reader.err
}

func TestMetricsAnswersWithTheSummaryAsOfNow(t *testing.T) {
	now := time.Date(2026, time.October, 20, 18, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		reader *fakeMetricsReader
		status int
		body   string
	}{
		{
			name: "the summary",
			reader: &fakeMetricsReader{result: metrics.Metrics{
				AsOf:    "2026-10-20",
				Active:  metrics.ActiveCounts{Day: 2, Week: 5, Month: 9},
				Days:    []metrics.DayCounts{{Day: "2026-10-20", Active: 2, Signups: 1, ClubJoins: 3, RSVPs: 4, EventsCreated: 5, TeamsCreated: 6}},
				Schools: []metrics.SchoolCount{{ID: "11111111-1111-1111-1111-111111111111", Name: "Home U", Active: 9}},
			}},
			status: http.StatusOK,
			body:   `{"as_of":"2026-10-20","active":{"day":2,"week":5,"month":9},"days":[{"day":"2026-10-20","active":2,"signups":1,"club_joins":3,"rsvps":4,"events_created":5,"teams_created":6}],"schools":[{"id":"11111111-1111-1111-1111-111111111111","name":"Home U","active":9}]}`,
		},
		{
			name:   "an unreadable summary fails the request",
			reader: &fakeMetricsReader{err: errors.New("database unavailable")},
			status: http.StatusInternalServerError,
			body:   `{"error":"admin_query_failed"}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, _ := testHandler(true)
			handler.now = func() time.Time { return now }
			handler.dependencies.Metrics = test.reader
			req := trustedRequest(http.MethodGet, "/admin/v1/metrics")
			req.AddCookie(&http.Cookie{Name: "admin_session", Value: "current"})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)

			if body := strings.TrimSpace(response.Body.String()); response.Code != test.status || body != test.body {
				t.Fatalf("status = %d body = %s, want %d %s", response.Code, body, test.status, test.body)
			}
			if len(test.reader.asOf) != 1 || !test.reader.asOf[0].Equal(now) {
				t.Fatalf("as of = %v, want [%v]", test.reader.asOf, now)
			}
			assertPrivateHeaders(t, response.Header())
		})
	}
}
