package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type Mailer interface {
	SendVerification(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error)
	SendPasswordReset(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error)
}

// ResendMailer uses Resend in configured environments. Without an API key it
// records a local delivery result and logs safe metadata only; token-bearing
// links are never written to application logs.
type ResendMailer struct {
	APIKey  string
	From    string
	SiteURL string
	Client  *http.Client
	Logger  *slog.Logger
}

func (m *ResendMailer) SendVerification(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error) {
	return m.send(ctx, recipient, "Verify your Campus Gaming Network email", verificationLink(m.SiteURL, token), "verification", idempotencyKey)
}

func (m *ResendMailer) SendPasswordReset(ctx context.Context, recipient string, token string, idempotencyKey string) (string, error) {
	return m.send(ctx, recipient, "Reset your Campus Gaming Network password", passwordResetLink(m.SiteURL, token), "password_reset", idempotencyKey)
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

func (m *ResendMailer) send(ctx context.Context, recipient, subject, link, kind, idempotencyKey string) (string, error) {
	if m.APIKey == "" {
		if m.Logger != nil {
			// Tokens live in links, so local delivery logs only safe metadata.
			m.Logger.Info("local account email", "kind", kind, "recipient", recipient)
		}
		return "local-" + idempotencyKey, nil
	}

	payload := struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
	}{
		From:    m.From,
		To:      []string{recipient},
		Subject: subject,
		HTML:    fmt.Sprintf(`<p><a href="%s">Continue to Campus Gaming Network</a></p>`, html.EscapeString(link)),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode account email: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
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
