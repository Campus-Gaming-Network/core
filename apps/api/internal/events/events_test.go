package events

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateSlugUsesTitleAndStableHashSuffix(t *testing.T) {
	createdAt := time.Date(2026, 8, 15, 20, 30, 0, 0, time.UTC)

	slug := GenerateSlug("Rocket League Kickoff!", "user-1", createdAt)
	again := GenerateSlug("Rocket League Kickoff!", "user-1", createdAt)
	otherUser := GenerateSlug("Rocket League Kickoff!", "user-2", createdAt)

	if !strings.HasPrefix(slug, "rocket-league-kickoff-") {
		t.Fatalf("GenerateSlug() = %q, want slugified title prefix", slug)
	}
	if len(strings.TrimPrefix(slug, "rocket-league-kickoff-")) != 8 {
		t.Fatalf("GenerateSlug() = %q, want 8-character hash suffix", slug)
	}
	if slug != again {
		t.Fatalf("GenerateSlug() = %q and %q, want deterministic output", slug, again)
	}
	if slug == otherUser {
		t.Fatalf("GenerateSlug() = %q for different creators, want different suffix", slug)
	}
}

func TestGenerateSlugUsesUTCCreationDate(t *testing.T) {
	createdAt := time.Date(2026, 8, 15, 1, 30, 0, 0, time.UTC)
	sameUTCDay := createdAt.Add(20 * time.Hour)
	sameInstantWithOffset := createdAt.In(time.FixedZone("Pacific", -7*60*60))
	nextUTCDay := createdAt.Add(24 * time.Hour)

	slug := GenerateSlug("Rocket League Kickoff!", "user-1", createdAt)
	if got := GenerateSlug("Rocket League Kickoff!", "user-1", sameUTCDay); got != slug {
		t.Fatalf("GenerateSlug() = %q for the same UTC date, want %q", got, slug)
	}
	if got := GenerateSlug("Rocket League Kickoff!", "user-1", sameInstantWithOffset); got != slug {
		t.Fatalf("GenerateSlug() = %q for the same instant in another timezone, want %q", got, slug)
	}
	if got := GenerateSlug("Rocket League Kickoff!", "user-1", nextUTCDay); got == slug {
		t.Fatalf("GenerateSlug() = %q for a different UTC date, want a different slug", got)
	}
}

func TestSlugifyFallsBackForEmptyTitles(t *testing.T) {
	if got := Slugify("  !!!  "); got != "event" {
		t.Fatalf("Slugify() = %q, want fallback", got)
	}
	if got := Slugify("CGN  Night___One"); got != "cgn-night-one" {
		t.Fatalf("Slugify() = %q, want normalized slug", got)
	}
}

func TestLifecycle(t *testing.T) {
	now := time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC)
	startsAt := now.Add(time.Hour)
	endsAt := now.Add(2 * time.Hour)
	capacity := 2

	cases := []struct {
		name     string
		now      time.Time
		capacity *int
		yesCount int
		want     string
	}{
		{name: "upcoming", now: now, want: LifecycleUpcoming},
		{name: "happening now", now: startsAt.Add(15 * time.Minute), want: LifecycleHappeningNow},
		{name: "full", now: now, capacity: &capacity, yesCount: 2, want: LifecycleFull},
		{name: "ended", now: endsAt, capacity: &capacity, yesCount: 2, want: LifecycleEnded},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := Lifecycle(tt.now, startsAt, endsAt, tt.capacity, tt.yesCount); got != tt.want {
				t.Fatalf("Lifecycle() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestValidateCreateInputAcceptsMinimalPublicEvent(t *testing.T) {
	err := ValidateCreateInput(CreateInput{
		Title:         "Campus Scrim Night",
		CreatorUserID: "user-id",
		HostSchoolID:  "school-id",
		GameIDs:       []string{"game-id"},
		Visibility:    VisibilityPublic,
		Format:        FormatInPerson,
		StartsAt:      time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:        time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		Timezone:      "America/Los_Angeles",
	})
	if err != nil {
		t.Fatalf("ValidateCreateInput() error = %v", err)
	}
}

func TestValidateCreateInputRejectsPrivateEventWithoutPassword(t *testing.T) {
	err := ValidateCreateInput(validCreateInput(func(input *CreateInput) {
		input.Visibility = VisibilityPrivate
		input.PrivatePassword = "short"
	}))
	if err == nil || !strings.Contains(err.Error(), "private events require") {
		t.Fatalf("ValidateCreateInput() error = %v, want private password error", err)
	}
}

func TestValidateCreateInputRejectsInvalidCapacityAndPaymentURL(t *testing.T) {
	zero := 0
	for _, input := range []CreateInput{
		validCreateInput(func(input *CreateInput) {
			input.Capacity = &zero
		}),
		validCreateInput(func(input *CreateInput) {
			input.PaymentURL = "javascript:alert(1)"
		}),
	} {
		if err := ValidateCreateInput(input); err == nil {
			t.Fatalf("ValidateCreateInput() error = nil, want validation error for %#v", input)
		}
	}
}

func TestValidateRSVPInput(t *testing.T) {
	valid := RSVPInput{
		Slug:     "campus-scrim-night",
		UserID:   "user-id",
		Response: RSVPMaybe,
	}
	if err := ValidateRSVPInput(valid); err != nil {
		t.Fatalf("ValidateRSVPInput() error = %v", err)
	}

	invalid := valid
	invalid.Response = "definitely"
	if err := ValidateRSVPInput(invalid); err == nil {
		t.Fatal("ValidateRSVPInput() error = nil, want invalid response error")
	}
}

func validCreateInput(mutate func(*CreateInput)) CreateInput {
	input := CreateInput{
		Title:         "Campus Scrim Night",
		CreatorUserID: "user-id",
		HostSchoolID:  "school-id",
		GameIDs:       []string{"game-id"},
		Visibility:    VisibilityPublic,
		Format:        FormatOnline,
		StartsAt:      time.Date(2026, 8, 15, 20, 0, 0, 0, time.UTC),
		EndsAt:        time.Date(2026, 8, 15, 22, 0, 0, 0, time.UTC),
		Timezone:      "America/Los_Angeles",
	}
	mutate(&input)
	return input
}
