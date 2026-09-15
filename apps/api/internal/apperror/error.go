// Package apperror defines application errors that can cross package boundaries
// without coupling domain code to HTTP.
package apperror

import "errors"

// Kind classifies an application error independently from its user-facing code.
type Kind uint8

const (
	KindUnknown Kind = iota
	KindValidation
	KindUnprocessable
	KindNotFound
	KindConflict
	KindAuthentication
	KindAuthorization
)

// Error carries a stable machine code while preserving the underlying cause.
// Error messages are for internal diagnostics only; callers must expose Code,
// never Error(), to clients.
type Error struct {
	kind  Kind
	code  string
	cause error
}

// New creates a classified application error with an internal diagnostic
// message.
func New(kind Kind, code string, message string) *Error {
	return &Error{kind: kind, code: code, cause: errors.New(message)}
}

// Wrap adds application classification to an existing error without breaking
// errors.Is or errors.As traversal.
func Wrap(kind Kind, code string, cause error) *Error {
	if cause == nil {
		cause = errors.New(code)
	}
	return &Error{kind: kind, code: code, cause: cause}
}

// Validation creates a standard invalid-request error.
func Validation(message string) *Error {
	return New(KindValidation, "invalid_request", message)
}

func (e *Error) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.cause == nil {
		return e.code
	}
	return e.cause.Error()
}

// Unwrap preserves the original cause for errors.Is and errors.As.
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

// Is treats errors with the same non-empty class and code as equivalent. This
// lets packages expose sentinel application errors while still wrapping the
// concrete underlying cause at the point of failure.
func (e *Error) Is(target error) bool {
	targetError, ok := target.(*Error)
	return ok && e != nil && targetError != nil && e.code != "" &&
		e.kind == targetError.kind && e.code == targetError.code
}

// Kind returns the stable application-error class.
func (e *Error) Kind() Kind {
	if e == nil {
		return KindUnknown
	}
	return e.kind
}

// Code returns the stable machine-readable error code.
func (e *Error) Code() string {
	if e == nil {
		return ""
	}
	return e.code
}

// Details extracts the first classified error in an error chain.
func Details(err error) (Kind, string, bool) {
	var applicationError *Error
	if !errors.As(err, &applicationError) || applicationError.code == "" {
		return KindUnknown, "", false
	}
	return applicationError.kind, applicationError.code, true
}
