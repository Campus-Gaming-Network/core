package errormonitor

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
)

// startIngest points reporting at a local stand-in for Sentry and returns a
// function that yields the envelope bodies received. Flush can return before
// the transport has delivered an envelope (#140), so the function waits for
// the count the caller expects instead of reading whatever has arrived, and
// fails the test if they do not arrive. With want zero it flushes and yields
// anything that arrived, which must be nothing.
func startIngest(t *testing.T) func(want int) []string {
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

	return func(want int) []string {
		Flush()
		received := make([]string, 0, want)
		// The limit only bounds a failing run; a passing one never waits for it.
		missing := time.After(10 * time.Second)
		for len(received) < want {
			select {
			case body := <-bodies:
				received = append(received, body)
			case <-missing:
				t.Fatalf("envelopes = %d, want %d", len(received), want)
			}
		}
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

	envelopes := received(1)
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

	if envelopes := received(0); len(envelopes) != 0 {
		t.Fatalf("envelopes = %v, want none", envelopes)
	}
}

func TestCaptureErrorReportsErrorCode(t *testing.T) {
	received := startIngest(t)

	CaptureError(errors.New("query failed"), "events_unavailable")

	envelopes := received(1)
	if len(envelopes) != 1 {
		t.Fatalf("envelopes = %d, want 1", len(envelopes))
	}
	for _, want := range []string{`"query failed"`, `"error.code":"events_unavailable"`} {
		if !strings.Contains(envelopes[0], want) {
			t.Errorf("envelope lacks %s: %s", want, envelopes[0])
		}
	}
}
