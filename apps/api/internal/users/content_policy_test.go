package users

import (
	"strings"
	"testing"
)

func TestValidateProfileUpdateRejectsBlockedLanguage(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ProfileUpdate)
		field  string
	}{
		{
			name: "name",
			mutate: func(update *ProfileUpdate) {
				update.Name = "Bullshit Player"
			},
			field: "name",
		},
		{
			name: "bio",
			mutate: func(update *ProfileUpdate) {
				update.Bio = "I organize bullshit tournaments"
			},
			field: "bio",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			update := ProfileUpdate{Name: "Player", Timezone: "UTC"}
			test.mutate(&update)
			err := ValidateProfileUpdate(update, nil)
			if err == nil || !strings.Contains(err.Error(), test.field+" contains language that is not allowed") {
				t.Fatalf("ValidateProfileUpdate() error = %v, want blocked-language error for %s", err, test.field)
			}
		})
	}
}
