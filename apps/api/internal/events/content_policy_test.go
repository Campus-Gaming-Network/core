package events

import (
	"strings"
	"testing"
)

func TestValidateCreateInputRejectsBlockedLanguageInRemainingTextFields(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*CreateInput)
		field  string
	}{
		{
			name: "description",
			mutate: func(input *CreateInput) {
				input.Description = "This event is bullshit"
			},
			field: "description",
		},
		{
			name: "location name",
			mutate: func(input *CreateInput) {
				input.LocationName = "Bullshit Arena"
			},
			field: "location name",
		},
		{
			name: "payment note",
			mutate: func(input *CreateInput) {
				input.PaymentNote = "Pay this bullshit fee off-site"
			},
			field: "payment note",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateCreateInput(validCreateInput(test.mutate))
			if err == nil || !strings.Contains(err.Error(), test.field+" contains language that is not allowed") {
				t.Fatalf("ValidateCreateInput() error = %v, want blocked-language error for %s", err, test.field)
			}
		})
	}
}
