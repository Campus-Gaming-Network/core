package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/sitemap"
)

type fakeSitemapRepository struct {
	entries sitemap.Entries
}

func (r fakeSitemapRepository) Entries(context.Context) (sitemap.Entries, error) {
	return r.entries, nil
}

func TestHandleSitemapReturnsOnlySlugsAndTimes(t *testing.T) {
	updatedAt := time.Date(2031, time.May, 1, 12, 0, 0, 0, time.UTC)
	router := &Router{sitemap: fakeSitemapRepository{entries: sitemap.Entries{
		Events:  []sitemap.Entry{{Slug: "open-night", UpdatedAt: updatedAt}},
		Schools: []sitemap.Entry{{Slug: "example-university", UpdatedAt: updatedAt}},
		Teams:   []sitemap.Entry{},
	}}}
	response := httptest.NewRecorder()

	router.handleSitemap(response, httptest.NewRequest(http.MethodGet, "/sitemap", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != catalogCacheControl {
		t.Errorf("Cache-Control = %q, want %q", got, catalogCacheControl)
	}
	var got map[string][]map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	want := map[string][]map[string]string{
		"events":  {{"slug": "open-night", "updated_at": "2031-05-01T12:00:00Z"}},
		"schools": {{"slug": "example-university", "updated_at": "2031-05-01T12:00:00Z"}},
		"teams":   {},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("body = %v, want %v", got, want)
	}
}
