package httpapi

import (
	"net/http"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
)

type mappedApplicationError struct {
	status int
	code   string
}

// mapApplicationError is the only application-error-to-HTTP policy. Domain
// packages supply a kind and stable code; arbitrary error wording is ignored.
func mapApplicationError(err error, fallbackCode string) mappedApplicationError {
	kind, code, ok := apperror.Details(err)
	if !ok || kind == apperror.KindUnknown {
		if fallbackCode == "" {
			fallbackCode = "internal_error"
		}
		return mappedApplicationError{status: http.StatusInternalServerError, code: fallbackCode}
	}

	status := http.StatusInternalServerError
	switch kind {
	case apperror.KindValidation:
		status = http.StatusBadRequest
	case apperror.KindUnprocessable:
		status = http.StatusUnprocessableEntity
	case apperror.KindNotFound:
		status = http.StatusNotFound
	case apperror.KindConflict:
		status = http.StatusConflict
	case apperror.KindAuthentication:
		status = http.StatusUnauthorized
	case apperror.KindAuthorization:
		status = http.StatusForbidden
	default:
		if fallbackCode == "" {
			fallbackCode = "internal_error"
		}
		return mappedApplicationError{status: http.StatusInternalServerError, code: fallbackCode}
	}
	return mappedApplicationError{status: status, code: code}
}

func writeApplicationError(w http.ResponseWriter, err error, fallbackCode string) {
	mapped := mapApplicationError(err, fallbackCode)
	writeError(w, mapped.status, mapped.code)
}
