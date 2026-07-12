package teams

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateSlugUsesNameAndStableHashSuffix(t *testing.T) {
	createdAt := time.Date(2026, 8, 15, 20, 30, 0, 0, time.UTC)

	slug := GenerateSlug("Varsity Rocket League!", "user-1", createdAt)
	again := GenerateSlug("Varsity Rocket League!", "user-1", createdAt)
	otherUser := GenerateSlug("Varsity Rocket League!", "user-2", createdAt)

	if !strings.HasPrefix(slug, "varsity-rocket-league-") {
		t.Fatalf("GenerateSlug() = %q, want slugified name prefix", slug)
	}
	if len(strings.TrimPrefix(slug, "varsity-rocket-league-")) != 8 {
		t.Fatalf("GenerateSlug() = %q, want 8-character hash suffix", slug)
	}
	if slug != again {
		t.Fatalf("GenerateSlug() = %q and %q, want deterministic output", slug, again)
	}
	if slug == otherUser {
		t.Fatalf("GenerateSlug() = %q for different owners, want different suffix", slug)
	}
}

func TestSlugifyFallsBackForEmptyNames(t *testing.T) {
	if got := Slugify("  !!!  "); got != "team" {
		t.Fatalf("Slugify() = %q, want fallback", got)
	}
	if got := Slugify("CGN  Team___One"); got != "cgn-team-one" {
		t.Fatalf("Slugify() = %q, want normalized slug", got)
	}
}

func TestValidateCreateInput(t *testing.T) {
	valid := CreateInput{
		Name:        "Varsity Rocket League",
		OwnerUserID: "user-id",
		GameIDs:     []string{"game-id"},
		Password:    "TeamPass8",
	}
	if err := ValidateCreateInput(valid); err != nil {
		t.Fatalf("ValidateCreateInput() error = %v", err)
	}

	invalid := valid
	invalid.Password = "short"
	if err := ValidateCreateInput(invalid); err == nil {
		t.Fatal("ValidateCreateInput() error = nil, want password validation error")
	}
}
