package events

import (
	"strings"
	"testing"
	"time"
)

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
