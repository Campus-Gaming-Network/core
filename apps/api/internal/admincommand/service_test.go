package admincommand

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
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

func TestSecurityReportRejectsIncompleteRules(t *testing.T) {
	for _, rule := range []AlertRule{
		{Threshold: 1, Window: time.Minute},
		{Name: "no threshold", Window: time.Minute},
		{Name: "no window", Threshold: 1},
	} {
		if _, err := (&Service{pool: &pgxpool.Pool{}}).SecurityReport(context.Background(), []AlertRule{rule}, time.Now()); !errors.Is(err, ErrInvalidCommand) {
			t.Fatalf("rule %#v error = %v, want ErrInvalidCommand", rule, err)
		}
	}
}
