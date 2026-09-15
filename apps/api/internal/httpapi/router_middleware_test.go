package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// net/http recovers handler panics on its own, but it closes the connection
// without a response and logs outside slog. The BFF then sees a transport
// failure rather than an API error.
func TestRouterRecoversPanicAsJSONError(t *testing.T) {
	panicking := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	handler := withPanicRecovery(panicking)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/events", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(response.Body.String(), "internal_error") {
		t.Fatalf("body = %s, want internal_error", response.Body.String())
	}
}

func TestRouterPassesThroughSuccessfulHandlers(t *testing.T) {
	handler := withPanicRecovery(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusTeapot, map[string]string{"status": "fine"})
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/events", nil))

	if response.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusTeapot)
	}
}
