package clubs

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaillayout"
)

func TestResendMailerSendsClaimDecisions(t *testing.T) {
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
	mailer := &ResendMailer{APIKey: "key", From: "CGN <notices@example.test>", Endpoint: server.URL, SiteURL: "https://cgn.example/"}

	if _, err := mailer.SendClaimApproved(t.Context(), "officer@example.test", DecisionPayload{ClubName: "Smash Club", SchoolName: "Fixture U", ClubSlug: "smash-club"}, "approved-key"); err != nil {
		t.Fatalf("SendClaimApproved() error = %v", err)
	}
	if _, err := mailer.SendClaimRejected(t.Context(), "officer@example.test", DecisionPayload{ClubName: "Chess Club", SchoolName: "Fixture U", Request: true}, "rejected-key"); err != nil {
		t.Fatalf("SendClaimRejected() error = %v", err)
	}

	approved := emaillayout.Message{
		Preview:    "You now manage Smash Club on Campus Gaming Network.",
		Heading:    "Your club is yours to manage",
		Paragraphs: []string{"Your claim for Smash Club at Fixture U was approved.", "You are the club's owner on Campus Gaming Network, and its page now says it is managed by the club."},
		Action:     &emaillayout.Action{Label: "View club", URL: "https://cgn.example/clubs/smash-club"},
		Reason:     "You received this email because you asked to manage this club.",
	}
	rejected := emaillayout.Message{
		Preview:    "Your request about Chess Club was not approved.",
		Heading:    "Not approved",
		Paragraphs: []string{"We could not confirm that you run Chess Club at Fixture U, so your request to add it was not approved."},
		Action:     &emaillayout.Action{Label: "Contact support", URL: "https://cgn.example/support?topic=club"},
		Notes:      []string{"If you can show that you are an officer, such as with an official club contact or your university's page for the club, contact support and include it."},
		Reason:     "You received this email because you asked to manage a club.",
	}
	render := func(message emaillayout.Message) string {
		t.Helper()
		body, err := emaillayout.HTML(message)
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		return body
	}
	want := []map[string]any{
		{"from": "CGN <notices@example.test>", "to": []any{"officer@example.test"}, "subject": "You now manage Smash Club", "html": render(approved), "text": emaillayout.Text(approved)},
		{"from": "CGN <notices@example.test>", "to": []any{"officer@example.test"}, "subject": "Your request to add Chess Club", "html": render(rejected), "text": emaillayout.Text(rejected)},
	}
	if !reflect.DeepEqual(bodies, want) {
		t.Fatalf("emails = %#v, want %#v", bodies, want)
	}
}

func TestResendMailerSendsOfficerEmails(t *testing.T) {
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
	mailer := &ResendMailer{APIKey: "key", From: "CGN <notices@example.test>", Endpoint: server.URL, SiteURL: "https://cgn.example/"}

	if _, err := mailer.SendEditorInvite(t.Context(), "editor@example.test", EditorInvitePayload{Token: "a b", ClubName: "Smash Club", InviterName: "Jo"}, "invite-key"); err != nil {
		t.Fatalf("SendEditorInvite() error = %v", err)
	}
	if _, err := mailer.SendOwnershipOffered(t.Context(), "member@example.test", OwnershipOfferPayload{ClubName: "Smash Club", ClubSlug: "smash-club", OwnerName: "Jo"}, "offer-key"); err != nil {
		t.Fatalf("SendOwnershipOffered() error = %v", err)
	}
	render := func(message emaillayout.Message) string {
		t.Helper()
		body, err := emaillayout.HTML(message)
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		return body
	}
	invite := editorInviteMessage(EditorInvitePayload{ClubName: "Smash Club", InviterName: "Jo"}, "https://cgn.example/club-editor-invite?token=a+b")
	offer := ownershipOfferedMessage(OwnershipOfferPayload{ClubName: "Smash Club", OwnerName: "Jo"}, "https://cgn.example/clubs/smash-club")
	want := []map[string]any{
		{"from": "CGN <notices@example.test>", "to": []any{"editor@example.test"}, "subject": "Help run Smash Club on Campus Gaming Network", "html": render(invite), "text": emaillayout.Text(invite)},
		{"from": "CGN <notices@example.test>", "to": []any{"member@example.test"}, "subject": "Jo offered you Smash Club", "html": render(offer), "text": emaillayout.Text(offer)},
	}
	if !reflect.DeepEqual(bodies, want) {
		t.Fatalf("emails = %#v, want %#v", bodies, want)
	}
}
