package emaildelivery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
)

type accountMailerStub struct {
	err    error
	called int
	// sent names each call as method:recipient:token.
	sent []string
}

func (m *accountMailerStub) SendVerification(context.Context, string, string, string) (string, error) {
	m.called++
	return "", m.err
}

func (m *accountMailerStub) SendPasswordReset(context.Context, string, string, string) (string, error) {
	m.called++
	return "", m.err
}

func (m *accountMailerStub) SendEmailChangeVerification(_ context.Context, recipient string, token string, _ string) (string, error) {
	m.called++
	m.sent = append(m.sent, "change:"+recipient+":"+token)
	return "", m.err
}

func (m *accountMailerStub) SendEmailChangedNotice(_ context.Context, recipient string, _ string) (string, error) {
	m.called++
	m.sent = append(m.sent, "notice:"+recipient)
	return "", m.err
}

func TestDispatcherSendsEmailChangeMessages(t *testing.T) {
	mailer := &accountMailerStub{}
	dispatcher := &Dispatcher{Account: mailer}
	for _, message := range []emailoutbox.Message{
		{Kind: emailoutbox.KindEmailChangeVerification, Recipient: "new@example.com", IdempotencyKey: "change-key", Payload: json.RawMessage(`{"token":"change-secret","user_id":"user-1"}`)},
		{Kind: emailoutbox.KindEmailChangedNotice, Recipient: "old@example.com", IdempotencyKey: "notice-key", Payload: json.RawMessage(`{"user_id":"user-1"}`)},
	} {
		if _, err := dispatcher.Send(t.Context(), message); err != nil {
			t.Fatalf("Send(%s) error = %v", message.Kind, err)
		}
	}
	// A confirmation link without a token is unusable, so it is quarantined.
	_, err := dispatcher.Send(t.Context(), emailoutbox.Message{
		Kind: emailoutbox.KindEmailChangeVerification, Recipient: "new@example.com", IdempotencyKey: "empty-key", Payload: json.RawMessage(`{"token":""}`),
	})
	if !emailoutbox.IsPermanent(err) {
		t.Fatalf("Send(empty token) error = %v, want permanent", err)
	}
	if want := []string{"change:new@example.com:change-secret", "notice:old@example.com"}; !reflect.DeepEqual(mailer.sent, want) {
		t.Fatalf("sent = %v, want %v", mailer.sent, want)
	}
}

func TestDispatcherQuarantinesMalformedPayloadWithoutCallingProvider(t *testing.T) {
	mailer := &accountMailerStub{}
	dispatcher := &Dispatcher{Account: mailer}
	_, err := dispatcher.Send(t.Context(), emailoutbox.Message{
		Kind:           emailoutbox.KindAccountVerification,
		Recipient:      "player@example.com",
		IdempotencyKey: "verification-key",
		Payload:        json.RawMessage(`{"token":""}`),
	})
	if !emailoutbox.IsPermanent(err) {
		t.Fatalf("Send() error = %v, want permanent malformed-payload error", err)
	}
	if mailer.called != 0 {
		t.Fatalf("provider calls = %d, want 0", mailer.called)
	}
}

func TestDispatcherClassifiesProviderResponses(t *testing.T) {
	for _, test := range []struct {
		name          string
		status        int
		wantPermanent bool
	}{
		{name: "recipient rejected", status: http.StatusUnprocessableEntity, wantPermanent: true},
		{name: "rate limited", status: http.StatusTooManyRequests, wantPermanent: false},
		{name: "provider unavailable", status: http.StatusServiceUnavailable, wantPermanent: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			providerError := &mailhttp.ResponseError{StatusCode: test.status, Status: http.StatusText(test.status)}
			dispatcher := &Dispatcher{Account: &accountMailerStub{err: providerError}}
			_, err := dispatcher.Send(t.Context(), emailoutbox.Message{
				Kind:           emailoutbox.KindPasswordReset,
				Recipient:      "player@example.com",
				IdempotencyKey: "reset-key",
				Payload:        json.RawMessage(`{"token":"reset-secret"}`),
			})
			if !errors.Is(err, providerError) {
				t.Fatalf("Send() error = %v, want provider error", err)
			}
			if emailoutbox.IsPermanent(err) != test.wantPermanent {
				t.Fatalf("permanent = %v, want %v", emailoutbox.IsPermanent(err), test.wantPermanent)
			}
		})
	}
}

type eventMailerStub struct {
	sent []eventstore.OrganizerInvitePayload
}

func (m *eventMailerStub) SendRSVPConfirmation(context.Context, string, eventstore.Event, string) (string, error) {
	return "", nil
}

func (m *eventMailerStub) SendCancellationNotification(context.Context, string, eventstore.Event, string) (string, error) {
	return "", nil
}

func (m *eventMailerStub) SendOrganizerInvite(_ context.Context, _ string, invite eventstore.OrganizerInvitePayload, _ string) (string, error) {
	m.sent = append(m.sent, invite)
	return "", nil
}

