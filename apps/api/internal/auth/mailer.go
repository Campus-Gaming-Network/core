package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaillayout"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type Mailer interface {
	SendVerification(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error)
	SendPasswordReset(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error)
	SendEmailChangeVerification(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error)
	SendEmailChangedNotice(ctx context.Context, recipient string, idempotencyKey string) (string, error)
}

// ResendMailer uses Resend in configured environments. Without an API key it
// records a local delivery result and logs safe metadata only; token-bearing
// links are never written to application logs.
type ResendMailer struct {
	APIKey   string
	From     string
	Endpoint string
	SiteURL  string
	Client   *http.Client
	Logger   *slog.Logger
}

func (m *ResendMailer) SendVerification(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, "Verify your Campus Gaming Network email", verificationMessage(verificationLink(m.SiteURL, token)), "verification", idempotencyKey)
}

func (m *ResendMailer) SendPasswordReset(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, "Reset your Campus Gaming Network password", passwordResetMessage(passwordResetLink(m.SiteURL, token)), "password_reset", idempotencyKey)
}

// SendEmailChangeVerification sends the link that moves an account to this
// address.
func (m *ResendMailer) SendEmailChangeVerification(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, "Confirm your new Campus Gaming Network email", emailChangeMessage(accountLink(m.SiteURL, "/confirm-email-change", token)), "email_change_verification", idempotencyKey)
}

// SendEmailChangedNotice tells an account's previous address that the account
// now uses another one, so a change the owner did not make gets noticed. It
// names neither address and links to the password reset form.
func (m *ResendMailer) SendEmailChangedNotice(ctx context.Context, recipient string, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, "Your Campus Gaming Network email was changed", emailChangedMessage(strings.TrimRight(m.SiteURL, "/")+"/forgot-password"), "email_changed_notice", idempotencyKey)
}

func verificationMessage(link string) emaillayout.Message {
	return emaillayout.Message{
		Preview: "Confirm your email address to finish signing up.",
		Heading: "Confirm your email address",
		Paragraphs: []string{
			"Thanks for signing up for Campus Gaming Network. Confirm that this is your email address to finish setting up your account.",
		},
		Action: &emaillayout.Action{Label: "Confirm email address", URL: link},
		Notes: []string{
			"The link works once. If it has expired, log in and ask for a new one.",
			"If you did not create an account, you can ignore this email. No account is set up until the address is confirmed.",
		},
		Reason: "You received this email because this address was used to sign up for Campus Gaming Network.",
	}
}

func passwordResetMessage(link string) emaillayout.Message {
	return emaillayout.Message{
		Preview: "Choose a new password for your account.",
		Heading: "Reset your password",
		Paragraphs: []string{
			"Someone asked to reset the password for the Campus Gaming Network account that uses this email address. Choose a new password with the button below.",
		},
		Action: &emaillayout.Action{Label: "Choose a new password", URL: link},
		Notes: []string{
			"The link works once and expires soon.",
			"If you did not ask to reset your password, you can ignore this email. Your password stays the same.",
		},
		Reason: "You received this email because a password reset was requested for this address.",
	}
}

func emailChangeMessage(link string) emaillayout.Message {
	return emaillayout.Message{
		Preview: "Confirm the new email address for your account.",
		Heading: "Confirm your new email address",
		Paragraphs: []string{
			"A Campus Gaming Network account asked to use this address from now on. Confirm it to finish the change.",
		},
		Action: &emaillayout.Action{Label: "Confirm new email", URL: link},
		Notes: []string{
			"Until you confirm, the account keeps its current address. The link works once.",
			"If you did not ask for this, you can ignore this email.",
		},
		Reason: "You received this email because this address was entered as the new address for a Campus Gaming Network account.",
	}
}

func emailChangedMessage(resetLink string) emaillayout.Message {
	return emaillayout.Message{
		Preview: "This address no longer signs in to your account.",
		Heading: "Your email address was changed",
		Paragraphs: []string{
			"The email address on your Campus Gaming Network account was just changed, so this address no longer signs in.",
			"If you did not make this change, reset your password now and contact support.",
		},
		Action: &emaillayout.Action{Label: "Reset your password", URL: resetLink},
		Reason: "You received this email because this address was on a Campus Gaming Network account.",
	}
}

func verificationLink(siteURL string, token string) string {
	return accountLink(siteURL, "/auth/verify-email", token)
}

func passwordResetLink(siteURL string, token string) string {
	return accountLink(siteURL, "/reset-password", token)
}

func accountLink(siteURL string, path string, token string) string {
	return strings.TrimRight(siteURL, "/") + path + "?token=" + url.QueryEscape(token)
}

func (m *ResendMailer) sendMessage(ctx context.Context, recipient, subject string, message emaillayout.Message, kind, idempotencyKey string) (string, error) {
	body, err := emaillayout.HTML(message)
	if err != nil {
		return "", err
	}
	return m.sendHTML(ctx, recipient, subject, body, emaillayout.Text(message), kind, idempotencyKey)
}

func (m *ResendMailer) sendHTML(ctx context.Context, recipient, subject, body, text, kind, idempotencyKey string) (string, error) {
	if m.APIKey == "" {
		if m.Logger != nil {
			// Tokens live in links, so local delivery logs only safe metadata.
			m.Logger.Info("local account email", "kind", kind)
		}
		return "local-" + idempotencyKey, nil
	}

	payload := struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
		Text    string   `json:"text"`
	}{
		From:    m.From,
		To:      []string{recipient},
		Subject: subject,
		HTML:    body,
		Text:    text,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode account email: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint(m.Endpoint), bytes.NewReader(encoded))
	if err != nil {
		return "", fmt.Errorf("create account email request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+m.APIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", idempotencyKey)

	client := m.Client
	if client == nil {
		client = mailhttp.NewClient()
	}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("send account email: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return "", &mailhttp.ResponseError{
			StatusCode: response.StatusCode,
			Status:     response.Status,
			Detail:     strings.TrimSpace(string(detail)),
		}
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2048)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode account email response: %w", err)
	}
	if strings.TrimSpace(result.ID) == "" {
		return "", errors.New("resend account email response missing id")
	}
	return result.ID, nil
}

func resendEndpoint(configured string) string {
	if endpoint := strings.TrimSpace(configured); endpoint != "" {
		return endpoint
	}
	return "https://api.resend.com/emails"
}
