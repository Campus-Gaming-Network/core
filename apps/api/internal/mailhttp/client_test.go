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
