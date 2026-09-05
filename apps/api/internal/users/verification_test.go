package users

import (
	"strings"
	"testing"
)

func TestVerificationLevelAfterEmailVerification(t *testing.T) {
	tests := []struct {
		name         string
		email        string
		currentLevel string
		want         string
	}{
		{
			name:         "qualifying edu domain",
			email:        "player@school.edu",
			currentLevel: "basic",
			want:         "verified",
		},
		{
			name:         "qualifying edu subdomain",
			email:        "player@esports.school.edu",
			currentLevel: "basic",
			want:         "verified",
		},
		{
			name:         "mixed case domain is normalized",
			email:        "Player@Esports.School.EDU",
			currentLevel: "basic",
			want:         "verified",
		},
		{
			name:         "non edu domain remains basic",
			email:        "player@example.com",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "edu before another suffix does not qualify",
			email:        "player@school.edu.com",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "deceptive edu label does not qualify",
			email:        "player@edu.evil.com",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "suffix without preceding label does not qualify",
			email:        "player@.edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "bare edu domain does not qualify",
			email:        "player@edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "empty domain label does not qualify",
			email:        "player@school..edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "invalid domain character does not qualify",
			email:        "player@school_.edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "domain label cannot begin with a hyphen",
			email:        "player@-school.edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "domain label cannot end with a hyphen",
			email:        "player@school-.edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "overlong domain label does not qualify",
			email:        "player@" + strings.Repeat("a", 64) + ".edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "missing local part does not qualify",
			email:        "@school.edu",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "display name is not an email address value",
			email:        "Player <player@school.edu>",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "malformed email does not qualify",
			email:        "not-an-email",
			currentLevel: "basic",
			want:         "basic",
		},
		{
			name:         "staff faculty is preserved for edu email",
			email:        "faculty@school.edu",
			currentLevel: "staff_faculty",
			want:         "staff_faculty",
		},
		{
			name:         "staff faculty is preserved for non edu email",
			email:        "faculty@example.com",
			currentLevel: "staff_faculty",
			want:         "staff_faculty",
		},
		{
			name:         "existing verified level is preserved",
			email:        "player@example.com",
			currentLevel: "verified",
			want:         "verified",
		},
		{
			name:         "unknown higher grant is preserved",
			email:        "player@school.edu",
			currentLevel: "future_higher_grant",
			want:         "future_higher_grant",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := VerificationLevelAfterEmailVerification(test.email, test.currentLevel); got != test.want {
				t.Fatalf("VerificationLevelAfterEmailVerification(%q, %q) = %q, want %q", test.email, test.currentLevel, got, test.want)
			}
		})
	}
}
