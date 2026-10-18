package events

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaillayout"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type RSVPMailer interface {
	SendRSVPConfirmation(ctx context.Context, recipient string, event Event, idempotencyKey string) (string, error)
	SendCancellationNotification(ctx context.Context, recipient string, event Event, idempotencyKey string) (string, error)
	SendOrganizerInvite(ctx context.Context, recipient string, invite OrganizerInvitePayload, idempotencyKey string) (string, error)
}

type ResendMailer struct {
	APIKey   string
	From     string
	Endpoint string
	SiteURL  string
	Client   *http.Client
	Logger   *slog.Logger
	Now      func() time.Time
}

// SendRSVPConfirmation emails recipient a confirmation with a calendar
// invite and returns the provider message ID.
func (m *ResendMailer) SendRSVPConfirmation(ctx context.Context, recipient string, event Event, idempotencyKey string) (string, error) {
	eventLink := eventURL(m.SiteURL, event.Slug)
	ics := EventICS(event, eventLink, m.now())
	message := rsvpConfirmationMessage(event, eventLink)
	htmlBody, err := emaillayout.HTML(message)
	if err != nil {
		return "", err
	}
	if m.APIKey == "" {
		if m.Logger != nil {
			m.Logger.Info("local event rsvp confirmation",
				"event_id", event.ID,
			)
		}
		return "local-" + idempotencyKey, nil
	}

	payload := struct {
		From        string       `json:"from"`
		To          []string     `json:"to"`
		Subject     string       `json:"subject"`
		HTML        string       `json:"html"`
		Text        string       `json:"text"`
		Attachments []attachment `json:"attachments"`
	}{
		From:    m.From,
		To:      []string{recipient},
		Subject: "You're going to " + event.Title,
		HTML:    htmlBody,
		Text:    emaillayout.Text(message),
		Attachments: []attachment{
			{
				Filename:    safeICSFilename(event.Slug),
				Content:     base64.StdEncoding.EncodeToString([]byte(ics)),
				ContentType: "text/calendar; charset=utf-8; method=PUBLISH",
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode event rsvp email: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint(m.Endpoint), bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create event rsvp email request: %w", err)
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
		return "", fmt.Errorf("send event rsvp email: %w", err)
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
	return decodeProviderID(response.Body)
}

// SendCancellationNotification emails recipient that the event was cancelled
// and returns the provider message ID.
func (m *ResendMailer) SendCancellationNotification(ctx context.Context, recipient string, event Event, idempotencyKey string) (string, error) {
	if m.APIKey == "" {
		if m.Logger != nil {
			m.Logger.Info("local event cancellation notification",
				"event_id", event.ID,
			)
		}
		return "local-" + idempotencyKey, nil
	}
	return m.sendMessage(ctx, recipient, "Event cancelled: "+event.Title,
		cancellationMessage(event, strings.TrimRight(m.SiteURL, "/")+"/events"), "event cancellation", idempotencyKey)
}

// SendOrganizerInvite emails the link that accepts an invite to co-organize
// an event and returns the provider message ID.
func (m *ResendMailer) SendOrganizerInvite(ctx context.Context, recipient string, invite OrganizerInvitePayload, idempotencyKey string) (string, error) {
	if m.APIKey == "" {
		if m.Logger != nil {
			m.Logger.Info("local event organizer invite")
		}
		return "local-" + idempotencyKey, nil
	}
	link := strings.TrimRight(m.SiteURL, "/") + "/organizer-invite?token=" + url.QueryEscape(invite.Token)
	return m.sendMessage(ctx, recipient, "You're invited to co-organize an event on Campus Gaming Network",
		organizerInviteMessage(invite, link), "event organizer invite", idempotencyKey)
}

// sendMessage renders message through the shared layout, as HTML and as
// plain text, and posts it to Resend.
func (m *ResendMailer) sendMessage(ctx context.Context, recipient, subject string, message emaillayout.Message, label, idempotencyKey string) (string, error) {
	htmlBody, err := emaillayout.HTML(message)
	if err != nil {
		return "", err
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
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint(m.Endpoint), bytes.NewReader(body))
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
	return decodeProviderID(response.Body)
}

func resendEndpoint(configured string) string {
	if endpoint := strings.TrimSpace(configured); endpoint != "" {
		return endpoint
	}
	return "https://api.resend.com/emails"
}

func decodeProviderID(body io.Reader) (string, error) {
	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 2048)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode event email response: %w", err)
	}
	if strings.TrimSpace(result.ID) == "" {
		return "", errors.New("resend event email response missing id")
	}
	return result.ID, nil
}

type attachment struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	ContentType string `json:"content_type,omitempty"`
}

