package mailhttp

import (
	"net/http"
	"testing"
)

func TestResponseErrorClassifiesRetryableStatuses(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnprocessableEntity} {
		if !(&ResponseError{StatusCode: status}).Permanent() {
			t.Errorf("status %d classified transient, want permanent", status)
		}
	}
	for _, status := range []int{http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusServiceUnavailable} {
		if (&ResponseError{StatusCode: status}).Permanent() {
			t.Errorf("status %d classified permanent, want transient", status)
		}
	}
}

func TestResponseErrorNameAcceptsOnlyAnIdentifier(t *testing.T) {
	tests := []struct {
		name   string
		detail string
		want   string
	}{
		{
			name:   "provider error name",
			detail: `{"statusCode":403,"name":"validation_error","message":"The example.com domain is not verified."}`,
			want:   "validation_error",
		},
		{
			name:   "free text in the name",
			detail: `{"name":"could not deliver to player@example.com"}`,
		},
		{
			name:   "body that is not JSON",
			detail: "upstream connect error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := (&ResponseError{Detail: tt.detail}).ErrorName(); got != tt.want {
				t.Errorf("ErrorName() = %q, want %q", got, tt.want)
			}
		})
	}
}
