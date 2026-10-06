// Package errormonitor reports unexpected API failures to Sentry.
//
// An event carries the error, a stack trace, and the HTTP method and path of
// the request that failed. It never carries headers, cookies, a query string,
// a body, or a user. Reporting does nothing until Init is given a DSN.
package errormonitor

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
)

// adminPathPrefix marks the Admin API. Its failures stay in the structured
// logs because the Admin Console sends nothing to a third party.
const adminPathPrefix = "/admin/"

// Options configures reporting. An empty DSN leaves reporting disabled.
type Options struct {
	DSN         string
	Environment string
	Release     string
}

// Init starts reporting to the project named by the DSN.
func Init(options Options) error {
	if options.DSN == "" {
		return nil
	}
	if err := sentry.Init(clientOptions(options)); err != nil {
		return fmt.Errorf("initialize error monitoring: %w", err)
	}
	return nil
}

func clientOptions(options Options) sentry.ClientOptions {
	return sentry.ClientOptions{
		Dsn:         options.DSN,
		Environment: options.Environment,
		Release:     options.Release,
		// Nothing below sets request or user data. Clearing it here keeps that
		// true if a later change or an SDK integration attaches some.
		BeforeSend: func(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
			event.Request = nil
			event.User = sentry.User{}
			event.Breadcrumbs = nil
			return event
		},
	}
}

// Flush waits briefly for queued events to be sent before the process exits.
func Flush() {
	sentry.Flush(2 * time.Second)
}

// CapturePanic reports a value recovered from a panicking handler.
func CapturePanic(req *http.Request, recovered any) {
	if strings.HasPrefix(req.URL.Path, adminPathPrefix) {
		return
	}
	hub := sentry.CurrentHub().Clone()
	hub.Scope().SetTag("http.method", req.Method)
	hub.Scope().SetTag("http.path", req.URL.Path)
	hub.Recover(recovered)
}

// CaptureError reports an error a handler answered with a 500. The code is the
// stable error code written to the response.
func CaptureError(err error, code string) {
	hub := sentry.CurrentHub().Clone()
	hub.Scope().SetTag("error.code", code)
	hub.CaptureException(err)
}
