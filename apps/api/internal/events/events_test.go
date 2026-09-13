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

func TestValidateCreateInputRejectsBlockedLanguage(t *testing.T) {
	input := validCreateInput(func(input *CreateInput) {
		input.Title = "Campus bullshit night"
	})
	if err := ValidateCreateInput(input); err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("ValidateCreateInput() error = %v, want blocked-language error", err)
	}
}

func TestValidateCreateInputAcceptsBoundedRecurrence(t *testing.T) {
	input := validCreateInput(func(input *CreateInput) {
		input.RecurrenceRule = RecurrenceWeekly
		input.RecurrenceUntil = input.StartsAt.AddDate(0, 0, 21)
	})
	if err := ValidateCreateInput(input); err != nil {
		t.Fatalf("ValidateCreateInput() error = %v, want recurring event accepted", err)
	}
}

func TestValidateCreateInputAcceptsRecurrenceThroughOneYearCalendarDate(t *testing.T) {
	input := validCreateInput(func(input *CreateInput) {
		input.RecurrenceRule = RecurrenceMonthly
		oneYearLater := input.StartsAt.AddDate(1, 0, 0)
		input.RecurrenceUntil = time.Date(
			oneYearLater.Year(),
			oneYearLater.Month(),
			oneYearLater.Day(),
			23, 59, 59, int(time.Second-time.Nanosecond),
			oneYearLater.Location(),
		)
	})
	if err := ValidateCreateInput(input); err != nil {
		t.Fatalf("ValidateCreateInput() error = %v, want same calendar date next year accepted", err)
	}
}

func TestValidateCreateInputRejectsInvalidRecurrence(t *testing.T) {
	for _, mutate := range []func(*CreateInput){
		func(input *CreateInput) {
			input.RecurrenceRule = "daily"
			input.RecurrenceUntil = input.StartsAt.AddDate(0, 0, 7)
		},
		func(input *CreateInput) {
			input.RecurrenceRule = RecurrenceMonthly
			input.RecurrenceUntil = input.StartsAt.AddDate(1, 0, 1)
		},
	} {
		if err := ValidateCreateInput(validCreateInput(mutate)); err == nil {
			t.Fatal("ValidateCreateInput() error = nil, want recurrence validation error")
		}
	}
}

func TestRecurrenceScheduleSupportsWeeklyAndBiweeklyIntervals(t *testing.T) {
	start := time.Date(2026, 1, 10, 20, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		rule string
		want time.Time
	}{
		{rule: RecurrenceWeekly, want: time.Date(2026, 1, 17, 20, 0, 0, 0, time.UTC)},
		{rule: RecurrenceBiweekly, want: time.Date(2026, 1, 24, 20, 0, 0, 0, time.UTC)},
	} {
		t.Run(test.rule, func(t *testing.T) {
			schedule := mustRecurrenceSchedule(t, test.rule, start, start.Add(2*time.Hour), "UTC")
			got, gotEnd, err := schedule.occurrence(1)
			if err != nil {
				t.Fatalf("occurrence() error = %v", err)
			}
			if !got.Equal(test.want) || !gotEnd.Equal(test.want.Add(2*time.Hour)) {
				t.Fatalf("occurrence() = %s - %s, want %s - %s", got, gotEnd, test.want, test.want.Add(2*time.Hour))
			}
		})
	}
}

func TestRecurrenceSchedulePreservesWallClockAcrossDST(t *testing.T) {
	for _, test := range []struct {
		name       string
		timezone   string
		anchor     time.Time
		wantDate   time.Time
		wantOffset int
	}{
		{
			name:       "Los Angeles spring forward",
			timezone:   "America/Los_Angeles",
			anchor:     time.Date(2027, time.March, 7, 19, 0, 0, 0, mustLocation(t, "America/Los_Angeles")),
			wantDate:   time.Date(2027, time.March, 14, 19, 0, 0, 0, time.UTC),
			wantOffset: -7 * 60 * 60,
		},
		{
			name:       "Los Angeles fall back",
			timezone:   "America/Los_Angeles",
			anchor:     time.Date(2027, time.October, 31, 19, 0, 0, 0, mustLocation(t, "America/Los_Angeles")),
			wantDate:   time.Date(2027, time.November, 7, 19, 0, 0, 0, time.UTC),
			wantOffset: -8 * 60 * 60,
		},
		{
			name:       "New York spring forward",
			timezone:   "America/New_York",
			anchor:     time.Date(2027, time.March, 7, 19, 0, 0, 0, mustLocation(t, "America/New_York")),
			wantDate:   time.Date(2027, time.March, 14, 19, 0, 0, 0, time.UTC),
			wantOffset: -4 * 60 * 60,
		},
		{
			name:       "New York fall back",
			timezone:   "America/New_York",
			anchor:     time.Date(2027, time.October, 31, 19, 0, 0, 0, mustLocation(t, "America/New_York")),
			wantDate:   time.Date(2027, time.November, 7, 19, 0, 0, 0, time.UTC),
			wantOffset: -5 * 60 * 60,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			schedule := mustRecurrenceSchedule(t, RecurrenceWeekly, test.anchor, test.anchor.Add(90*time.Minute), test.timezone)
			got, gotEnd, err := schedule.occurrence(1)
			if err != nil {
				t.Fatalf("occurrence() error = %v", err)
			}
			local := got.In(mustLocation(t, test.timezone))
			if local.Year() != test.wantDate.Year() || local.Month() != test.wantDate.Month() || local.Day() != test.wantDate.Day() || local.Hour() != 19 {
				t.Fatalf("occurrence() local start = %s, want %s at 19:00", local, test.wantDate.Format(time.DateOnly))
			}
			_, offset := local.Zone()
			if offset != test.wantOffset {
				t.Fatalf("occurrence() offset = %d, want %d", offset, test.wantOffset)
			}
			if gotEnd.Sub(got) != 90*time.Minute {
				t.Fatalf("occurrence() duration = %s, want 90m", gotEnd.Sub(got))
			}
		})
	}
}

