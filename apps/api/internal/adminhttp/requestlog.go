package adminhttp

import (
	"context"
	"errors"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
)

// RequestInfo carries what the Admin API learns about a request back to the
// access log. The access log owns the value and handlers only fill it in, so
// the log can report a route template, the verified actor, and a stable error
// class without the handlers writing log lines of their own.
type RequestInfo struct {
	// Route is the registered route template, such as /admin/v1/reports/{id}.
	Route string
	// ActorID is the admin user of a verified session, never a claimed one.
	ActorID string
	// ErrorClass names why a request failed unexpectedly: "audit_write_failed"
	// or "internal". It is empty for expected outcomes.
	ErrorClass string
}

const (
	ErrorClassAuditWrite = "audit_write_failed"
	ErrorClassInternal   = "internal"
)

type requestInfoKey struct{}

// ContextWithRequestInfo attaches info for the Admin API to fill in.
func ContextWithRequestInfo(ctx context.Context, info *RequestInfo) context.Context {
	return context.WithValue(ctx, requestInfoKey{}, info)
}

// requestInfo returns the request's info, or a throwaway value when the access
// log is not in front of the handler, so callers never need a nil check.
func requestInfo(ctx context.Context) *RequestInfo {
	if info, ok := ctx.Value(requestInfoKey{}).(*RequestInfo); ok && info != nil {
		return info
	}
	return &RequestInfo{}
}

func errorClass(err error) string {
	if errors.Is(err, adminaudit.ErrWriteFailed) {
		return ErrorClassAuditWrite
	}
	return ErrorClassInternal
}
