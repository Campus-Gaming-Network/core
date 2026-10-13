package mailhttp

import (
	"net/http"
	"testing"
)

func TestNewClientBoundsEveryNetworkPhase(t *testing.T) {
	client := NewClient()
	if client.Timeout != OverallTimeout {
		t.Fatalf("client timeout = %v, want %v", client.Timeout, OverallTimeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport = %T, want *http.Transport", client.Transport)
	}
	if transport.ResponseHeaderTimeout != ResponseHeaderTimeout {
		t.Fatalf("response header timeout = %v, want %v", transport.ResponseHeaderTimeout, ResponseHeaderTimeout)
	}
	if transport.TLSHandshakeTimeout != ConnectTimeout {
		t.Fatalf("TLS handshake timeout = %v, want %v", transport.TLSHandshakeTimeout, ConnectTimeout)
	}
}

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
