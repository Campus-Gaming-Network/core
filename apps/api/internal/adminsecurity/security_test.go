package adminsecurity

import (
	"errors"
	"testing"
	"time"
)

const testUUID = "00000000-0000-4000-8000-000000000001"

func TestWriteInputValidation(t *testing.T) {
	count := 2
	status := 403
	valid := WriteInput{
		Type: EventSessionRevoked, Outcome: OutcomeSucceeded,
		ActorUserID: testUUID, RequestID: "request-1",
		NetworkIdentifierHash: make([]byte, 32),
		Metadata: Metadata{ReasonCode: "grant_revoked", TargetUserID: testUUID,
			RevokedSessionCount: &count, HTTPStatus: &status},
	}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid event error = %v", err)
	}

	tests := []struct {
		name  string
		input WriteInput
	}{
		{name: "unknown type", input: WriteInput{Type: "admin.unknown", Outcome: OutcomeSucceeded}},
		{name: "unknown outcome", input: WriteInput{Type: EventLogout, Outcome: "maybe"}},
		{name: "bad actor", input: WriteInput{Type: EventLogout, Outcome: OutcomeSucceeded, ActorUserID: "not-uuid"}},
		{name: "bad hash length", input: WriteInput{Type: EventLogout, Outcome: OutcomeSucceeded, NetworkIdentifierHash: []byte("raw-address")}},
		{name: "blank request", input: WriteInput{Type: EventLogout, Outcome: OutcomeSucceeded, RequestID: "  "}},
		{name: "bootstrap marker required", input: WriteInput{Type: EventBootstrap, Outcome: OutcomeSucceeded}},
		{name: "break glass marker required", input: WriteInput{Type: EventBreakGlass, Outcome: OutcomeSucceeded}},
		{name: "sensitive read actor required", input: WriteInput{Type: EventSensitiveRead, Outcome: OutcomeSucceeded, Metadata: Metadata{ResourceType: "user", Operation: "read"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.input.validate(); !errors.Is(err, ErrInvalidEvent) {
				t.Fatalf("validate() error = %v, want ErrInvalidEvent", err)
			}
		})
	}
}

func TestClosedMetadataShapeCannotCarryFreeFormSecrets(t *testing.T) {
	metadata := Metadata{ReasonCode: "invalid_assertion", ResourceType: "admin_session"}
	input := WriteInput{Type: EventExchangeDenied, Outcome: OutcomeDenied, Metadata: metadata}
	if err := input.validate(); err != nil {
		t.Fatalf("validate() error = %v", err)
	}
	// Compile-time field closure is the security property: callers cannot add a
	// token, email, body, or arbitrary metadata key to Metadata.
}

func TestListParamsValidation(t *testing.T) {
	now := time.Now()
	if err := (ListParams{BeforeTime: &now, BeforeID: testUUID, Limit: 100}).validate(); err != nil {
		t.Fatalf("valid list params error = %v", err)
	}
	for _, params := range []ListParams{
		{Limit: 101},
		{BeforeTime: &now},
		{BeforeID: testUUID},
		{Type: "admin.unknown"},
		{ActorUserID: "not-uuid"},
	} {
		if err := params.validate(); !errors.Is(err, ErrInvalidEvent) {
			t.Fatalf("validate(%#v) error = %v, want ErrInvalidEvent", params, err)
		}
	}
}
