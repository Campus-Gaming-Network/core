package events

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

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
		Attachments []attachment `json:"attachments"`
	}{
		From:    m.From,
		To:      []string{recipient},
		Subject: "You're going to " + event.Title,
		HTML:    eventConfirmationHTML(event, eventLink),
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
	return m.sendHTML(ctx, recipient, "Event cancelled: "+event.Title,
		eventCancellationHTML(event, eventURL(m.SiteURL, event.Slug)), "event cancellation", idempotencyKey)
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
	return m.sendHTML(ctx, recipient, "You're invited to co-organize an event on Campus Gaming Network",
		organizerInviteHTML(invite, link), "event organizer invite", idempotencyKey)
}

// sendHTML posts one HTML email to Resend.
func (m *ResendMailer) sendHTML(ctx context.Context, recipient, subject, htmlBody, label, idempotencyKey string) (string, error) {
	payload := struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
	}{
		From:    m.From,
		To:      []string{recipient},
		Subject: subject,
		HTML:    htmlBody,
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

func eventConfirmationHTML(event Event, eventURL string) string {
	audienceHTML := ""
	if label := AudienceLabel(event.Audience); label != "" {
		audienceHTML = "<p><strong>Who it's for:</strong> " + html.EscapeString(label) + "</p>"
	}
	// The event page shows the start in the event's time zone, so the email
	// does too. A payload without a usable zone falls back to UTC.
	location, err := time.LoadLocation(event.Timezone)
	if err != nil {
		location = time.UTC
	}
	return fmt.Sprintf(
		`<h1>You're going to %s</h1><p>Your RSVP is confirmed.</p><p><strong>When:</strong> %s</p><p><strong>Where:</strong> %s</p>%s<p><a href="%s">View event details</a></p>`,
		html.EscapeString(event.Title),
		html.EscapeString(event.StartsAt.In(location).Format("Mon, Jan 2, 2006, 3:04 PM MST")),
		html.EscapeString(icsLocation(event)),
		audienceHTML,
		html.EscapeString(eventURL),
	)
}

func eventCancellationHTML(event Event, eventURL string) string {
	return fmt.Sprintf(
		`<h1>Event cancelled</h1><p><strong>%s</strong> has been cancelled by the organizer.</p><p><a href="%s">View event details</a></p>`,
		html.EscapeString(event.Title),
		html.EscapeString(eventURL),
	)
}

func organizerInviteHTML(invite OrganizerInvitePayload, link string) string {
	event := "an event"
	if invite.EventTitle != "" {
		event = "<strong>" + html.EscapeString(invite.EventTitle) + "</strong>"
	}
	return fmt.Sprintf(
		`<h1>You're invited to co-organize</h1><p>%s invited you to help organize %s on Campus Gaming Network. Co-organizers can edit the event.</p>`+
			`<p><a href="%s">Accept the invitation</a></p>`+
			`<p>Sign in with this email address to accept. The link expires in seven days. If you weren't expecting this, you can ignore it.</p>`,
		html.EscapeString(invite.InviterName), event, html.EscapeString(link),
	)
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
