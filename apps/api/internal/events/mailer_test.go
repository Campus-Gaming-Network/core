package events

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaillayout"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type eventRoundTripFunc func(*http.Request) (*http.Response, error)

func (f eventRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestEventResendMailerHonorsContextDeadline(t *testing.T) {
	mailer := &ResendMailer{
		APIKey:  "resend-api-key",
		SiteURL: "https://campusgamingnetwork.com",
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
		APIKey:  "resend-api-key",
		SiteURL: "https://campusgamingnetwork.com",
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

func TestEventICSEscapesAndFoldsEventDetails(t *testing.T) {
	event := Event{
		ID:           "event-1",
		Title:        "Rocket League, Finals",
		Slug:         "rocket-league-finals",
		Description:  "Bring your squad;\ncheck in early.",
		Format:       FormatHybrid,
		Audience:     AudienceCampus,
		StartsAt:     time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:       time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		LocationName: "Student Union",
		Address:      "1 Campus Way",
		OnlineURL:    "https://meet.example.test/event",
		Revision:     3,
		UpdatedAt:    time.Date(2026, 8, 2, 9, 30, 0, 0, time.UTC),
	}

	got := EventICS(event, "https://campusgamingnetwork.com/events/rocket-league-finals", time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC))

	want := strings.Join([]string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Campus Gaming Network//CGN//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		"UID:event-1@campusgamingnetwork.com",
		"DTSTAMP:20260801T120000Z",
		"DTSTART:20260815T200000Z",
		"DTEND:20260815T220000Z",
		"LAST-MODIFIED:20260802T093000Z",
		"SEQUENCE:3",
		"STATUS:CONFIRMED",
		"TRANSP:OPAQUE",
		"SUMMARY:Rocket League\\, Finals",
		"DESCRIPTION:Bring your squad\\;\\ncheck in early.\\n\\nWho it's for: Host campu",
		" s only\\n\\nView event: https://campusgamingnetwork.com/events/rocket-league",
		" -finals",
		"LOCATION:Student Union\\, 1 Campus Way + Online: https://meet.example.test/e",
		" vent",
		"URL:https://campusgamingnetwork.com/events/rocket-league-finals",
		"END:VEVENT",
		"END:VCALENDAR",
	}, "\r\n") + "\r\n"
	if got != want {
		t.Fatalf("EventICS() =\n%s\nwant\n%s", got, want)
	}
}

func TestResendMailerSendsRSVPConfirmationWithCalendarAttachment(t *testing.T) {
	type resendPayload struct {
		From        string       `json:"from"`
		To          []string     `json:"to"`
		Subject     string       `json:"subject"`
		HTML        string       `json:"html"`
		Text        string       `json:"text"`
		Attachments []attachment `json:"attachments"`
	}

	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	event := Event{
		ID:           "event-1",
		Title:        "Rocket League Finals",
		Slug:         "rocket-league-finals",
		Description:  "Bring your squad.",
		Format:       FormatInPerson,
		Audience:     AudienceMembers,
		StartsAt:     time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:       time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		Timezone:     "America/Los_Angeles",
		LocationName: "Student Union",
	}

	var payload resendPayload
	var idempotencyKey string
	mailer := &ResendMailer{
		APIKey:   "resend-api-key",
		From:     "events@campusgamingnetwork.com",
		Endpoint: "https://mail.stub.test/emails",
		SiteURL:  "https://campusgamingnetwork.com/",
		Now:      func() time.Time { return now },
		Client: &http.Client{Transport: eventRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", request.Method)
			}
			if request.URL.String() != "https://mail.stub.test/emails" {
				t.Fatalf("URL = %q, want configured email endpoint", request.URL)
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
	// The start is shown in the event's own time zone.
	message := emaillayout.Message{
		Preview:    "Your RSVP is confirmed.",
		Heading:    "You're going to Rocket League Finals",
		Paragraphs: []string{"Your RSVP is confirmed. The attached invite adds the event to your calendar."},
		Details: []emaillayout.Detail{
			{Label: "When", Value: "Sat, Aug 15, 2026, 1:00 PM PDT"},
			{Label: "Where", Value: "Student Union"},
			{Label: "Who it's for", Value: "Members only"},
		},
		Action: &emaillayout.Action{Label: "View event", URL: "https://campusgamingnetwork.com/events/rocket-league-finals"},
		Reason: "You received this email because you RSVPed yes to this event.",
	}
	if got := rsvpConfirmationMessage(event, "https://campusgamingnetwork.com/events/rocket-league-finals"); !reflect.DeepEqual(got, message) {
		t.Fatalf("RSVP message = %+v, want %+v", got, message)
	}
	wantHTML, err := emaillayout.HTML(message)
	if err != nil {
		t.Fatalf("render RSVP email: %v", err)
	}
	if payload.HTML != wantHTML || payload.Text != emaillayout.Text(message) {
		t.Fatalf("RSVP email = %q / %q, want the shared layout", payload.HTML, payload.Text)
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

func TestEventCancellationMessage(t *testing.T) {
	want := emaillayout.Message{
		Preview:    "Smash <Night> was cancelled.",
		Heading:    "Event cancelled",
		Paragraphs: []string{"Smash <Night> has been cancelled by the organizer."},
		Action:     &emaillayout.Action{Label: "Find other events", URL: "https://campusgamingnetwork.com/events"},
		Reason:     "You received this email because you RSVPed to this event.",
	}
	if got := cancellationMessage(Event{Title: "Smash <Night>"}, "https://campusgamingnetwork.com/events"); !reflect.DeepEqual(got, want) {
		t.Fatalf("cancellation message = %+v, want %+v", got, want)
	}
}

func TestResendMailerSendsOrganizerInvites(t *testing.T) {
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode email: %v", err)
		}
		bodies = append(bodies, body)
		_, _ = w.Write([]byte(`{"id":"provider-id"}`))
	}))
	t.Cleanup(server.Close)
	mailer := &ResendMailer{APIKey: "key", From: "CGN <hi@example.test>", Endpoint: server.URL, SiteURL: "https://cgn.example/"}

	for _, invite := range []OrganizerInvitePayload{
		{Token: "a+b", EventTitle: "Smash <Night>", InviterName: "Ana & Bo"},
		{Token: "c", InviterName: "Ana"},
	} {
		if _, err := mailer.SendOrganizerInvite(t.Context(), "guest@example.test", invite, "key-"+invite.Token); err != nil {
			t.Fatalf("SendOrganizerInvite() error = %v", err)
		}
	}

	render := func(message emaillayout.Message) string {
		t.Helper()
		body, err := emaillayout.HTML(message)
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		return body
	}
	subject := "You're invited to co-organize an event on Campus Gaming Network"
	notes := []string{
		"Sign in with this email address to accept. The link expires in seven days.",
		"If you weren't expecting this, you can ignore it.",
	}
	reason := "You received this email because an event organizer entered this address."
	titled := emaillayout.Message{
		Preview:    "Ana & Bo invited you to co-organize an event.",
		Heading:    "You're invited to co-organize",
		Paragraphs: []string{"Ana & Bo invited you to help organize Smash <Night> on Campus Gaming Network. Co-organizers can edit the event."},
		Action:     &emaillayout.Action{Label: "Accept the invitation", URL: "https://cgn.example/organizer-invite?token=a%2Bb"},
		Notes:      notes,
		Reason:     reason,
	}
	untitled := emaillayout.Message{
		Preview:    "Ana invited you to co-organize an event.",
		Heading:    "You're invited to co-organize",
		Paragraphs: []string{"Ana invited you to help organize an event on Campus Gaming Network. Co-organizers can edit the event."},
		Action:     &emaillayout.Action{Label: "Accept the invitation", URL: "https://cgn.example/organizer-invite?token=c"},
		Notes:      notes,
		Reason:     reason,
	}
	want := []map[string]any{
		{"from": "CGN <hi@example.test>", "to": []any{"guest@example.test"}, "subject": subject, "html": render(titled), "text": emaillayout.Text(titled)},
		{"from": "CGN <hi@example.test>", "to": []any{"guest@example.test"}, "subject": subject, "html": render(untitled), "text": emaillayout.Text(untitled)},
	}
	if !reflect.DeepEqual(bodies, want) {
		t.Fatalf("emails = %#v\nwant %#v", bodies, want)
	}
}

// The RSVP attachment and the web export render the same event to the same
// file in every state, so either replaces the other in a calendar: editing
// raises SEQUENCE, and cancelling raises it again and marks it cancelled.
func TestEventICSMatchesTheSharedCalendarFixtures(t *testing.T) {
	now := time.Date(2037, time.February, 1, 12, 0, 0, 0, time.UTC)
	for _, state := range []string{"created", "edited", "cancelled"} {
		encoded, err := os.ReadFile(filepath.Join("testdata", "calendar", state+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var event Event
		if err := json.Unmarshal(encoded, &event); err != nil {
			t.Fatalf("decode %s: %v", state, err)
		}
		want, err := os.ReadFile(filepath.Join("testdata", "calendar", state+".ics"))
		if err != nil {
			t.Fatal(err)
		}
		if got := EventICS(event, "https://cgn.test/events/"+event.Slug, now); got != string(want) {
			t.Errorf("EventICS(%s) =\n%s\nwant\n%s", state, got, want)
		}
	}
}
