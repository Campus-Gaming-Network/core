// Package emaildelivery renders durable outbox payloads with the existing
// account and event mailers.
package emaildelivery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
)

type Dispatcher struct {
	Account auth.Mailer
	Events  eventstore.RSVPMailer
	Teams   teamstore.Mailer
}

type tokenPayload struct {
	Token string `json:"token"`
}

type eventPayload struct {
	Event eventstore.Event `json:"event"`
}

func (d *Dispatcher) Send(ctx context.Context, message emailoutbox.Message) (string, error) {
	if strings.TrimSpace(message.Recipient) == "" || strings.TrimSpace(message.IdempotencyKey) == "" {
		return "", emailoutbox.Permanent(errors.New("invalid outbox envelope"))
	}
	switch message.Kind {
	case emailoutbox.KindAccountVerification:
		payload, err := decodeTokenPayload(message.Payload)
		if err != nil {
			return "", err
		}
		if d.Account == nil {
			return "", errors.New("account mailer unavailable")
		}
		providerID, err := d.Account.SendVerification(ctx, message.Recipient, payload.Token, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	case emailoutbox.KindPasswordReset:
		payload, err := decodeTokenPayload(message.Payload)
		if err != nil {
			return "", err
		}
		if d.Account == nil {
			return "", errors.New("account mailer unavailable")
		}
		providerID, err := d.Account.SendPasswordReset(ctx, message.Recipient, payload.Token, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	case emailoutbox.KindEmailChangeVerification:
		payload, err := decodeTokenPayload(message.Payload)
		if err != nil {
			return "", err
		}
		if d.Account == nil {
			return "", errors.New("account mailer unavailable")
		}
		providerID, err := d.Account.SendEmailChangeVerification(ctx, message.Recipient, payload.Token, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	case emailoutbox.KindEmailChangedNotice:
		if d.Account == nil {
			return "", errors.New("account mailer unavailable")
		}
		providerID, err := d.Account.SendEmailChangedNotice(ctx, message.Recipient, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	case emailoutbox.KindRSVPConfirmation, emailoutbox.KindEventCancellation:
		payload, err := decodeEventPayload(message.Payload)
		if err != nil {
			return "", err
		}
		if d.Events == nil {
			return "", errors.New("event mailer unavailable")
		}
		if message.Kind == emailoutbox.KindRSVPConfirmation {
			providerID, err := d.Events.SendRSVPConfirmation(ctx, message.Recipient, payload.Event, message.IdempotencyKey)
			return providerID, classifyProviderError(err)
		}
		providerID, err := d.Events.SendCancellationNotification(ctx, message.Recipient, payload.Event, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	case emailoutbox.KindOrganizerInvite:
		var payload eventstore.OrganizerInvitePayload
		if json.Unmarshal(message.Payload, &payload) != nil || strings.TrimSpace(payload.Token) == "" || strings.TrimSpace(payload.InviterName) == "" {
			return "", emailoutbox.Permanent(errors.New("invalid organizer invite email payload"))
		}
		if d.Events == nil {
			return "", errors.New("event mailer unavailable")
		}
		providerID, err := d.Events.SendOrganizerInvite(ctx, message.Recipient, payload, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	case emailoutbox.KindTeamMemberJoined, emailoutbox.KindTeamOwnershipTransferred:
		var payload teamstore.NoticePayload
		if json.Unmarshal(message.Payload, &payload) != nil || strings.TrimSpace(payload.TeamName) == "" ||
			strings.TrimSpace(payload.TeamSlug) == "" || strings.TrimSpace(payload.PersonName) == "" {
			return "", emailoutbox.Permanent(errors.New("invalid team notice email payload"))
		}
		if d.Teams == nil {
			return "", errors.New("team mailer unavailable")
		}
		send := d.Teams.SendMemberJoined
		if message.Kind == emailoutbox.KindTeamOwnershipTransferred {
			send = d.Teams.SendOwnershipTransferred
		}
		providerID, err := send(ctx, message.Recipient, payload, message.IdempotencyKey)
		return providerID, classifyProviderError(err)
	default:
		return "", emailoutbox.Permanent(fmt.Errorf("unsupported email kind %q", message.Kind))
	}
}

func classifyProviderError(err error) error {
	if err == nil {
		return nil
	}
	var responseError *mailhttp.ResponseError
	if errors.As(err, &responseError) && responseError.Permanent() {
		return emailoutbox.Permanent(err)
	}
	return err
}

func decodeTokenPayload(raw json.RawMessage) (tokenPayload, error) {
	var payload tokenPayload
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &payload) != nil || strings.TrimSpace(payload.Token) == "" {
		return tokenPayload{}, emailoutbox.Permanent(errors.New("invalid token email payload"))
	}
	return payload, nil
}

func decodeEventPayload(raw json.RawMessage) (eventPayload, error) {
	var payload eventPayload
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &payload) != nil ||
		strings.TrimSpace(payload.Event.ID) == "" || strings.TrimSpace(payload.Event.Title) == "" ||
		strings.TrimSpace(payload.Event.Slug) == "" {
		return eventPayload{}, emailoutbox.Permanent(errors.New("invalid event email payload"))
	}
	return payload, nil
}
