package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
)

type fakeSchoolStats struct {
	calls [][]string
}

func (f *fakeSchoolStats) Stats(_ context.Context, slugs []string, _ time.Time) ([]schools.Stats, error) {
	f.calls = append(f.calls, slugs)
	return []schools.Stats{{Slug: "home-school", Members: 4, Teams: 1, UpcomingEvents: 2}}, nil
}

func TestSchoolStatsReadsTheRequestedSchoolsInOneCall(t *testing.T) {
	store := &fakeSchoolStats{}
	router := &Router{schoolStats: store}
	tooMany := "/school-stats?school=" + strings.Repeat("s&school=", schools.MaximumStatsSchools) + "s"

	type result struct {
		Status int
		Body   map[string]any
	}
	var got []result
	for _, target := range []string{"/school-stats?school=home-school&school=other-school", "/school-stats", tooMany} {
		response := httptest.NewRecorder()
		router.handleSchoolStats(response, httptest.NewRequest(http.MethodGet, target, nil))
		var body map[string]any
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode %s: %v", target, err)
		}
		got = append(got, result{response.Code, body})
	}

	want := []result{
		{http.StatusOK, map[string]any{"stats": []any{
			map[string]any{"slug": "home-school", "members": float64(4), "teams": float64(1), "upcoming_events": float64(2)},
		}}},
		{http.StatusOK, map[string]any{"stats": []any{}}},
		{http.StatusBadRequest, map[string]any{"error": "too_many_schools"}},
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(store.calls, [][]string{{"home-school", "other-school"}}) {
		t.Fatalf("results = %+v, calls = %v; want %+v and one call", got, store.calls, want)
	}
}
