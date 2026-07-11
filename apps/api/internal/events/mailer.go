package events

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

type RSVPMailer interface {
	SendRSVPConfirmation(ctx context.Context, recipient string, event Event) error
}

type ResendMailer struct {
	APIKey  string
	From    string
	SiteURL string
	Client  *http.Client
	Logger  *slog.Logger
	Now     func() time.Time
}

func (m *ResendMailer) SendRSVPConfirmation(ctx context.Context, recipient string, event Event) error {
	eventLink := eventURL(m.SiteURL, event.Slug)
	ics := EventICS(event, eventLink, m.now())
	if m.APIKey == "" {
		if m.Logger != nil {
			m.Logger.Info("local event rsvp confirmation",
				"recipient", recipient,
				"event", event.Title,
				"url", eventLink,
				"ics", ics,
			)
		}
		return nil
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
		return fmt.Errorf("encode event rsvp email: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create event rsvp email request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+m.APIKey)
	request.Header.Set("Content-Type", "application/json")

	client := m.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("send event rsvp email: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("resend returned %s: %s", response.Status, strings.TrimSpace(string(detail)))
	}
	return nil
}

type attachment struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	ContentType string `json:"content_type,omitempty"`
}

func EventICS(event Event, eventURL string, now time.Time) string {
	lines := []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Campus Gaming Network//CGN MVP//EN",
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
	return fmt.Sprintf(
		`<h1>You're going to %s</h1><p>Your RSVP is confirmed.</p><p><strong>When:</strong> %s</p><p><strong>Where:</strong> %s</p><p><a href="%s">View event details</a></p>`,
		html.EscapeString(event.Title),
		html.EscapeString(event.StartsAt.Format(time.RFC1123)),
		html.EscapeString(icsLocation(event)),
		html.EscapeString(eventURL),
	)
}

func eventURL(siteURL string, slug string) string {
	return strings.TrimRight(siteURL, "/") + "/events/" + slug
}

func icsDescription(event Event, eventURL string) string {
	parts := []string{event.Description}
	if eventURL != "" {
		parts = append(parts, "View event: "+eventURL)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
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