func TestRecurrenceScheduleMovesNonexistentStartForwardByDSTGap(t *testing.T) {
	for _, test := range []struct {
		timezone string
		offset   int
	}{
		{timezone: "America/Los_Angeles", offset: -7 * 60 * 60},
		{timezone: "America/New_York", offset: -4 * 60 * 60},
	} {
		t.Run(test.timezone, func(t *testing.T) {
			location := mustLocation(t, test.timezone)
			anchor := time.Date(2027, time.March, 7, 2, 30, 0, 0, location)
			schedule := mustRecurrenceSchedule(t, RecurrenceWeekly, anchor, anchor.Add(90*time.Minute), test.timezone)
			got, gotEnd, err := schedule.occurrence(1)
			if err != nil {
				t.Fatalf("occurrence() error = %v", err)
			}
			local := got.In(location)
			if local.Year() != 2027 || local.Month() != time.March || local.Day() != 14 || local.Hour() != 3 || local.Minute() != 30 {
				t.Fatalf("occurrence() local start = %s, want 2027-03-14 03:30", local)
			}
			_, offset := local.Zone()
			if offset != test.offset {
				t.Fatalf("occurrence() offset = %d, want %d", offset, test.offset)
			}
			if gotEnd.Sub(got) != 90*time.Minute {
				t.Fatalf("occurrence() duration = %s, want 90m", gotEnd.Sub(got))
			}
		})
	}
}

func TestRecurrenceScheduleUsesEarlierInstantForRepeatedStart(t *testing.T) {
	for _, test := range []struct {
		timezone string
		wantUTC  time.Time
	}{
		{timezone: "America/Los_Angeles", wantUTC: time.Date(2027, time.November, 7, 8, 30, 0, 0, time.UTC)},
		{timezone: "America/New_York", wantUTC: time.Date(2027, time.November, 7, 5, 30, 0, 0, time.UTC)},
	} {
		t.Run(test.timezone, func(t *testing.T) {
			location := mustLocation(t, test.timezone)
			anchor := time.Date(2027, time.October, 31, 1, 30, 0, 0, location)
			schedule := mustRecurrenceSchedule(t, RecurrenceWeekly, anchor, anchor.Add(time.Hour), test.timezone)
			got, _, err := schedule.occurrence(1)
			if err != nil {
				t.Fatalf("occurrence() error = %v", err)
			}
			if !got.Equal(test.wantUTC) {
				t.Fatalf("occurrence() = %s, want earlier repeated instant %s", got, test.wantUTC)
			}
		})
	}
}

func TestMonthlyRecurrenceKeepsOriginalDayAnchor(t *testing.T) {
	location := mustLocation(t, "America/Los_Angeles")
	anchor := time.Date(2028, time.January, 31, 19, 0, 0, 0, location)
	schedule := mustRecurrenceSchedule(t, RecurrenceMonthly, anchor, anchor.Add(90*time.Minute), location.String())
	wantDays := []int{31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31}

	for index, wantDay := range wantDays {
		got, gotEnd, err := schedule.occurrence(index)
		if err != nil {
			t.Fatalf("occurrence(%d) error = %v", index, err)
		}
		local := got.In(location)
		wantMonth := time.Month(index%12 + 1)
		wantYear := 2028 + index/12
		if local.Year() != wantYear || local.Month() != wantMonth || local.Day() != wantDay || local.Hour() != 19 {
			t.Fatalf("occurrence(%d) local start = %s, want %04d-%02d-%02d 19:00", index, local, wantYear, wantMonth, wantDay)
		}
		if gotEnd.Sub(got) != 90*time.Minute {
			t.Fatalf("occurrence(%d) duration = %s, want 90m", index, gotEnd.Sub(got))
		}
	}
}

func mustRecurrenceSchedule(t *testing.T, rule string, startsAt time.Time, endsAt time.Time, timezone string) recurrenceSchedule {
	t.Helper()
	schedule, err := newRecurrenceSchedule(rule, startsAt, endsAt, timezone)
	if err != nil {
		t.Fatalf("newRecurrenceSchedule() error = %v", err)
	}
	return schedule
}

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	location, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("time.LoadLocation(%q) error = %v", name, err)
	}
	return location
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
