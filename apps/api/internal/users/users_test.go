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

func TestValidateSignupRequiresHomeSchoolAndAgeConfirmation(t *testing.T) {
	tests := []struct {
		name      string
		mutate    func(*SignupInput)
		wantError string
	}{
		{
			name: "home school",
			mutate: func(input *SignupInput) {
				input.HomeSchoolID = "  "
			},
			wantError: "home school is required",
		},
		{
			name: "age confirmation",
			mutate: func(input *SignupInput) {
				input.AgeConfirmed = false
			},
			wantError: "18+ confirmation is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := SignupInput{
				Email:        "player@example.com",
				Password:     "12345678",
				Name:         "Player",
				HomeSchoolID: "school-id",
				AgeConfirmed: true,
			}
			test.mutate(&input)

			err := ValidateSignup(input)
			if err == nil || err.Error() != test.wantError {
				t.Fatalf("ValidateSignup() error = %v, want %q", err, test.wantError)
			}
		})
	}
}

func TestValidateSignupRejectsBlockedLanguage(t *testing.T) {
	err := ValidateSignup(SignupInput{
		Email:        "player@example.com",
		Password:     "12345678",
		Name:         "Bullshit Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
	})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("ValidateSignup() error = %v, want blocked-language error", err)
	}
}

func TestProfilePublicIncludesHomeSchoolSummary(t *testing.T) {
	profile := Profile{
		ID:                "user-id",
		Name:              "Player",
		VerificationLevel: "basic",
		HomeSchoolID:      "school-id",
		HomeSchool: &HomeSchool{
			ID:    "school-id",
			Name:  "Example University",
			Slug:  "example-university",
			City:  "Irvine",
			State: "CA",
		},
		SocialLinks: []SocialLink{{Label: "Discord", URL: "https://discord.example.test/player"}},
	}

	public := profile.Public()

	if public.HomeSchool == nil {
		t.Fatal("Public() HomeSchool = nil, want summary")
	}
	if public.HomeSchool.Name != "Example University" || public.HomeSchool.Slug != "example-university" {
		t.Fatalf("Public() HomeSchool = %#v, want display-ready school summary", public.HomeSchool)
	}
	if public.HomeSchoolID != "school-id" {
		t.Fatalf("Public() HomeSchoolID = %q, want original ID", public.HomeSchoolID)
	}
	if len(public.SocialLinks) != 1 {
		t.Fatalf("Public() SocialLinks = %#v, want social links preserved", public.SocialLinks)
	}
}
