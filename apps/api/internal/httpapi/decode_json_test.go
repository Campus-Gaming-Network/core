package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONStatuses(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantBody   string
	}{
		{"oversized body", `{"name":"` + strings.Repeat("a", 1<<20) + `"}`, http.StatusRequestEntityTooLarge, `{"error":"request_too_large"}`},
		{"malformed body", `{"name":`, http.StatusBadRequest, `{"error":"invalid_json"}`},
		{"unknown field", `{"other":1}`, http.StatusBadRequest, `{"error":"invalid_json"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(tt.body))
			var destination struct {
				Name string `json:"name"`
			}

			if decodeJSON(response, request, &destination) {
				t.Fatal("decodeJSON() = true, want false")
			}
			if response.Code != tt.wantStatus || strings.TrimSpace(response.Body.String()) != tt.wantBody {
				t.Fatalf("response = %d %s, want %d %s", response.Code, response.Body.String(), tt.wantStatus, tt.wantBody)
			}
		})
	}
}
