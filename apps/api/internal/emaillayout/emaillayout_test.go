package emaillayout

import (
	"os"
	"strings"
	"testing"
)

var fullMessage = Message{
	Preview:    "Preview line",
	Heading:    "You're going to <Smash> & Friends",
	Paragraphs: []string{"First paragraph with \"quotes\".", "Second paragraph."},
	Details:    []Detail{{Label: "When", Value: "Sat, Aug 15, 2026, 1:00 PM PDT"}, {Label: "Where", Value: "Room <1>"}},
	Action:     &Action{Label: "View event", URL: "https://cgn.example/events/a?b=1&c=\"2\""},
	Notes:      []string{"A note."},
	Reason:     "You received this email because you RSVPed.",
}

// The full layout is pinned by a reviewed file, so any change to the markup
// every email shares shows up in review.
func TestHTMLRendersTheSharedLayout(t *testing.T) {
	got, err := HTML(fullMessage)
	if err != nil {
		t.Fatalf("HTML() error = %v", err)
	}
	want, err := os.ReadFile("testdata/full.html")
	if err != nil {
		t.Fatalf("read golden file: %v", err)
	}
	if got != string(want) {
		t.Fatalf("HTML() =\n%s\nwant testdata/full.html", got)
	}
}

func TestHTMLEscapesValuesAndLoadsNothingRemote(t *testing.T) {
	got, err := HTML(fullMessage)
	if err != nil {
		t.Fatalf("HTML() error = %v", err)
	}
	for _, unescaped := range []string{"<Smash>", "Room <1>", `"quotes"`, `c="2"`} {
		if strings.Contains(got, unescaped) {
			t.Fatalf("HTML() contains unescaped %q", unescaped)
		}
	}
	for _, remote := range []string{"<img", " src=", "@import", "url("} {
		if strings.Contains(got, remote) {
			t.Fatalf("HTML() loads remote content with %q", remote)
		}
	}
	for _, url := range []string{"javascript:alert(1)", "data:text/html,hi", "/relative"} {
		if _, err := HTML(Message{Heading: "H", Action: &Action{Label: "Go", URL: url}}); err == nil {
			t.Fatalf("HTML() with action %q error = nil, want refused", url)
		}
	}
}

func TestTextRendersEveryPartInOrder(t *testing.T) {
	want := "You're going to <Smash> & Friends\n\n" +
		"First paragraph with \"quotes\".\n\n" +
		"Second paragraph.\n\n" +
		"When: Sat, Aug 15, 2026, 1:00 PM PDT\n" +
		"Where: Room <1>\n\n" +
		"View event: https://cgn.example/events/a?b=1&c=\"2\"\n\n" +
		"A note.\n\n" +
		"--\nYou received this email because you RSVPed.\nCampus Gaming Network\n"
	if got := Text(fullMessage); got != want {
		t.Fatalf("Text() =\n%q\nwant\n%q", got, want)
	}
}