func TestDispatcherSendsOrganizerInvitesAndQuarantinesBadOnes(t *testing.T) {
	mailer := &eventMailerStub{}
	dispatcher := &Dispatcher{Events: mailer}
	send := func(payload string) error {
		_, err := dispatcher.Send(t.Context(), emailoutbox.Message{
			Kind: emailoutbox.KindOrganizerInvite, Recipient: "guest@example.com", IdempotencyKey: "invite-key", Payload: json.RawMessage(payload),
		})
		return err
	}
	if err := send(`{"token":"invite-secret","event_title":"Chess Night","inviter_name":"Ana"}`); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	for _, payload := range []string{`{"token":"","inviter_name":"Ana"}`, `{"token":"t"}`, `null`} {
		if err := send(payload); !emailoutbox.IsPermanent(err) {
			t.Fatalf("Send(%s) error = %v, want permanent", payload, err)
		}
	}
	if want := []eventstore.OrganizerInvitePayload{{Token: "invite-secret", EventTitle: "Chess Night", InviterName: "Ana"}}; !reflect.DeepEqual(mailer.sent, want) {
		t.Fatalf("sent = %+v, want %+v", mailer.sent, want)
	}
}

type teamMailerStub struct {
	// sent names each call as method:recipient:team slug.
	sent []string
}

func (m *teamMailerStub) SendMemberJoined(_ context.Context, recipient string, notice teamstore.NoticePayload, _ string) (string, error) {
	m.sent = append(m.sent, "joined:"+recipient+":"+notice.TeamSlug)
	return "provider-id", nil
}

func (m *teamMailerStub) SendOwnershipTransferred(_ context.Context, recipient string, notice teamstore.NoticePayload, _ string) (string, error) {
	m.sent = append(m.sent, "transferred:"+recipient+":"+notice.TeamSlug)
	return "provider-id", nil
}

func TestDispatcherSendsTeamNoticesAndQuarantinesBadOnes(t *testing.T) {
	mailer := &teamMailerStub{}
	dispatcher := &Dispatcher{Teams: mailer}
	send := func(kind string, payload string) error {
		_, err := dispatcher.Send(t.Context(), emailoutbox.Message{
			Kind: kind, Recipient: "player@example.com", IdempotencyKey: "team-key", Payload: json.RawMessage(payload),
		})
		return err
	}
	good := `{"team_name":"Night Owls","team_slug":"night-owls","person_name":"Jo"}`
	if err := send(emailoutbox.KindTeamMemberJoined, good); err != nil {
		t.Fatalf("Send(joined) error = %v", err)
	}
	if err := send(emailoutbox.KindTeamOwnershipTransferred, good); err != nil {
		t.Fatalf("Send(transferred) error = %v", err)
	}
	for _, payload := range []string{`{"team_name":"Night Owls","team_slug":"night-owls"}`, `{"team_slug":"x","person_name":"Jo"}`, `null`} {
		if err := send(emailoutbox.KindTeamMemberJoined, payload); !emailoutbox.IsPermanent(err) {
			t.Fatalf("Send(%s) error = %v, want permanent", payload, err)
		}
	}
	if want := []string{"joined:player@example.com:night-owls", "transferred:player@example.com:night-owls"}; !reflect.DeepEqual(mailer.sent, want) {
		t.Fatalf("sent = %v, want %v", mailer.sent, want)
	}
}

type clubMailerStub struct {
	// sent names each call as method:recipient:club name.
	sent []string
}

func (m *clubMailerStub) SendClaimApproved(_ context.Context, recipient string, decision clubs.DecisionPayload, _ string) (string, error) {
	m.sent = append(m.sent, "approved:"+recipient+":"+decision.ClubName)
	return "provider-id", nil
}

func (m *clubMailerStub) SendClaimRejected(_ context.Context, recipient string, decision clubs.DecisionPayload, _ string) (string, error) {
	m.sent = append(m.sent, "rejected:"+recipient+":"+decision.ClubName)
	return "provider-id", nil
}

func TestDispatcherSendsClubClaimDecisionsAndQuarantinesBadOnes(t *testing.T) {
	mailer := &clubMailerStub{}
	dispatcher := &Dispatcher{Clubs: mailer}
	send := func(kind string, payload string) error {
		_, err := dispatcher.Send(t.Context(), emailoutbox.Message{
			Kind: kind, Recipient: "officer@example.com", IdempotencyKey: "claim-key", Payload: json.RawMessage(payload),
		})
		return err
	}
	if err := send(emailoutbox.KindClubClaimApproved, `{"club_name":"Smash Club","school_name":"Fixture U","club_slug":"smash-club"}`); err != nil {
		t.Fatalf("Send(approved) error = %v", err)
	}
	if err := send(emailoutbox.KindClubClaimRejected, `{"club_name":"Chess Club","school_name":"Fixture U","request":true}`); err != nil {
		t.Fatalf("Send(rejected) error = %v", err)
	}
	for _, bad := range []struct{ kind, payload string }{
		{emailoutbox.KindClubClaimApproved, `{"club_name":"Smash Club","school_name":"Fixture U"}`},
		{emailoutbox.KindClubClaimRejected, `{"school_name":"Fixture U"}`},
		{emailoutbox.KindClubClaimRejected, `null`},
	} {
		if err := send(bad.kind, bad.payload); !emailoutbox.IsPermanent(err) {
			t.Fatalf("Send(%s, %s) error = %v, want permanent", bad.kind, bad.payload, err)
		}
	}
	if want := []string{"approved:officer@example.com:Smash Club", "rejected:officer@example.com:Chess Club"}; !reflect.DeepEqual(mailer.sent, want) {
		t.Fatalf("sent = %v, want %v", mailer.sent, want)
	}
}
