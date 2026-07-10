package auth

import "testing"

func TestAccountEmailLinksUseWebRoutes(t *testing.T) {
	tests := []struct {
		name string
		link string
		want string
	}{
		{
			name: "verification",
			link: verificationLink("http://localhost:3000/", "verify token"),
			want: "http://localhost:3000/auth/verify-email?token=verify+token",
		},
		{
			name: "password reset",
			link: passwordResetLink("http://localhost:3000/", "reset token"),
			want: "http://localhost:3000/reset-password?token=reset+token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.link != tt.want {
				t.Fatalf("link = %q, want %q", tt.link, tt.want)
			}
		})
	}
}
