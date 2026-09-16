// Package adminsecurity records bounded, durable Admin Console security events.
// It intentionally exposes no update or delete operation.
package adminsecurity

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

type EventType string

const (
	EventExchangeSucceeded   EventType = "admin.authentication.exchange_succeeded"
	EventExchangeDenied      EventType = "admin.authentication.exchange_denied"
	EventLogout              EventType = "admin.authentication.logout"
	EventSessionRevoked      EventType = "admin.session.revoked"
	EventStepUpSucceeded     EventType = "admin.authentication.step_up_succeeded"
	EventStepUpDenied        EventType = "admin.authentication.step_up_denied"
	EventAuthorizationDenied EventType = "admin.authorization.denied"
	EventSensitiveRead       EventType = "admin.data.sensitive_read"
	EventBootstrap           EventType = "admin.access.bootstrap"
	EventBreakGlass          EventType = "admin.access.break_glass"
)

type Outcome string

const (
	OutcomeSucceeded Outcome = "succeeded"
	OutcomeDenied    Outcome = "denied"
	OutcomeError     Outcome = "error"
)

var ErrInvalidEvent = errors.New("invalid admin security event")

var supportedEventTypes = map[EventType]struct{}{
	EventExchangeSucceeded:   {},
	EventExchangeDenied:      {},
	EventLogout:              {},
	EventSessionRevoked:      {},
	EventStepUpSucceeded:     {},
	EventStepUpDenied:        {},
	EventAuthorizationDenied: {},
	EventSensitiveRead:       {},
	EventBootstrap:           {},
	EventBreakGlass:          {},
}

// Metadata is intentionally closed rather than map-shaped. Free-form values,
// request bodies, credentials, end-user contact details, and moderation text
// cannot be passed to the durable security-event writer. OperatorIdentity is
// reserved for the explicitly audited first-admin bootstrap identity.
type Metadata struct {
	ReasonCode          string `json:"reason_code,omitempty"`
	TargetUserID        string `json:"target_user_id,omitempty"`
	TargetGrantID       string `json:"target_grant_id,omitempty"`
	ResourceType        string `json:"resource_type,omitempty"`
	Operation           string `json:"operation,omitempty"`
	RevokedSessionCount *int   `json:"revoked_session_count,omitempty"`
	HTTPStatus          *int   `json:"http_status,omitempty"`
	OperatorIdentity    string `json:"operator_identity,omitempty"`
	Bootstrap           bool   `json:"bootstrap,omitempty"`
	BreakGlass          bool   `json:"break_glass,omitempty"`
}

type WriteInput struct {
	Type                  EventType
	Outcome               Outcome
	ActorUserID           string
	AdminSessionID        string
	RequestID             string
	NetworkIdentifierHash []byte
	Metadata              Metadata
}

type Event struct {
	ID                    string
	Type                  EventType
	Outcome               Outcome
	ActorUserID           string
	AdminSessionID        string
	RequestID             string
	NetworkIdentifierHash []byte
	Metadata              Metadata
	OccurredAt            time.Time
}

type ListParams struct {
	Type        EventType
	ActorUserID string
	BeforeTime  *time.Time
	BeforeID    string
	Limit       int
}

func (input WriteInput) validate() error {
	if _, ok := supportedEventTypes[input.Type]; !ok {
		return ErrInvalidEvent
	}
	if input.Outcome != OutcomeSucceeded && input.Outcome != OutcomeDenied && input.Outcome != OutcomeError {
		return ErrInvalidEvent
	}
	if !validOptionalUUID(input.ActorUserID) || !validOptionalUUID(input.AdminSessionID) ||
		!validOptionalUUID(input.Metadata.TargetUserID) || !validOptionalUUID(input.Metadata.TargetGrantID) {
		return ErrInvalidEvent
	}
	if utf8.RuneCountInString(strings.TrimSpace(input.RequestID)) > 128 ||
		(input.RequestID != "" && strings.TrimSpace(input.RequestID) == "") {
		return ErrInvalidEvent
	}
	if len(input.NetworkIdentifierHash) != 0 && len(input.NetworkIdentifierHash) != 32 {
		return ErrInvalidEvent
	}
	if !boundedToken(input.Metadata.ReasonCode, 80) || !boundedToken(input.Metadata.ResourceType, 80) ||
		!boundedToken(input.Metadata.Operation, 120) || !boundedToken(input.Metadata.OperatorIdentity, 320) {
		return ErrInvalidEvent
	}
	if input.Metadata.RevokedSessionCount != nil && *input.Metadata.RevokedSessionCount < 0 {
		return ErrInvalidEvent
	}
	if input.Metadata.HTTPStatus != nil && (*input.Metadata.HTTPStatus < 100 || *input.Metadata.HTTPStatus > 599) {
		return ErrInvalidEvent
	}
	if input.Type == EventBootstrap && !input.Metadata.Bootstrap {
		return ErrInvalidEvent
	}
	if input.Type == EventBreakGlass && !input.Metadata.BreakGlass {
		return ErrInvalidEvent
	}
	if input.Type == EventSensitiveRead &&
		(input.ActorUserID == "" || input.AdminSessionID == "" ||
			strings.TrimSpace(input.Metadata.ResourceType) == "" || strings.TrimSpace(input.Metadata.Operation) == "") {
		return ErrInvalidEvent
	}
	encoded, err := json.Marshal(input.Metadata)
	if err != nil || len(encoded) > 4096 {
		return ErrInvalidEvent
	}
	return nil
}

func (params ListParams) validate() error {
	if params.Type != "" {
		if _, ok := supportedEventTypes[params.Type]; !ok {
			return ErrInvalidEvent
		}
	}
	if !validOptionalUUID(params.ActorUserID) || !validOptionalUUID(params.BeforeID) {
		return ErrInvalidEvent
	}
	if (params.BeforeTime == nil) != (params.BeforeID == "") || params.Limit < 0 || params.Limit > 100 {
		return ErrInvalidEvent
	}
	return nil
}

func boundedToken(value string, maximum int) bool {
	trimmed := strings.TrimSpace(value)
	return value == "" || (trimmed != "" && utf8.RuneCountInString(trimmed) <= maximum)
}

func validOptionalUUID(value string) bool {
	if value == "" {
		return true
	}
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}
