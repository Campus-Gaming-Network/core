package teams

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaillayout"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

func TestResendMailerSendsTeamNotices(t *testing.T) {
	var bodies []map[string]any
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode email: %v", err)
		}
		bodies = append(bodies, body)
		keys = append(keys, r.Header.Get("Idempotency-Key"))
		_, _ = w.Write([]byte(`{"id":"provider-id"}`))
	}))
	t.Cleanup(server.Close)
	mailer := &ResendMailer{APIKey: "key", From: "CGN <notices@example.test>", Endpoint: server.URL, SiteURL: "https://cgn.example/"}
	notice := NoticePayload{TeamName: "Night <Owls>", TeamSlug: "night-owls", PersonName: "Jo & Al"}

	if _, err := mailer.SendMemberJoined(t.Context(), "owner@example.test", notice, "joined-key"); err != nil {
		t.Fatalf("SendMemberJoined() error = %v", err)
	}
	if _, err := mailer.SendOwnershipTransferred(t.Context(), "member@example.test", notice, "transferred-key"); err != nil {
		t.Fatalf("SendOwnershipTransferred() error = %v", err)
	}

	render := func(message emaillayout.Message) string {
		t.Helper()
		body, err := emaillayout.HTML(message)
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		return body
	}
	action := &emaillayout.Action{Label: "View team", URL: "https://cgn.example/teams/night-owls"}
	joined := emaillayout.Message{
		Preview:    "Jo & Al joined Night <Owls>.",
		Heading:    "New team member",
		Paragraphs: []string{"Jo & Al joined Night <Owls> on Campus Gaming Network."},
		Action:     action,
		Notes:      []string{"As the owner, you can make members captains or remove them from the team page."},
		Reason:     "You received this email because you own this team.",
	}
	transferred := emaillayout.Message{
		Preview:    "Jo & Al made you the owner of Night <Owls>.",
		Heading:    "You own a team",
		Paragraphs: []string{"Jo & Al made you the owner of Night <Owls> on Campus Gaming Network."},
		Action:     action,
		Notes:      []string{"The owner manages the team's members and captains, and hands the team to another member before leaving it."},
		Reason:     "You received this email because you are a member of this team.",
	}
	want := []map[string]any{
		{"from": "CGN <notices@example.test>", "to": []any{"owner@example.test"}, "subject": "Jo & Al joined Night <Owls>", "html": render(joined), "text": emaillayout.Text(joined)},
		{"from": "CGN <notices@example.test>", "to": []any{"member@example.test"}, "subject": "You're now the owner of Night <Owls>", "html": render(transferred), "text": emaillayout.Text(transferred)},
	}
	if !reflect.DeepEqual(bodies, want) {
		t.Fatalf("emails = %#v, want %#v", bodies, want)
	}
	if want := []string{"joined-key", "transferred-key"}; !reflect.DeepEqual(keys, want) {
		t.Fatalf("idempotency keys = %v, want %v", keys, want)
	}
}

func TestResendMailerReturnsTypedNonSuccessResponseForTeamNotices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad sender", http.StatusUnprocessableEntity)
	}))
	t.Cleanup(server.Close)
	mailer := &ResendMailer{APIKey: "key", From: "notices@example.test", Endpoint: server.URL, SiteURL: "https://cgn.example"}

	_, err := mailer.SendMemberJoined(t.Context(), "owner@example.test", NoticePayload{TeamName: "T", TeamSlug: "t", PersonName: "P"}, "key")
	var responseError *mailhttp.ResponseError
	if !errors.As(err, &responseError) || responseError.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("error = %v, want a 422 response error", err)
	}
}
