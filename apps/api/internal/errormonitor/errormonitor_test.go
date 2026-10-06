package errormonitor

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
)

// startIngest points reporting at a local stand-in for Sentry and returns a
// function that flushes and yields every envelope body received so far.
func startIngest(t *testing.T) func() []string {
	t.Helper()
	bodies := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Errorf("read envelope: %v", err)
		}
		bodies <- string(body)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { sentry.CurrentHub().BindClient(nil) })

	err := Init(Options{
		DSN:         strings.Replace(server.URL, "http://", "http://public@", 1) + "/1",
		Environment: "staging",
		Release:     "test-release",
	})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}

	return func() []string {
		Flush()
		received := make([]string, 0, len(bodies))
		for len(bodies) > 0 {
			received = append(received, <-bodies)
		}
		return received
	}
}

func TestCapturePanicReportsWithoutRequestData(t *testing.T) {
	received := startIngest(t)
	req := httptest.NewRequest(http.MethodPost, "/events/spring-lan?invite=query-secret", strings.NewReader("body-secret"))
	req.Header.Set("Authorization", "Bearer header-secret")
	req.AddCookie(&http.Cookie{Name: "cgn_session", Value: "cookie-secret"})

	CapturePanic(req, "boom")

	envelopes := received()
	if len(envelopes) != 1 {
		t.Fatalf("envelopes = %d, want 1", len(envelopes))
	}
	for _, want := range []string{
		`"boom"`,
		`"environment":"staging"`,
		`"release":"test-release"`,
		`"http.method":"POST"`,
		`"http.path":"/events/spring-lan"`,
	} {
		if !strings.Contains(envelopes[0], want) {
			t.Errorf("envelope lacks %s: %s", want, envelopes[0])
		}
	}
	for _, secret := range []string{"query-secret", "body-secret", "header-secret", "cookie-secret"} {
		if strings.Contains(envelopes[0], secret) {
			t.Errorf("envelope contains %s: %s", secret, envelopes[0])
		}
	}
}

func TestCapturePanicSkipsAdminAPI(t *testing.T) {
	received := startIngest(t)

	CapturePanic(httptest.NewRequest(http.MethodPost, "/admin/schools", nil), "boom")

	if envelopes := received(); len(envelopes) != 0 {
		t.Fatalf("envelopes = %v, want none", envelopes)
	}
}

func TestCaptureErrorReportsErrorCode(t *testing.T) {
	received := startIngest(t)

	CaptureError(errors.New("query failed"), "events_unavailable")

	envelopes := received()
	if len(envelopes) != 1 {
		t.Fatalf("envelopes = %d, want 1", len(envelopes))
	}
	for _, want := range []string{`"query failed"`, `"error.code":"events_unavailable"`} {
		if !strings.Contains(envelopes[0], want) {
			t.Errorf("envelope lacks %s: %s", want, envelopes[0])
		}
	}
}
