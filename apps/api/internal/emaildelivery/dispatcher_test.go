package emaildelivery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
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
