package clubs

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

// DecisionPayload is what a claim decision email says. It never carries the
// evidence or the review note.
type DecisionPayload struct {
	ClubName   string `json:"club_name"`
	SchoolName string `json:"school_name"`
	// ClubSlug is set when the claim is approved, for the link to the page.
	ClubSlug string `json:"club_slug,omitempty"`
	// Request is true for a request to add a club rather than a claim.
	Request bool `json:"request"`
}

// Mailer sends the claim decision emails.
type Mailer interface {
	SendClaimApproved(ctx context.Context, recipient string, decision DecisionPayload, idempotencyKey string) (string, error)
	SendClaimRejected(ctx context.Context, recipient string, decision DecisionPayload, idempotencyKey string) (string, error)
}

// ResendMailer sends club emails through Resend. Without an API key it logs
// instead of sending.
type ResendMailer struct {
	APIKey   string
	From     string
	Endpoint string
	SiteURL  string
	Client   *http.Client
	Logger   *slog.Logger
}

// SendClaimApproved tells an applicant they now manage the club and returns
// the provider message ID.
func (m *ResendMailer) SendClaimApproved(ctx context.Context, recipient string, decision DecisionPayload, idempotencyKey string) (string, error) {
	return m.sendMessage(ctx, recipient, "You now manage "+decision.ClubName,
		claimApprovedMessage(decision, strings.TrimRight(m.SiteURL, "/")+"/clubs/"+url.PathEscape(decision.ClubSlug)),
		"club claim approved", idempotencyKey)
}

// SendClaimRejected tells an applicant their claim or request was not
// approved and returns the provider message ID.
func (m *ResendMailer) SendClaimRejected(ctx context.Context, recipient string, decision DecisionPayload, idempotencyKey string) (string, error) {
	subject := "Your claim for " + decision.ClubName
	if decision.Request {
		subject = "Your request to add " + decision.ClubName
	}
	return m.sendMessage(ctx, recipient, subject,
		claimRejectedMessage(decision, strings.TrimRight(m.SiteURL, "/")+"/support?topic=club"),
		"club claim rejected", idempotencyKey)
}

func claimApprovedMessage(decision DecisionPayload, link string) emaillayout.Message {
	opening := "Your claim for " + decision.ClubName + " at " + decision.SchoolName + " was approved."
	if decision.Request {
		opening = "Your request to add " + decision.ClubName + " at " + decision.SchoolName + " was approved, and the club now has a page."
	}
	return emaillayout.Message{
		Preview:    "You now manage " + decision.ClubName + " on Campus Gaming Network.",
		Heading:    "Your club is yours to manage",
		Paragraphs: []string{opening, "You are the club's owner on Campus Gaming Network, and its page now says it is managed by the club."},
		Action:     &emaillayout.Action{Label: "View club", URL: link},
		Reason:     "You received this email because you asked to manage this club.",
	}
}

func claimRejectedMessage(decision DecisionPayload, link string) emaillayout.Message {
	opening := "We could not confirm that you run " + decision.ClubName + " at " + decision.SchoolName + ", so your claim was not approved."
	if decision.Request {
		opening = "We could not confirm that you run " + decision.ClubName + " at " + decision.SchoolName + ", so your request to add it was not approved."
	}
	return emaillayout.Message{
		Preview:    "Your request about " + decision.ClubName + " was not approved.",
		Heading:    "Not approved",
		Paragraphs: []string{opening},
		Action:     &emaillayout.Action{Label: "Contact support", URL: link},
		Notes:      []string{"If you can show that you are an officer, such as with an official club contact or your university's page for the club, contact support and include it."},
		Reason:     "You received this email because you asked to manage a club.",
	}
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
			m.Logger.Info("local club email", "kind", label)
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
		return "", errors.New("resend club email response missing id")
	}
	return result.ID, nil
}
