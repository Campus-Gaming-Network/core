package safety

import (
	"strings"
	"testing"
)

func TestValidateSupportTicketRejectsBlockedLanguageInTextFields(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*SupportTicketInput)
		field  string
	}{
		{
			name: "name",
			mutate: func(input *SupportTicketInput) {
				input.Name = "Bullshit Player"
			},
			field: "name",
		},
		{
			name: "subject",
			mutate: func(input *SupportTicketInput) {
				input.Subject = "Bullshit event"
			},
			field: "subject",
		},
		{
			name: "message",
			mutate: func(input *SupportTicketInput) {
				input.Message = "This event is bullshit"
			},
			field: "message",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := SupportTicketInput{
				ContactEmail: "player@example.com",
				Name:         "Player",
				Subject:      "Need help",
				Message:      "My event form is confusing.",
			}
			test.mutate(&input)
			err := ValidateSupportTicket(input)
			if err == nil || !strings.Contains(err.Error(), test.field+" contains language that is not allowed") {
				t.Fatalf("ValidateSupportTicket() error = %v, want blocked-language error for %s", err, test.field)
			}
		})
	}
}
