package safety

import "testing"

func TestValidateSupportTicket(t *testing.T) {
	valid := SupportTicketInput{
		ContactEmail: "player@example.com",
		Subject:      "Need help",
		Message:      "My event form is confusing.",
	}
	if err := ValidateSupportTicket(valid); err != nil {
		t.Fatalf("ValidateSupportTicket() error = %v", err)
	}

	invalid := valid
	invalid.ContactEmail = "not-an-email"
	if err := ValidateSupportTicket(invalid); err == nil {
		t.Fatal("ValidateSupportTicket() error = nil, want invalid email error")
	}

	invalid = valid
	invalid.Subject = ""
	if err := ValidateSupportTicket(invalid); err == nil {
		t.Fatal("ValidateSupportTicket() error = nil, want subject error")
	}
}

func TestNormalizeSupportTicketParsesContactEmail(t *testing.T) {
	input := SupportTicketInput{
		SubmitterUserID: " 11111111-1111-1111-1111-111111111111 ",
		ContactEmail:    " Player One <PLAYER@Example.COM> ",
		Name:            " Player One ",
		Subject:         " Need help ",
		Message:         " Hello! ",
	}

	normalized := normalizeSupportTicket(input)
	if normalized.ContactEmail != "player@example.com" {
		t.Fatalf("ContactEmail = %q, want parsed lowercase address", normalized.ContactEmail)
	}
	if normalized.Name != "Player One" ||
		normalized.Subject != "Need help" ||
		normalized.Message != "Hello!" {
		t.Fatalf("normalized text fields = %#v, want trimmed values", normalized)
	}
}

func TestValidateReport(t *testing.T) {
	valid := ReportInput{
		ReporterUserID: "11111111-1111-1111-1111-111111111111",
		TargetType:     ReportTargetEvent,
		TargetID:       "22222222-2222-2222-2222-222222222222",
		Reason:         "Spam listing.",
	}
	if err := ValidateReport(valid); err != nil {
		t.Fatalf("ValidateReport() error = %v", err)
	}

	invalid := valid
	invalid.TargetType = "school"
	if err := ValidateReport(invalid); err == nil {
		t.Fatal("ValidateReport() error = nil, want target type error")
	}

	invalid = valid
	invalid.Reason = ""
	if err := ValidateReport(invalid); err == nil {
		t.Fatal("ValidateReport() error = nil, want reason error")
	}
}
