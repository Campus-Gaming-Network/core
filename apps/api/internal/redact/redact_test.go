package redact

import (
	"bytes"
	"errors"
	"log/slog"
	"reflect"
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

func TestEventMasksNestedContextValues(t *testing.T) {
	event := &sentry.Event{
		Contexts: map[string]sentry.Context{"app": {
			"password": fakePassword,
			"note":     "sent to " + fakeEmail,
			"nested":   map[string]interface{}{"api_key": fakeToken, "detail": "token=" + fakeToken},
			"list":     []interface{}{fakeEmail, map[string]interface{}{"secret": fakePassword}},
			"strings":  []string{"Bearer " + fakeToken},
			"count":    3,
		}},
	}

	scrubbed := Event(event)

	want := map[string]sentry.Context{"app": {
		"password": Mask,
		"note":     "sent to [email]",
		"nested":   map[string]interface{}{"api_key": Mask, "detail": "token=" + Mask},
		"list":     []interface{}{"[email]", map[string]interface{}{"secret": Mask}},
		"strings":  []string{"Bearer " + Mask},
		"count":    3,
	}}
	if !reflect.DeepEqual(scrubbed.Contexts, want) {
		t.Errorf("Contexts = %#v, want %#v", scrubbed.Contexts, want)
	}
}

func TestSensitiveKey(t *testing.T) {
	tests := map[string]bool{
		"Authorization": true, "Set-Cookie": true, "X-CSRF-Token": true, "SENTRY_DSN": true,
		"clientSecret": true, "apiKey": true, "recipient_address": true, "passwd": true,
		"path": false, "status": false, "school_id": false,
	}
	for key, want := range tests {
		if got := SensitiveKey(key); got != want {
			t.Errorf("SensitiveKey(%q) = %v, want %v", key, got, want)
		}
	}
}

func TestStringMasksCredentialForms(t *testing.T) {
	tests := map[string]string{
		"Authorization: Basic dXNlcjpwYXNz":         "Authorization: Basic " + Mask,
		"https://x.invalid/?api_key=abc&page=2":     "https://x.invalid/?api_key=" + Mask + "&page=2",
		"signature=abc123 other=1":                  "signature=" + Mask + " other=1",
		"mail a.b+c@sub.example.invalid and b@c.io": "mail [email] and [email]",
		"nothing sensitive here":                    "nothing sensitive here",
	}
	for input, want := range tests {
		if got := String(input); got != want {
			t.Errorf("String(%q) = %q, want %q", input, got, want)
		}
	}
}

type stringerValue string

func (v stringerValue) String() string { return "value for " + string(v) }

func TestReplaceAttrHandlesKinds(t *testing.T) {
	tests := []struct {
		name string
		in   slog.Attr
		want slog.Attr
	}{
		{"time key untouched", slog.String(slog.TimeKey, fakeEmail), slog.String(slog.TimeKey, fakeEmail)},
		{"message untouched", slog.String(slog.MessageKey, "hi"), slog.String(slog.MessageKey, "hi")},
		{"stringer", slog.Any("who", stringerValue(fakeEmail)), slog.String("who", "value for [email]")},
		{"int passes", slog.Int("n", 5), slog.Int("n", 5)},
		{"sensitive non-string", slog.Int("token", 5), slog.String("token", Mask)},
	}
	for _, tt := range tests {
		if got := ReplaceAttr(nil, tt.in); !got.Equal(tt.want) {
			t.Errorf("%s: ReplaceAttr = %v, want %v", tt.name, got, tt.want)
		}
	}
}
