package seed

import (
	"strings"
	"testing"
)

func TestNormalizeDevUserInputDisabledWithoutEmail(t *testing.T) {
	_, enabled, err := normalizeDevUserInput(DevUserInput{})
	if err != nil {
		t.Fatalf("normalizeDevUserInput() error = %v", err)
	}
	if enabled {
		t.Fatal("dev user seeding enabled without an email")
	}
}

func TestNormalizeDevUserInputRequiresUsablePassword(t *testing.T) {
	_, enabled, err := normalizeDevUserInput(DevUserInput{
		Email:    "dev@example.test",
		Password: "short",
	})
	if !enabled {
		t.Fatal("dev user seeding disabled with an email")
	}
	if err == nil || !strings.Contains(err.Error(), "password") {
		t.Fatalf("error = %v, want password validation", err)
	}
}

func TestNormalizeDevUserInputAcceptsMinimumPasswordLength(t *testing.T) {
	_, enabled, err := normalizeDevUserInput(DevUserInput{
		Email:    "dev@example.test",
		Password: "12345678",
	})
	if err != nil {
		t.Fatalf("normalizeDevUserInput() error = %v", err)
	}
	if !enabled {
		t.Fatal("dev user seeding disabled with an email")
	}
}

func TestNormalizeDevUserInputDefaultsAndDeduplicatesSlugs(t *testing.T) {
	input, enabled, err := normalizeDevUserInput(DevUserInput{
		Email:    " DEV@Example.Test ",
		Password: "Password12345!",
		FollowedSchoolSlugs: []string{
			" California-State-University-Long-Beach ",
			"california-state-university-long-beach",
			"",
			"ARIZONA-STATE-UNIVERSITY-CAMPUS-IMMERSION",
		},
	})
	if err != nil {
		t.Fatalf("normalizeDevUserInput() error = %v", err)
	}
	if !enabled {
		t.Fatal("dev user seeding disabled with an email")
	}
	if input.Email != "dev@example.test" {
		t.Fatalf("email = %q, want normalized email", input.Email)
	}
	if input.Name != defaultDevUserName {
		t.Fatalf("name = %q, want default", input.Name)
	}
	if input.HomeSchoolSlug != defaultDevUserSchoolSlug {
		t.Fatalf("home school slug = %q, want default", input.HomeSchoolSlug)
	}
	if input.Timezone != defaultDevUserTimezone {
		t.Fatalf("timezone = %q, want default", input.Timezone)
	}
	wantSlugs := []string{
		"california-state-university-long-beach",
		"arizona-state-university-campus-immersion",
	}
	if len(input.FollowedSchoolSlugs) != len(wantSlugs) {
		t.Fatalf("followed slugs = %#v, want %#v", input.FollowedSchoolSlugs, wantSlugs)
	}
	for index, want := range wantSlugs {
		if input.FollowedSchoolSlugs[index] != want {
			t.Fatalf("followed slugs = %#v, want %#v", input.FollowedSchoolSlugs, wantSlugs)
		}
	}
}
