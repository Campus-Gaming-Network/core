package users

import (
	"strings"
	"testing"
)

func TestValidateSignupAcceptsMinimumPasswordLength(t *testing.T) {
	err := ValidateSignup(SignupInput{
		Email:        "player@example.com",
		Password:     "12345678",
		Name:         "Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
	})
	if err != nil {
		t.Fatalf("ValidateSignup() error = %v", err)
	}
}

func TestValidateSignupRejectsPasswordBelowMinimumLength(t *testing.T) {
	err := ValidateSignup(SignupInput{
		Email:        "player@example.com",
		Password:     "1234567",
		Name:         "Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
	})
	if err == nil || !strings.Contains(err.Error(), "8 characters") {
		t.Fatalf("ValidateSignup() error = %v, want minimum length error", err)
	}
}

// show_in_lists is a private setting for the account's own page. The public
// profile must never reveal who has opted out.
