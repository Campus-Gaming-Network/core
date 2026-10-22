package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWithBodyLimit(t *testing.T) {
	const limit = 8
	reads := func(w http.ResponseWriter, req *http.Request) {
		if _, err := io.ReadAll(req.Body); err != nil {
			writeDecodeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
	handler := withBodyLimit(limit, http.HandlerFunc(reads))

	tests := []struct {
		name          string
		body          string
		contentLength int64
		want          int
	}{
		{"within limit", "12345678", 8, http.StatusNoContent},
		{"declared too large", "123456789", 9, http.StatusRequestEntityTooLarge},
		{"undeclared length too large", "123456789", -1, http.StatusRequestEntityTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(tt.body))
			req.ContentLength = tt.contentLength
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, req)

			if response.Code != tt.want {
				t.Fatalf("status = %d, want %d", response.Code, tt.want)
			}
			if tt.want == http.StatusRequestEntityTooLarge {
				if got, want := strings.TrimSpace(response.Body.String()), `{"error":"request_too_large"}`; got != want {
					t.Fatalf("body = %s, want %s", got, want)
				}
			}
		})
	}
}
