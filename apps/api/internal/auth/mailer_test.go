package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaillayout"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestResendMailerHonorsContextDeadline(t *testing.T) {
	mailer := &ResendMailer{
		APIKey:  "resend-api-key",
		SiteURL: "https://campusgamingnetwork.com",
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
		APIKey:  "resend-api-key",
		SiteURL: "https://campusgamingnetwork.com",
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
		Text    string   `json:"text"`
	}

	var payload resendPayload
	var idempotencyKey string
	mailer := &ResendMailer{
		APIKey:   "resend-api-key",
		From:     "account@campusgamingnetwork.com",
		Endpoint: "https://mail.stub.test/emails",
		SiteURL:  "https://campusgamingnetwork.com/",
		Client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", request.Method)
			}
			if request.URL.String() != "https://mail.stub.test/emails" {
				t.Fatalf("URL = %q, want configured email endpoint", request.URL)
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
	message := verificationMessage("https://campusgamingnetwork.com/auth/verify-email?token=verify+token")
	wantHTML, err := emaillayout.HTML(message)
	if err != nil {
		t.Fatalf("render verification email: %v", err)
	}
	if payload.HTML != wantHTML || payload.Text != emaillayout.Text(message) {
		t.Fatalf("verification email = %q / %q, want the shared layout", payload.HTML, payload.Text)
	}
	if !strings.Contains(payload.HTML, `href="https://campusgamingnetwork.com/auth/verify-email?token=verify&#43;token"`) {
		t.Fatalf("HTML = %q, want verification link", payload.HTML)
	}
}

// Each account email says what its button does and what to do when the
// recipient did not ask for it.
func TestAccountEmailMessages(t *testing.T) {
	link := "https://cgn.example/link?token=t"
	got := []emaillayout.Message{
		verificationMessage(link),
		passwordResetMessage(link),
		emailChangeMessage(link),
		emailChangedMessage(link),
	}
	want := []emaillayout.Message{
		{
			Preview:    "Confirm your email address to finish signing up.",
			Heading:    "Confirm your email address",
			Paragraphs: []string{"Thanks for signing up for Campus Gaming Network. Confirm that this is your email address to finish setting up your account."},
			Action:     &emaillayout.Action{Label: "Confirm email address", URL: link},
			Notes: []string{
				"The link works once. If it has expired, log in and ask for a new one.",
				"If you did not create an account, you can ignore this email. No account is set up until the address is confirmed.",
			},
			Reason: "You received this email because this address was used to sign up for Campus Gaming Network.",
		},
		{
			Preview:    "Choose a new password for your account.",
			Heading:    "Reset your password",
			Paragraphs: []string{"Someone asked to reset the password for the Campus Gaming Network account that uses this email address. Choose a new password with the button below."},
			Action:     &emaillayout.Action{Label: "Choose a new password", URL: link},
			Notes: []string{
				"The link works once and expires soon.",
				"If you did not ask to reset your password, you can ignore this email. Your password stays the same.",
			},
			Reason: "You received this email because a password reset was requested for this address.",
		},
		{
			Preview:    "Confirm the new email address for your account.",
			Heading:    "Confirm your new email address",
			Paragraphs: []string{"A Campus Gaming Network account asked to use this address from now on. Confirm it to finish the change."},
			Action:     &emaillayout.Action{Label: "Confirm new email", URL: link},
			Notes: []string{
				"Until you confirm, the account keeps its current address. The link works once.",
				"If you did not ask for this, you can ignore this email.",
			},
			Reason: "You received this email because this address was entered as the new address for a Campus Gaming Network account.",
		},
		{
			Preview: "This address no longer signs in to your account.",
			Heading: "Your email address was changed",
			Paragraphs: []string{
				"The email address on your Campus Gaming Network account was just changed, so this address no longer signs in.",
				"If you did not make this change, reset your password now and contact support.",
			},
			Action: &emaillayout.Action{Label: "Reset your password", URL: link},
			Reason: "You received this email because this address was on a Campus Gaming Network account.",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("account email messages = %+v\nwant %+v", got, want)
	}
}

func TestResendMailerSendsEmailChangeMessages(t *testing.T) {
	type sent struct {
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
	}
	var messages []sent
	mailer := &ResendMailer{
		APIKey:   "resend-api-key",
		Endpoint: "https://mail.stub.test/emails",
		SiteURL:  "https://campusgamingnetwork.com/",
		Client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			var message sent
			if err := json.NewDecoder(request.Body).Decode(&message); err != nil {
				t.Fatalf("decode Resend payload: %v", err)
			}
			messages = append(messages, message)
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"id":"provider-message"}`)),
			}, nil
		})},
	}

	if _, err := mailer.SendEmailChangeVerification(context.Background(), "new@example.com", "change token", "change-key"); err != nil {
		t.Fatalf("SendEmailChangeVerification() error = %v", err)
	}
	if _, err := mailer.SendEmailChangedNotice(context.Background(), "old@example.com", "notice-key"); err != nil {
		t.Fatalf("SendEmailChangedNotice() error = %v", err)
	}

	render := func(message emaillayout.Message) string {
		t.Helper()
		body, err := emaillayout.HTML(message)
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		return body
	}
	want := []sent{
		{
			To:      []string{"new@example.com"},
			Subject: "Confirm your new Campus Gaming Network email",
			HTML:    render(emailChangeMessage("https://campusgamingnetwork.com/confirm-email-change?token=change+token")),
		},
		{
			To:      []string{"old@example.com"},
			Subject: "Your Campus Gaming Network email was changed",
			HTML:    render(emailChangedMessage("https://campusgamingnetwork.com/forgot-password")),
		},
	}
	if !reflect.DeepEqual(messages, want) {
		t.Fatalf("messages = %#v, want %#v", messages, want)
	}
}
