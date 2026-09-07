package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestResendMailerHonorsContextDeadline(t *testing.T) {
	mailer := &ResendMailer{
		APIKey: "resend-api-key",
		Client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		})},
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()

	_, err := mailer.SendPasswordReset(ctx, "player@example.com", "reset-token", "reset-key")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("SendPasswordReset() error = %v, want context deadline exceeded", err)
	}
}

func TestResendMailerReturnsTypedNonSuccessResponse(t *testing.T) {
	mailer := &ResendMailer{
		APIKey: "resend-api-key",
		Client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusUnprocessableEntity,
				Status:     "422 Unprocessable Entity",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"message":"invalid recipient"}`)),
			}, nil
		})},
	}

	_, err := mailer.SendVerification(t.Context(), "invalid", "verify-token", "verification-key")
	var responseError *mailhttp.ResponseError
	if !errors.As(err, &responseError) {
		t.Fatalf("SendVerification() error = %v, want *mailhttp.ResponseError", err)
	}
	if !responseError.Permanent() {
		t.Fatalf("response error status = %d, want permanent rejection", responseError.StatusCode)
	}
}

func TestAccountEmailLinksUseWebRoutes(t *testing.T) {
	tests := []struct {
		name string
		link string
		want string
	}{
		{
			name: "verification",
			link: verificationLink("http://localhost:3000/", "verify token"),
			want: "http://localhost:3000/auth/verify-email?token=verify+token",
		},
		{
			name: "password reset",
			link: passwordResetLink("http://localhost:3000/", "reset token"),
			want: "http://localhost:3000/reset-password?token=reset+token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.link != tt.want {
				t.Fatalf("link = %q, want %q", tt.link, tt.want)
			}
		})
	}
}

func TestResendMailerSendsVerificationEmail(t *testing.T) {
	type resendPayload struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
	}

	var payload resendPayload
	var idempotencyKey string
	mailer := &ResendMailer{
		APIKey:  "resend-api-key",
		From:    "account@campusgamingnetwork.com",
		SiteURL: "https://campusgamingnetwork.com/",
		Client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", request.Method)
			}
			if request.URL.String() != "https://api.resend.com/emails" {
				t.Fatalf("URL = %q, want Resend email endpoint", request.URL)
			}
			if authorization := request.Header.Get("Authorization"); authorization != "Bearer resend-api-key" {
				t.Fatalf("Authorization = %q, want bearer API key", authorization)
			}
			if contentType := request.Header.Get("Content-Type"); contentType != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", contentType)
			}
			idempotencyKey = request.Header.Get("Idempotency-Key")
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode Resend payload: %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusAccepted,
				Status:     "202 Accepted",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"id":"provider-message-1"}`)),
			}, nil
		})},
	}

	providerID, err := mailer.SendVerification(context.Background(), "player@example.com", "verify token", "verification-idempotency-key")
	if err != nil {
		t.Fatalf("SendVerification() error = %v", err)
	}
	if providerID != "provider-message-1" {
		t.Fatalf("provider ID = %q, want provider-message-1", providerID)
	}
	if idempotencyKey != "verification-idempotency-key" {
		t.Fatalf("Idempotency-Key = %q, want verification-idempotency-key", idempotencyKey)
	}
	if payload.From != "account@campusgamingnetwork.com" {
		t.Fatalf("from = %q, want configured account sender", payload.From)
	}
	if len(payload.To) != 1 || payload.To[0] != "player@example.com" {
		t.Fatalf("to = %v, want player@example.com", payload.To)
	}
	if payload.Subject != "Verify your Campus Gaming Network email" {
		t.Fatalf("subject = %q, want verification subject", payload.Subject)
	}
	if !strings.Contains(payload.HTML, `href="https://campusgamingnetwork.com/auth/verify-email?token=verify+token"`) {
		t.Fatalf("HTML = %q, want verification link", payload.HTML)
	}
}
