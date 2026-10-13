package users

import (
	"github.com/Campus-Gaming-Network/core/apps/api/internal/policies"
	"reflect"
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
		Policies: policies.Claim{
			TermsAgreed: true, TermsVersion: "terms-v1",
			PrivacyAcknowledged: true, PrivacyVersion: "privacy-v1",
		},
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
		Policies: policies.Claim{
			TermsAgreed: true, TermsVersion: "terms-v1",
			PrivacyAcknowledged: true, PrivacyVersion: "privacy-v1",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "8 characters") {
		t.Fatalf("ValidateSignup() error = %v, want minimum length error", err)
	}
}

// show_in_lists is a private setting for the account's own page. The public
// profile must never reveal who has opted out.

func TestNormalizeSocialLinksDefaultsToURLAndCanonicalizesDiscord(t *testing.T) {
	got := NormalizeSocialLinks([]SocialLink{
		{Label: " Twitch ", URL: " https://twitch.tv/player "},
		{Kind: SocialLinkKindDiscord, Label: "My server name", Username: " @Player.One "},
	})

	want := []SocialLink{
		{Kind: SocialLinkKindURL, Label: "Twitch", URL: "https://twitch.tv/player"},
		{Kind: SocialLinkKindDiscord, Label: DiscordSocialLinkLabel, Username: "player.one"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("NormalizeSocialLinks() = %#v, want %#v", got, want)
	}
}

func TestValidateProfileUpdateChecksSocialLinksByKind(t *testing.T) {
	update := ProfileUpdate{Name: "Player", Timezone: "UTC"}
	discord := func(username string) SocialLink {
		return SocialLink{Kind: SocialLinkKindDiscord, Label: DiscordSocialLinkLabel, Username: username}
	}
	tests := []struct {
		name    string
		link    SocialLink
		wantErr string
	}{
		{name: "URL link", link: SocialLink{Kind: SocialLinkKindURL, Label: "Twitch", URL: "https://twitch.tv/player"}},
		{name: "shortest Discord username", link: discord("ab")},
		{name: "longest Discord username", link: discord(strings.Repeat("a", 32))},
		{name: "Discord username with every allowed character", link: discord("player_1.one")},
		{name: "Discord username too short", link: discord("a"), wantErr: "Discord usernames"},
		{name: "Discord username too long", link: discord(strings.Repeat("a", 33)), wantErr: "Discord usernames"},
		{name: "Discord username with two periods in a row", link: discord("player..one"), wantErr: "Discord usernames"},
		{name: "Discord username in the old name#1234 form", link: discord("player#1234"), wantErr: "Discord usernames"},
		{name: "Discord username with a space", link: discord("player one"), wantErr: "Discord usernames"},
		{name: "Discord username not lowercased", link: discord("Player"), wantErr: "Discord usernames"},
		{name: "Discord link with a URL", link: SocialLink{Kind: SocialLinkKindDiscord, Label: DiscordSocialLinkLabel, Username: "player", URL: "https://discord.gg/invite"}, wantErr: "cannot have a URL"},
		{name: "URL link with a username", link: SocialLink{Kind: SocialLinkKindURL, Label: "Twitch", URL: "https://twitch.tv/player", Username: "player"}, wantErr: "cannot have a username"},
		{name: "URL link without a URL", link: SocialLink{Kind: SocialLinkKindURL, Label: "Twitch"}, wantErr: "valid HTTP or HTTPS URLs"},
		{name: "unknown kind", link: SocialLink{Kind: "steam", Label: "Steam", Username: "player"}, wantErr: "kind must be url or discord"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateProfileUpdate(update, []SocialLink{test.link})
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidateProfileUpdate() error = %v, want nil", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("ValidateProfileUpdate() error = %v, want one containing %q", err, test.wantErr)
			}
		})
	}
}
