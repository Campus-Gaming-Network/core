package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminhttp"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
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

// captureLogs runs fn with a JSON slog default and returns the decoded records.
func captureLogs(t *testing.T, fn func()) []map[string]any {
	t.Helper()
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	defer slog.SetDefault(previous)
	fn()

	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line is not one JSON record: %q: %v", line, err)
		}
		records = append(records, record)
	}
	return records
}

func TestAccessLogRecordsTemplateStatusAndNoRequestSecrets(t *testing.T) {
	admin := adminhttp.NewHandler(adminhttp.Config{
		Enabled: true, SiteOrigin: "https://admin.example.test", ProxySecret: "proxy-secret",
	}, adminhttp.Dependencies{})
	handler := withRequestLogging(admin)

	records := captureLogs(t, func() {
		for _, path := range []string{
			"/admin/v1/reports/00000000-0000-4000-8000-000000000101",
			"/admin/v1/not-registered",
		} {
			req := httptest.NewRequest(http.MethodGet, path+"?q=secret-query", nil)
			req.Header.Set(adminhttp.ProxySecretHeader, "proxy-secret")
			req.Header.Set("Authorization", "Bearer secret-authorization")
			req.AddCookie(&http.Cookie{Name: "admin_session", Value: "secret-cookie"})
			handler.ServeHTTP(httptest.NewRecorder(), req)
		}
	})

	if len(records) != 2 {
		t.Fatalf("records = %d, want one per request", len(records))
	}
	want := []struct {
		path   string
		status float64
	}{
		{"/admin/v1/reports/{id}", http.StatusUnauthorized},
		{"/admin/v1/{unmatched}", http.StatusNotFound},
	}
	for index, record := range records {
		if record["msg"] != "request" || record["path"] != want[index].path ||
			record["status"] != want[index].status || record["method"] != http.MethodGet ||
			record["request_id"] == "" || record["duration_ms"] == nil {
			t.Fatalf("record %d = %#v", index, record)
		}
		if _, ok := record["actor_id"]; ok {
			t.Fatalf("record %d names an actor for an unauthenticated request: %#v", index, record)
		}
		encoded, _ := json.Marshal(record)
		for _, secret := range []string{"secret-query", "secret-authorization", "secret-cookie", "00000000-0000-4000-8000-000000000101"} {
			if strings.Contains(string(encoded), secret) {
				t.Fatalf("record %d leaks %q: %s", index, secret, encoded)
			}
		}
	}
}

func TestAccessLogKeepsHostileValuesToOneBoundedRecord(t *testing.T) {
	handler := withRequestLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	hostile := "/forged\",\"status\":200,\"level\":\"ERROR\nsecond-line\r" + strings.Repeat("x", 5000)

	records := captureLogs(t, func() {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.URL.Path = hostile
		handler.ServeHTTP(httptest.NewRecorder(), req)
	})

	if len(records) != 1 {
		t.Fatalf("records = %d, want exactly one", len(records))
	}
	record := records[0]
	path, _ := record["path"].(string)
	if record["status"] != float64(http.StatusNotFound) || record["level"] != "INFO" || len([]rune(path)) > maximumLoggedPathRunes {
		t.Fatalf("hostile request forged or overflowed the record: %#v", record)
	}
}

func TestAdminServerFailuresLogAtErrorLevelWithAStableClass(t *testing.T) {
	// Without its dependencies the exchange route answers 503 after the origin
	// check, which is how an unavailable control plane looks to the log.
	admin := adminhttp.NewHandler(adminhttp.Config{
		Enabled: true, SiteOrigin: "https://admin.example.test", ProxySecret: "proxy-secret",
	}, adminhttp.Dependencies{})
	handler := withRequestLogging(admin)

	records := captureLogs(t, func() {
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/auth/exchange", nil)
		req.Header.Set(adminhttp.ProxySecretHeader, "proxy-secret")
		req.Header.Set("Origin", "https://admin.example.test")
		handler.ServeHTTP(httptest.NewRecorder(), req)
	})

	if len(records) != 1 {
		t.Fatalf("records = %#v", records)
	}
	record := records[0]
	if record["level"] != "ERROR" || record["msg"] != "admin request failed" ||
		record["path"] != "/admin/v1/auth/exchange" || record["status"] != float64(http.StatusServiceUnavailable) ||
		record["error_class"] != adminhttp.ErrorClassInternal {
		t.Fatalf("record = %#v", record)
	}
}

func TestErrorMonitoringTestEndpointRequiresMaintenanceToken(t *testing.T) {
	tests := []struct {
		name          string
		configured    string
		authorization string
		wantStatus    int
		wantBody      string
	}{
		{name: "disabled without a configured token", authorization: "Bearer ", wantStatus: http.StatusNotFound, wantBody: "404 page not found\n"},
		{name: "wrong token", configured: "maintenance-token", authorization: "Bearer other", wantStatus: http.StatusUnauthorized, wantBody: "{\"error\":\"authentication_required\"}\n"},
		{name: "panics into the recovered 500", configured: "maintenance-token", authorization: "Bearer maintenance-token", wantStatus: http.StatusInternalServerError, wantBody: "{\"error\":\"internal_error\"}\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := NewRouter(config.Config{MaintenanceToken: test.configured})
			request := httptest.NewRequest(http.MethodPost, "/internal/error-monitoring/test", nil)
			request.Header.Set("Authorization", test.authorization)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != test.wantStatus || response.Body.String() != test.wantBody {
				t.Fatalf("response = %d %q, want %d %q", response.Code, response.Body.String(), test.wantStatus, test.wantBody)
			}
		})
	}
}
