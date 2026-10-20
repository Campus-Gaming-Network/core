package teams

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

// NoticePayload is what a team notice email says: the team, and the person
// who joined it or handed it over.
type NoticePayload struct {
	TeamName   string `json:"team_name"`
	TeamSlug   string `json:"team_slug"`
	PersonName string `json:"person_name"`
}

// Mailer sends the team notice emails.
type Mailer interface {
	SendMemberJoined(ctx context.Context, recipient string, notice NoticePayload, idempotencyKey string) (string, error)
	SendOwnershipTransferred(ctx context.Context, recipient string, notice NoticePayload, idempotencyKey string) (string, error)
}

// ResendMailer sends team notice emails through Resend. Without an API key it
// logs instead of sending.
type ResendMailer struct {
	APIKey   string
	From     string
	Endpoint string
	SiteURL  string
	Client   *http.Client
	Logger   *slog.Logger
}

// SendMemberJoined tells a team's owner that someone joined the team and
// returns the provider message ID.
func (m *ResendMailer) SendMemberJoined(ctx context.Context, recipient string, notice NoticePayload, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, notice.PersonName+" joined "+notice.TeamName,
		memberJoinedMessage(notice, teamURL(m.SiteURL, notice.TeamSlug)), "team member joined", idempotencyKey)
}

// SendOwnershipTransferred tells a member that a team's owner made them the
// new owner and returns the provider message ID.
func (m *ResendMailer) SendOwnershipTransferred(ctx context.Context, recipient string, notice NoticePayload, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, "You're now the owner of "+notice.TeamName,
		ownershipTransferredMessage(notice, teamURL(m.SiteURL, notice.TeamSlug)), "team ownership transferred", idempotencyKey)
}

func memberJoinedMessage(notice NoticePayload, link string) emaillayout.Message {
	return emaillayout.Message{
		Preview:    notice.PersonName + " joined " + notice.TeamName + ".",
		Heading:    "New team member",
		Paragraphs: []string{notice.PersonName + " joined " + notice.TeamName + " on Campus Gaming Network."},
		Action:     &emaillayout.Action{Label: "View team", URL: link},
		Notes:      []string{"As the owner, you can make members captains or remove them from the team page."},
		Reason:     "You received this email because you own this team.",
	}
}

func ownershipTransferredMessage(notice NoticePayload, link string) emaillayout.Message {
	return emaillayout.Message{
		Preview:    notice.PersonName + " made you the owner of " + notice.TeamName + ".",
		Heading:    "You own a team",
		Paragraphs: []string{notice.PersonName + " made you the owner of " + notice.TeamName + " on Campus Gaming Network."},
		Action:     &emaillayout.Action{Label: "View team", URL: link},
		Notes:      []string{"The owner manages the team's members and captains, and hands the team to another member before leaving it."},
		Reason:     "You received this email because you are a member of this team.",
	}
}

func teamURL(siteURL string, slug string) string {
	return strings.TrimRight(siteURL, "/") + "/teams/" + url.PathEscape(slug)
}

// sendMessage renders message through the shared layout, as HTML and as
// plain text, and posts it to Resend.
func (m *ResendMailer) sendMessage(ctx context.Context, recipient, subject string, message emaillayout.Message, label, idempotencyKey string) (string, error) {
	htmlBody, err := emaillayout.HTML(message)
	if err != nil {
		return "", err
	}
	if m.APIKey == "" {
		if m.Logger != nil {
			m.Logger.Info("local team email", "kind", label)
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
		HTML:    htmlBody,
		Text:    emaillayout.Text(message),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode %s email: %w", label, err)
	}
	endpoint := strings.TrimSpace(m.Endpoint)
	if endpoint == "" {
		endpoint = "https://api.resend.com/emails"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create %s email request: %w", label, err)
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
		return "", fmt.Errorf("send %s email: %w", label, err)
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
		return "", fmt.Errorf("decode %s email response: %w", label, err)
	}
	if strings.TrimSpace(result.ID) == "" {
		return "", errors.New("resend team email response missing id")
	}
	return result.ID, nil
}
