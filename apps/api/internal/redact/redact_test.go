package redact

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
)

const (
	fakeEmail    = "pat.example@fake.invalid"
	fakeToken    = "tok-fake-0123456789"
	fakePassword = "pw-fake-hunter2"
)

func assertAbsent(t *testing.T, output string) {
	t.Helper()
	for _, secret := range []string{fakeEmail, fakeToken, fakePassword, "pat.example"} {
		if strings.Contains(output, secret) {
			t.Errorf("output contains %q: %s", secret, output)
		}
	}
}

func TestLoggerRedactsSensitiveKeysAndText(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger(&output)

	logger.Error("request failed",
		"password", fakePassword,
		"recipient", fakeEmail,
		slog.Group("auth", slog.String("access_token", fakeToken)),
		"path", "/auth/verify-email?token="+fakeToken+"&next=/home",
		"error", errors.New("duplicate key (email)=("+fakeEmail+") for Bearer "+fakeToken),
	)

	logged := output.String()
	assertAbsent(t, logged)
	for _, want := range []string{"next=/home", "token=[redacted]", "[email]", "request failed"} {
		if !strings.Contains(logged, want) {
			t.Errorf("log lacks %q: %s", want, logged)
		}
	}
}

func TestEventDropsRequestAndMasksText(t *testing.T) {
	event := &sentry.Event{
		Message:     "failed for " + fakeEmail,
		Transaction: "GET /reset-password?token=" + fakeToken,
		Request:     &sentry.Request{URL: "https://example.invalid/?token=" + fakeToken, Cookies: "session=" + fakeToken},
		User:        sentry.User{Email: fakeEmail},
		Breadcrumbs: []*sentry.Breadcrumb{{Message: fakePassword}},
		Tags:        map[string]string{"http.path": "/x?token=" + fakeToken, "user_email": fakeEmail},
		Contexts:    map[string]sentry.Context{"app": {"password": fakePassword, "note": fakeEmail}},
		Exception: []sentry.Exception{{
			Value: "pq: " + fakeEmail + " password=" + fakePassword,
			Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{
				{Function: "handler", Vars: map[string]interface{}{"password": fakePassword}},
			}},
		}},
	}

	scrubbed := Event(event)

	rendered := strings.Join([]string{
		scrubbed.Message, scrubbed.Transaction, scrubbed.Tags["http.path"], scrubbed.Tags["user_email"],
		scrubbed.Exception[0].Value, scrubbed.Contexts["app"]["password"].(string), scrubbed.Contexts["app"]["note"].(string),
	}, "\n")
	assertAbsent(t, rendered)
	if scrubbed.Request != nil || scrubbed.User.Email != "" || scrubbed.Breadcrumbs != nil ||
		scrubbed.Exception[0].Stacktrace.Frames[0].Vars != nil {
		t.Errorf("request, user, breadcrumbs, or frame variables survived: %+v", scrubbed)
	}
}
