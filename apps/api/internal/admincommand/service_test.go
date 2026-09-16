package admincommand

import (
	"errors"
	"testing"
)

func TestCommandsRejectMissingActorsReasonsAndImplicitBootstrap(t *testing.T) {
	service := &Service{}
	if _, err := service.GrantSiteAdmin(nil, GrantInput{}); !errors.Is(err, ErrInvalidCommand) {
		t.Fatalf("GrantSiteAdmin() error = %v", err)
	}
	if _, err := service.RevokeSiteAdmin(nil, RevokeInput{}); !errors.Is(err, ErrInvalidCommand) {
		t.Fatalf("RevokeSiteAdmin() error = %v", err)
	}
	if _, err := service.RevokeSessions(nil, RevokeInput{}); !errors.Is(err, ErrInvalidCommand) {
		t.Fatalf("RevokeSessions() error = %v", err)
	}
}

func TestEmailAndReasonValidation(t *testing.T) {
	if normalizeEmail(" ADMIN@Example.test ") != "admin@example.test" {
		t.Fatal("normalizeEmail() did not trim and lowercase")
	}
	for _, value := range []string{"", "display <admin@example.test>", "not-an-email"} {
		if validEmail(value) {
			t.Fatalf("validEmail(%q) = true", value)
		}
	}
	if !validEmail("admin@example.test") || !validReason("operator-approved recovery", 500) || validReason("  ", 500) {
		t.Fatal("valid email/reason rejected or blank reason accepted")
	}
}
