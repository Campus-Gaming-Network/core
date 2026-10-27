package adminaccess

import (
	"strings"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
)

const validTestUserID = "00000000-0000-4000-8000-000000000001"

func TestValidateBootstrapInput(t *testing.T) {
	if err := ValidateBootstrapInput(BootstrapInput{
		UserID:           validTestUserID,
		OperatorIdentity: "platform-operator@example.test",
		Reason:           "Initial operator bootstrap",
	}); err != nil {
		t.Fatalf("ValidateBootstrapInput(valid) error = %v", err)
	}
	if err := ValidateBootstrapInput(BootstrapInput{
		UserID: validTestUserID,
		Reason: "Initial operator bootstrap",
	}); err == nil {
		t.Fatal("ValidateBootstrapInput(blank operator) error = nil")
	}
	if err := ValidateBootstrapInput(BootstrapInput{
		UserID:           validTestUserID,
		OperatorIdentity: "platform-operator@example.test",
	}); err == nil {
		t.Fatal("ValidateBootstrapInput(blank reason) error = nil")
	}
	if err := ValidateBootstrapInput(BootstrapInput{
		UserID:           validTestUserID,
		OperatorIdentity: strings.Repeat("x", maximumBootstrapOperatorLength+1),
		Reason:           "Initial operator bootstrap",
	}); err == nil {
		t.Fatal("ValidateBootstrapInput(long operator) error = nil")
	}
	if err := ValidateBootstrapInput(BootstrapInput{
		UserID:           validTestUserID,
		OperatorIdentity: "not-an-operator-email",
		Reason:           "Initial operator bootstrap",
	}); err == nil {
		t.Fatal("ValidateBootstrapInput(non-email operator) error = nil")
	}
}

func TestCapabilityChecksDenyByDefault(t *testing.T) {
	for _, test := range []struct {
		role       Role
		capability Capability
	}{
		{role: "", capability: CapabilityReportsRead},
		{role: "future_role", capability: CapabilityReportsRead},
		{role: RoleSiteAdmin, capability: ""},
		{role: RoleSiteAdmin, capability: "future.capability"},
	} {
		if Allows(test.role, test.capability) {
			t.Errorf("Allows(%q, %q) = true, want false", test.role, test.capability)
		}
	}
}

func TestValidateGrantInput(t *testing.T) {
	valid := GrantInput{
		UserID:      validTestUserID,
		Role:        RoleSiteAdmin,
		ActorUserID: validTestUserID,
		Reason:      "Initial site administrator bootstrap",
	}
	if err := ValidateGrantInput(valid); err != nil {
		t.Fatalf("ValidateGrantInput(valid) error = %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*GrantInput)
	}{
		{name: "invalid user", mutate: func(input *GrantInput) { input.UserID = "not-a-uuid" }},
		{name: "unknown role", mutate: func(input *GrantInput) { input.Role = "school_admin" }},
		{name: "invalid actor", mutate: func(input *GrantInput) { input.ActorUserID = "" }},
		{name: "blank reason", mutate: func(input *GrantInput) { input.Reason = "  " }},
		{name: "long reason", mutate: func(input *GrantInput) { input.Reason = strings.Repeat("x", maximumReasonLength+1) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := valid
			tt.mutate(&input)
			err := ValidateGrantInput(input)
			kind, code, ok := apperror.Details(err)
			if !ok || kind != apperror.KindValidation || code != "invalid_request" {
				t.Fatalf("ValidateGrantInput() error = %v, want typed invalid_request", err)
			}
		})
	}
}

func TestValidateRevokeInput(t *testing.T) {
	valid := RevokeInput{
		UserID:      validTestUserID,
		Role:        RoleSiteAdmin,
		ActorUserID: validTestUserID,
		Reason:      "Operator no longer requires access",
	}
	if err := ValidateRevokeInput(valid); err != nil {
		t.Fatalf("ValidateRevokeInput(valid) error = %v", err)
	}

	valid.Reason = ""
	if err := ValidateRevokeInput(valid); err == nil {
		t.Fatal("ValidateRevokeInput(blank reason) error = nil")
	}
}