// EventICS renders event as an iCalendar document linking to eventURL.
func EventICS(event Event, eventURL string, now time.Time) string {
	lines := []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Campus Gaming Network//CGN//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		"UID:" + escapeICSText(event.ID+"@campusgamingnetwork.com"),
		"DTSTAMP:" + icsTime(now),
		"DTSTART:" + icsTime(event.StartsAt),
		"DTEND:" + icsTime(event.EndsAt),
		"SUMMARY:" + escapeICSText(event.Title),
		"DESCRIPTION:" + escapeICSText(icsDescription(event, eventURL)),
		"LOCATION:" + escapeICSText(icsLocation(event)),
		"URL:" + escapeICSText(eventURL),
		"END:VEVENT",
		"END:VCALENDAR",
	}

	return strings.Join(lines, "\r\n") + "\r\n"
}

func (m *ResendMailer) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

func rsvpConfirmationMessage(event Event, eventURL string) emaillayout.Message {
	// The event page shows the start in the event's time zone, so the email
	// does too. A payload without a usable zone falls back to UTC.
	location, err := time.LoadLocation(event.Timezone)
	if err != nil {
		location = time.UTC
	}
	details := []emaillayout.Detail{
		{Label: "When", Value: event.StartsAt.In(location).Format("Mon, Jan 2, 2006, 3:04 PM MST")},
		{Label: "Where", Value: icsLocation(event)},
	}
	if label := AudienceLabel(event.Audience); label != "" {
		details = append(details, emaillayout.Detail{Label: "Who it's for", Value: label})
	}
	return emaillayout.Message{
		Preview:    "Your RSVP is confirmed.",
		Heading:    "You're going to " + event.Title,
		Paragraphs: []string{"Your RSVP is confirmed. The attached invite adds the event to your calendar."},
		Details:    details,
		Action:     &emaillayout.Action{Label: "View event", URL: eventURL},
		Reason:     "You received this email because you RSVPed yes to this event.",
	}
}

func cancellationMessage(event Event, eventsURL string) emaillayout.Message {
	return emaillayout.Message{
		Preview:    event.Title + " was cancelled.",
		Heading:    "Event cancelled",
		Paragraphs: []string{event.Title + " has been cancelled by the organizer."},
		Action:     &emaillayout.Action{Label: "Find other events", URL: eventsURL},
		Reason:     "You received this email because you RSVPed to this event.",
	}
}

func organizerInviteMessage(invite OrganizerInvitePayload, link string) emaillayout.Message {
	event := "an event"
	if invite.EventTitle != "" {
		event = invite.EventTitle
	}
	return emaillayout.Message{
		Preview: invite.InviterName + " invited you to co-organize an event.",
		Heading: "You're invited to co-organize",
		Paragraphs: []string{
			invite.InviterName + " invited you to help organize " + event + " on Campus Gaming Network. Co-organizers can edit the event.",
		},
		Action: &emaillayout.Action{Label: "Accept the invitation", URL: link},
		Notes: []string{
			"Sign in with this email address to accept. The link expires in seven days.",
			"If you weren't expecting this, you can ignore it.",
		},
		Reason: "You received this email because an event organizer entered this address.",
	}
}

func eventURL(siteURL string, slug string) string {
	return strings.TrimRight(siteURL, "/") + "/events/" + slug
}

func icsDescription(event Event, eventURL string) string {
	parts := []string{event.Description}
	if label := AudienceLabel(event.Audience); label != "" {
		parts = append(parts, "Who it's for: "+label)
	}
	if eventURL != "" {
		parts = append(parts, "View event: "+eventURL)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

// AudienceLabel describes an event's audience for attendees. It returns an
// empty string for an event with no audience.
func AudienceLabel(audience string) string {
	switch audience {
	case AudienceOpen:
		return "Open to everyone"
	case AudienceCollegiate:
		return "College students"
	case AudienceCampus:
		return "Host campus only"
	case AudienceMembers:
		return "Members only"
	}
	return ""
}

func icsLocation(event Event) string {
	if event.Format == FormatOnline {
		if event.OnlineURL != "" {
			return "Online: " + event.OnlineURL
		}
		return "Online"
	}
	location := strings.TrimSpace(strings.Join(nonEmpty(event.LocationName, event.Address), ", "))
	if event.Format == FormatHybrid {
		if event.OnlineURL != "" {
			location = strings.TrimSpace(strings.Join(nonEmpty(location, "Online: "+event.OnlineURL), " + "))
		}
		if location == "" {
			return "Hybrid"
		}
	}
	return location
}

func icsTime(value time.Time) string {
	return value.UTC().Format("20060102T150405Z")
}

func escapeICSText(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\n", `\n`)
	value = strings.ReplaceAll(value, ";", `\;`)
	value = strings.ReplaceAll(value, ",", `\,`)
	return value
}

func safeICSFilename(slug string) string {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return "event.ics"
	}
	return slug + ".ics"
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
