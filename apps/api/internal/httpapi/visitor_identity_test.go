package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
)

func TestClientKeyTrustsOnlyAuthenticatedBFFIdentity(t *testing.T) {
	tests := []struct {
		name           string
		remoteAddress  string
		sharedSecret   string
		providedSecret string
		visitorIP      string
		want           string
	}{
		{
			name:           "trusted IPv4",
			remoteAddress:  "10.0.0.8:4321",
			sharedSecret:   "shared-secret",
			providedSecret: "shared-secret",
			visitorIP:      "198.51.100.42",
			want:           "198.51.100.42",
		},
		{
			name:           "trusted IPv6 is normalized",
			remoteAddress:  "[fd12::8]:4321",
			sharedSecret:   "shared-secret",
			providedSecret: "shared-secret",
			visitorIP:      "2001:0db8:0000:0000:0000:0000:0000:0042",
			want:           "2001:db8::42",
		},
		{
			name:           "IPv4 mapped IPv6 is unmapped",
			remoteAddress:  "[fd12::8]:4321",
			sharedSecret:   "shared-secret",
			providedSecret: "shared-secret",
			visitorIP:      "::ffff:192.0.2.9",
			want:           "192.0.2.9",
		},
		{
			name:          "missing proxy secret falls back",
			remoteAddress: "10.0.0.8:4321",
			sharedSecret:  "shared-secret",
			visitorIP:     "198.51.100.42",
			want:          "10.0.0.8",
		},
		{
			name:           "wrong proxy secret falls back",
			remoteAddress:  "10.0.0.8:4321",
			sharedSecret:   "shared-secret",
			providedSecret: "browser-supplied",
			visitorIP:      "198.51.100.42",
			want:           "10.0.0.8",
		},
		{
			name:           "unconfigured proxy secret never trusts header",
			remoteAddress:  "10.0.0.8:4321",
			providedSecret: "browser-supplied",
			visitorIP:      "198.51.100.42",
			want:           "10.0.0.8",
		},
		{
			name:           "malformed visitor IP falls back",
			remoteAddress:  "[fd12::8]:4321",
			sharedSecret:   "shared-secret",
			providedSecret: "shared-secret",
			visitorIP:      "198.51.100.42, 203.0.113.7",
			want:           "fd12::8",
		},
		{
			name: "missing addresses use unknown bucket",
			want: "unknown",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/auth/signup", nil)
			request.RemoteAddr = test.remoteAddress
			if test.providedSecret != "" {
				request.Header.Set(proxySecretHeader, test.providedSecret)
			}
			if test.visitorIP != "" {
				request.Header.Set(visitorIPHeader, test.visitorIP)
			}

			if got := clientKey(request, test.sharedSecret); got != test.want {
				t.Fatalf("clientKey() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestSignupRateLimitsVisitorsIndependentlyBehindBFF(t *testing.T) {
	router := &Router{
		cfg: config.Config{
			AuthRateWindow:    time.Minute,
			ProxySharedSecret: "shared-secret",
		},
		account: newPassV0ContractAccountService(&passV0ContractUsers{}),
		limiter: ratelimit.New(1, time.Minute),
	}
	handler := http.HandlerFunc(router.handleSignup)

	first := signupRequestFromBFF("198.51.100.10", "shared-secret")
	second := signupRequestFromBFF("198.51.100.11", "shared-secret")
	repeated := signupRequestFromBFF("198.51.100.10", "shared-secret")

	if response := serveContractRequest(handler, first); response.Code != http.StatusCreated {
		t.Fatalf("first visitor status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if response := serveContractRequest(handler, second); response.Code != http.StatusCreated {
		t.Fatalf("second visitor status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if response := serveContractRequest(handler, repeated); response.Code != http.StatusTooManyRequests {
		t.Fatalf("repeated visitor status = %d, want %d; body = %s", response.Code, http.StatusTooManyRequests, response.Body.String())
	}
}

func TestSpoofedVisitorHeadersShareDirectCallerQuota(t *testing.T) {
	router := &Router{
		cfg: config.Config{
			AuthRateWindow:    time.Minute,
			ProxySharedSecret: "shared-secret",
		},
		account: newPassV0ContractAccountService(&passV0ContractUsers{}),
		limiter: ratelimit.New(1, time.Minute),
	}
	handler := http.HandlerFunc(router.handleSignup)

	first := signupRequestFromBFF("198.51.100.10", "wrong-secret")
	second := signupRequestFromBFF("198.51.100.11", "wrong-secret")

	if response := serveContractRequest(handler, first); response.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d; body = %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if response := serveContractRequest(handler, second); response.Code != http.StatusTooManyRequests {
		t.Fatalf("spoofed second status = %d, want %d; body = %s", response.Code, http.StatusTooManyRequests, response.Body.String())
	}
}

func TestPrivateEventQuotaIsScopedByEventAndVisitor(t *testing.T) {
	router := &Router{
		cfg:     config.Config{ProxySharedSecret: "shared-secret"},
		limiter: ratelimit.New(1, time.Minute),
	}
	visitorOne := requestFromBFF("198.51.100.10", "shared-secret")
	visitorTwo := requestFromBFF("198.51.100.11", "shared-secret")

	if !router.allowVisitor("event-unlock-event:first", visitorOne) {
		t.Fatal("first event attempt was unexpectedly denied")
	}
	if !router.allowVisitor("event-unlock-event:second", visitorOne) {
		t.Fatal("different event shared the visitor's first event quota")
	}
	if !router.allowVisitor("event-unlock-event:first", visitorTwo) {
		t.Fatal("second visitor shared the first visitor's event quota")
	}
	if router.allowVisitor("event-unlock-event:first", visitorOne) {
		t.Fatal("repeated attempt for the same event and visitor was allowed")
	}
}

func TestAuthenticatedQuotaIsScopedByAccountNotVisitor(t *testing.T) {
	router := &Router{limiter: ratelimit.New(1, time.Minute)}

	if !router.allowAccount("event-create", "user-one") {
		t.Fatal("first account attempt was unexpectedly denied")
	}
	if router.allowAccount("event-create", "user-one") {
		t.Fatal("same account received another quota through a different visitor")
	}
	if !router.allowAccount("event-create", "user-two") {
		t.Fatal("second account shared the first account's quota")
	}
}

func signupRequestFromBFF(visitorIP, secret string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/auth/signup", strings.NewReader(validPassV0SignupJSON()))
	request.RemoteAddr = "10.0.0.8:4321"
	request.Header.Set(visitorIPHeader, visitorIP)
	request.Header.Set(proxySecretHeader, secret)
	return request
}

func requestFromBFF(visitorIP, secret string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	request.RemoteAddr = "10.0.0.8:4321"
	request.Header.Set(visitorIPHeader, visitorIP)
	request.Header.Set(proxySecretHeader, secret)
	return request
}
