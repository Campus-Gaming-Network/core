// Package redact keeps personal data and secrets out of logs and error
// reports.
//
// Two mechanisms cover the two places the API writes diagnostics. LogHandler
// wraps a slog handler so that every attribute passes through ReplaceAttr.
// Event scrubs a Sentry event before it leaves the process. Both rely on the
// same rules: values under a sensitive key are replaced outright, and any
// other string has email addresses, token-like query parameters, and bearer
// credentials masked.
package redact

import (
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"

	"github.com/getsentry/sentry-go"
)

// Mask replaces redacted values.
const Mask = "[redacted]"

// sensitiveKeyParts name attribute keys whose values are never written. A key
// matches when its lower-cased form contains any part.
var sensitiveKeyParts = []string{
	"password", "passwd", "secret", "token", "authorization", "cookie",
	"api_key", "apikey", "email", "recipient", "dsn", "csrf",
}

var (
	emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+`)
	// sensitiveParameterPattern matches name=value pairs in query strings and
	// in error text such as "token=abc".
	sensitiveParameterPattern = regexp.MustCompile(`(?i)\b((?:[a-z_]*(?:token|secret|password|passwd|api_?key|signature))=)[^&\s"'#]+`)
	bearerPattern             = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]+`)
)

// String masks email addresses, sensitive query parameters, and bearer
// credentials in text.
func String(text string) string {
	text = emailPattern.ReplaceAllString(text, "[email]")
	text = sensitiveParameterPattern.ReplaceAllString(text, "${1}"+Mask)
	return bearerPattern.ReplaceAllString(text, "${1} "+Mask)
}

// SensitiveKey reports whether values under the key must never be written.
func SensitiveKey(key string) bool {
	lowered := strings.ToLower(key)
	for _, part := range sensitiveKeyParts {
		if strings.Contains(lowered, part) {
			return true
		}
	}
	return false
}

// ReplaceAttr is a slog.HandlerOptions.ReplaceAttr that masks sensitive
// attributes. The handler walks groups, so it only sees leaves.
func ReplaceAttr(_ []string, attr slog.Attr) slog.Attr {
	if attr.Key == slog.TimeKey || attr.Key == slog.LevelKey || attr.Key == slog.MessageKey {
		return attr
	}
	if SensitiveKey(attr.Key) {
		return slog.String(attr.Key, Mask)
	}
	switch attr.Value.Kind() {
	case slog.KindString:
		return slog.String(attr.Key, String(attr.Value.String()))
	case slog.KindAny:
		switch value := attr.Value.Any().(type) {
		case error:
			return slog.String(attr.Key, String(value.Error()))
		case fmt.Stringer:
			return slog.String(attr.Key, String(value.String()))
		}
	}
	return attr
}

// Event scrubs a Sentry event in place and returns it. It drops request,
// user, and breadcrumb data and masks the message, exception text, tags,
// extra data, and contexts.
func Event(event *sentry.Event) *sentry.Event {
	event.Request = nil
	event.User = sentry.User{}
	event.Breadcrumbs = nil
	event.ServerName = ""
	event.Message = String(event.Message)
	event.Transaction = String(event.Transaction)
	for index := range event.Exception {
		event.Exception[index].Value = String(event.Exception[index].Value)
		if event.Exception[index].Stacktrace == nil {
			continue
		}
		for frame := range event.Exception[index].Stacktrace.Frames {
			event.Exception[index].Stacktrace.Frames[frame].Vars = nil
		}
	}
	for key, value := range event.Tags {
		if SensitiveKey(key) {
			event.Tags[key] = Mask
			continue
		}
		event.Tags[key] = String(value)
	}
	for _, context := range event.Contexts {
		scrubMap(context)
	}
	return event
}

func scrubMap(values map[string]any) {
	for key, value := range values {
		if SensitiveKey(key) {
			values[key] = Mask
			continue
		}
		values[key] = scrubValue(value)
	}
}

func scrubValue(value any) any {
	switch typed := value.(type) {
	case string:
		return String(typed)
	case error:
		return String(typed.Error())
	case fmt.Stringer:
		return String(typed.String())
	case map[string]any:
		scrubMap(typed)
		return typed
	case []any:
		for index := range typed {
			typed[index] = scrubValue(typed[index])
		}
		return typed
	case []string:
		for index := range typed {
			typed[index] = String(typed[index])
		}
		return typed
	default:
		return value
	}
}

// NewLogger returns a text logger that writes to w and redacts every
// attribute. Commands install it with slog.SetDefault before they log.
func NewLogger(w io.Writer) *slog.Logger {
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{ReplaceAttr: ReplaceAttr}))
}
