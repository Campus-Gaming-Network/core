package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
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
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode Resend payload: %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusAccepted,
				Status:     "202 Accepted",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{}`)),
			}, nil
		})},
	}

	if err := mailer.SendVerification(context.Background(), "player@example.com", "verify token"); err != nil {
		t.Fatalf("SendVerification() error = %v", err)
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
