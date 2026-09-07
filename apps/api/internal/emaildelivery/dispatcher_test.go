package emaildelivery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
)

type accountMailerStub struct {
	err    error
	called int
}

func (m *accountMailerStub) SendVerification(context.Context, string, string, string) (string, error) {
	m.called++
	return "", m.err
}

func (m *accountMailerStub) SendPasswordReset(context.Context, string, string, string) (string, error) {
	m.called++
	return "", m.err
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
