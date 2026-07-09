package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

type Mailer interface {
	SendVerification(ctx context.Context, recipient string, token string) error
	SendPasswordReset(ctx context.Context, recipient string, token string) error
}

// ResendMailer uses Resend in configured environments and logs a local link
// when no API key is configured, making the flow testable in Docker without
// pretending an email was delivered.
type ResendMailer struct {
	APIKey  string
	From    string
	SiteURL string
	Client  *http.Client
	Logger  *slog.Logger
}

func (m *ResendMailer) SendVerification(ctx context.Context, recipient string, token string) error {
	link := strings.TrimRight(m.SiteURL, "/") + "/auth/verify-email?token=" + url.QueryEscape(token)
	return m.send(ctx, recipient, "Verify your Campus Gaming Network email", link, "verification")
}

func (m *ResendMailer) SendPasswordReset(ctx context.Context, recipient string, token string) error {
	link := strings.TrimRight(m.SiteURL, "/") + "/auth/reset-password?token=" + url.QueryEscape(token)
	return m.send(ctx, recipient, "Reset your Campus Gaming Network password", link, "password_reset")
}

func (m *ResendMailer) send(ctx context.Context, recipient, subject, link, kind string) error {
	if m.APIKey == "" {
		if m.Logger != nil {
			m.Logger.Info("local account email link", "kind", kind, "recipient", recipient, "link", link)
		}
		return nil
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
		return fmt.Errorf("encode account email: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create account email request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+m.APIKey)
	request.Header.Set("Content-Type", "application/json")

	client := m.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("send account email: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("resend returned %s: %s", response.Status, strings.TrimSpace(string(detail)))
	}
	return nil
}
