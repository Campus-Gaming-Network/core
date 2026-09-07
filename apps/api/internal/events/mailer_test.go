package events

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type eventRoundTripFunc func(*http.Request) (*http.Response, error)

func (f eventRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestEventResendMailerHonorsContextDeadline(t *testing.T) {
	mailer := &ResendMailer{
		APIKey: "resend-api-key",
		Client: &http.Client{Transport: eventRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		})},
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()

	_, err := mailer.SendCancellationNotification(ctx, "player@example.com", Event{
		ID: "event-1", Title: "Event", Slug: "event",
	}, "cancellation-key")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("SendCancellationNotification() error = %v, want context deadline exceeded", err)
	}
}

func TestEventResendMailerReturnsTypedNonSuccessResponse(t *testing.T) {
	mailer := &ResendMailer{
		APIKey: "resend-api-key",
		Client: &http.Client{Transport: eventRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusTooManyRequests,
				Status:     "429 Too Many Requests",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"message":"retry later"}`)),
			}, nil
		})},
	}

	_, err := mailer.SendRSVPConfirmation(t.Context(), "player@example.com", Event{
		ID: "event-1", Title: "Event", Slug: "event",
	}, "rsvp-key")
	var responseError *mailhttp.ResponseError
	if !errors.As(err, &responseError) {
		t.Fatalf("SendRSVPConfirmation() error = %v, want *mailhttp.ResponseError", err)
	}
	if responseError.Permanent() {
		t.Fatalf("response error status = %d, want transient rate limit", responseError.StatusCode)
	}
}

func TestEventICSIncludesEscapedEventDetails(t *testing.T) {
	event := Event{
		ID:           "event-1",
		Title:        "Rocket League, Finals",
		Slug:         "rocket-league-finals",
		Description:  "Bring your squad;\ncheck in early.",
		Format:       FormatHybrid,
		StartsAt:     time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:       time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		LocationName: "Student Union",
		Address:      "1 Campus Way",
		OnlineURL:    "https://meet.example.test/event",
	}

	ics := EventICS(event, "https://campusgamingnetwork.com/events/rocket-league-finals", time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC))

	for _, want := range []string{
		"BEGIN:VCALENDAR\r\n",
		"BEGIN:VEVENT\r\n",
		"DTSTAMP:20260801T120000Z\r\n",
		"DTSTART:20260815T200000Z\r\n",
		"DTEND:20260815T220000Z\r\n",
		"SUMMARY:Rocket League\\, Finals\r\n",
		"DESCRIPTION:Bring your squad\\;\\ncheck in early.",
		"LOCATION:Student Union\\, 1 Campus Way + Online: https://meet.example.test/event\r\n",
		"URL:https://campusgamingnetwork.com/events/rocket-league-finals\r\n",
		"END:VEVENT\r\n",
		"END:VCALENDAR\r\n",
	} {
		if !strings.Contains(ics, want) {
			t.Fatalf("ICS missing %q:\n%s", want, ics)
		}
	}
}

func TestResendMailerSendsRSVPConfirmationWithCalendarAttachment(t *testing.T) {
	type resendPayload struct {
		From        string       `json:"from"`
		To          []string     `json:"to"`
		Subject     string       `json:"subject"`
		HTML        string       `json:"html"`
		Attachments []attachment `json:"attachments"`
	}

	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	event := Event{
		ID:           "event-1",
		Title:        "Rocket League Finals",
		Slug:         "rocket-league-finals",
		Description:  "Bring your squad.",
		Format:       FormatInPerson,
		StartsAt:     time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:       time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		LocationName: "Student Union",
	}

	var payload resendPayload
	var idempotencyKey string
	mailer := &ResendMailer{
		APIKey:  "resend-api-key",
		From:    "events@campusgamingnetwork.com",
		SiteURL: "https://campusgamingnetwork.com/",
		Now:     func() time.Time { return now },
		Client: &http.Client{Transport: eventRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", request.Method)
			}
			if request.URL.String() != "https://api.resend.com/emails" {
				t.Fatalf("URL = %q, want Resend email endpoint", request.URL)
			}
			if authorization := request.Header.Get("Authorization"); authorization != "Bearer resend-api-key" {
				t.Fatalf("Authorization = %q, want bearer API key", authorization)
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

	providerID, err := mailer.SendRSVPConfirmation(context.Background(), "player@example.com", event, "rsvp-idempotency-key")
	if err != nil {
		t.Fatalf("SendRSVPConfirmation() error = %v", err)
	}
	if providerID != "provider-message-1" {
		t.Fatalf("provider ID = %q, want provider-message-1", providerID)
	}
	if idempotencyKey != "rsvp-idempotency-key" {
		t.Fatalf("Idempotency-Key = %q, want rsvp-idempotency-key", idempotencyKey)
	}
	if payload.From != "events@campusgamingnetwork.com" {
		t.Fatalf("from = %q, want configured event sender", payload.From)
	}
	if len(payload.To) != 1 || payload.To[0] != "player@example.com" {
		t.Fatalf("to = %v, want player@example.com", payload.To)
	}
	if payload.Subject != "You're going to Rocket League Finals" {
		t.Fatalf("subject = %q, want RSVP confirmation subject", payload.Subject)
	}
	if !strings.Contains(payload.HTML, "Your RSVP is confirmed.") {
		t.Fatalf("HTML = %q, want RSVP confirmation copy", payload.HTML)
	}
	if len(payload.Attachments) != 1 {
		t.Fatalf("attachments = %d, want one calendar attachment", len(payload.Attachments))
	}
	calendar := payload.Attachments[0]
	if calendar.Filename != "rocket-league-finals.ics" {
		t.Fatalf("attachment filename = %q, want slug-based ICS filename", calendar.Filename)
	}
	if calendar.ContentType != "text/calendar; charset=utf-8; method=PUBLISH" {
		t.Fatalf("attachment content type = %q, want calendar MIME type", calendar.ContentType)
	}
	decoded, err := base64.StdEncoding.DecodeString(calendar.Content)
	if err != nil {
		t.Fatalf("decode calendar attachment: %v", err)
	}
	wantICS := EventICS(event, "https://campusgamingnetwork.com/events/rocket-league-finals", now)
	if string(decoded) != wantICS {
		t.Fatalf("calendar attachment = %q, want generated event ICS %q", decoded, wantICS)
	}
}

func TestEventURLTrimsTrailingSlash(t *testing.T) {
	if got := eventURL("https://campusgamingnetwork.com/", "campus-scrim-night"); got != "https://campusgamingnetwork.com/events/campus-scrim-night" {
		t.Fatalf("eventURL() = %q", got)
	}
}

func TestEventCancellationHTMLEscapesDetails(t *testing.T) {
	html := eventCancellationHTML(
		Event{Title: "Smash <Night>"},
		"https://campusgamingnetwork.com/events/smash-night",
	)
	if strings.Contains(html, "<Night>") || !strings.Contains(html, "Smash &lt;Night&gt;") {
		t.Fatalf("cancellation HTML = %q, want escaped title", html)
	}
	if !strings.Contains(html, "Event cancelled") || strings.Contains(html, "You're going to") {
		t.Fatalf("cancellation HTML = %q, want cancellation copy", html)
	}
}
