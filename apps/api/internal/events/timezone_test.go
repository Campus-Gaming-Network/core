package events

import (
	"strings"
	"testing"
	"time"
)

func TestRecurrenceScheduleResolvesChicagoWallClockAtDSTEdges(t *testing.T) {
	location := mustLocation(t, "America/Chicago")
	for _, test := range []struct {
		name   string
		rule   string
		anchor time.Time
		want   time.Time
	}{
		{
			name:   "weekly 7pm across spring forward stays 7pm CDT",
			rule:   RecurrenceWeekly,
			anchor: time.Date(2027, time.March, 7, 19, 0, 0, 0, location),
			want:   time.Date(2027, time.March, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "weekly 7pm across fall back stays 7pm CST",
			rule:   RecurrenceWeekly,
			anchor: time.Date(2027, time.October, 31, 19, 0, 0, 0, location),
			want:   time.Date(2027, time.November, 8, 1, 0, 0, 0, time.UTC),
		},
		{
			name:   "biweekly 7pm across fall back stays 7pm CST",
			rule:   RecurrenceBiweekly,
			anchor: time.Date(2027, time.October, 25, 19, 0, 0, 0, location),
			want:   time.Date(2027, time.November, 9, 1, 0, 0, 0, time.UTC),
		},
		{
			name:   "nonexistent 2:30am on spring forward day becomes 3:30am CDT",
			rule:   RecurrenceWeekly,
			anchor: time.Date(2027, time.March, 7, 2, 30, 0, 0, location),
			want:   time.Date(2027, time.March, 14, 8, 30, 0, 0, time.UTC),
		},
		{
			name:   "ambiguous 1:30am on fall back day uses the first CDT instant",
			rule:   RecurrenceWeekly,
			anchor: time.Date(2027, time.October, 31, 1, 30, 0, 0, location),
			want:   time.Date(2027, time.November, 7, 6, 30, 0, 0, time.UTC),
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			schedule := mustRecurrenceSchedule(t, test.rule, test.anchor, test.anchor.Add(time.Hour), "America/Chicago")
			got, _, err := schedule.occurrence(1)
			if err != nil {
				t.Fatalf("occurrence() error = %v", err)
			}
			if !got.Equal(test.want) {
				t.Fatalf("occurrence() = %s, want %s", got.UTC(), test.want)
			}
		})
	}
}

func TestRecurrenceScheduleKeepsElapsedDurationForOvernightEventAcrossDST(t *testing.T) {
	location := mustLocation(t, "America/Chicago")
	// Saturday 10pm to Sunday 2am CST. The next occurrence starts 10pm on
	// March 13; the clock springs forward at 2am, so four elapsed hours end at
	// 3am CDT on March 14 and the event still crosses midnight.
	anchor := time.Date(2027, time.March, 6, 22, 0, 0, 0, location)
	schedule := mustRecurrenceSchedule(t, RecurrenceWeekly, anchor, anchor.Add(4*time.Hour), "America/Chicago")
	start, end, err := schedule.occurrence(1)
	if err != nil {
		t.Fatalf("occurrence() error = %v", err)
	}
	want := [2]time.Time{
		time.Date(2027, time.March, 13, 22, 0, 0, 0, location),
		time.Date(2027, time.March, 14, 3, 0, 0, 0, location),
	}
	if got := [2]time.Time{start, end}; !got[0].Equal(want[0]) || !got[1].Equal(want[1]) {
		t.Fatalf("occurrence() = %s to %s, want %s to %s", start.In(location), end.In(location), want[0], want[1])
	}
}

func TestLifecycleAtBoundaryInstants(t *testing.T) {
	startsAt := time.Date(2026, time.November, 1, 6, 0, 0, 0, time.UTC)
	endsAt := startsAt.Add(2 * time.Hour)
	for _, test := range []struct {
		name string
		now  time.Time
		want string
	}{
		{name: "one nanosecond before start", now: startsAt.Add(-time.Nanosecond), want: LifecycleUpcoming},
		{name: "exactly at start", now: startsAt, want: LifecycleHappeningNow},
		{name: "one nanosecond before end", now: endsAt.Add(-time.Nanosecond), want: LifecycleHappeningNow},
		{name: "exactly at end", now: endsAt, want: LifecycleEnded},
		{name: "viewer zone does not change the instant", now: endsAt.In(time.FixedZone("UTC-5", -5*60*60)), want: LifecycleEnded},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := Lifecycle(test.now, startsAt, endsAt, nil, 0); got != test.want {
				t.Fatalf("Lifecycle() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestEventConfirmationHTMLShowsStartInEventTimezone(t *testing.T) {
	startsAt := time.Date(2026, time.November, 2, 1, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name     string
		startsAt time.Time
		timezone string
		want     string
	}{
		{name: "Chicago standard time", startsAt: startsAt, timezone: "America/Chicago", want: "Sun, Nov 1, 2026, 7:00 PM CST"},
		{name: "Chicago daylight time", startsAt: time.Date(2026, time.July, 5, 0, 0, 0, 0, time.UTC), timezone: "America/Chicago", want: "Sat, Jul 4, 2026, 7:00 PM CDT"},
		{name: "Honolulu has no daylight time", startsAt: startsAt, timezone: "Pacific/Honolulu", want: "Sun, Nov 1, 2026, 3:00 PM HST"},
		{name: "unusable zone falls back to UTC", startsAt: startsAt, timezone: "Not/AZone", want: "Mon, Nov 2, 2026, 1:00 AM UTC"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := eventConfirmationHTML(Event{Title: "Game night", StartsAt: test.startsAt, Timezone: test.timezone}, "https://example.test/events/game-night")
			if !strings.Contains(body, "<strong>When:</strong> "+test.want+"</p>") {
				t.Fatalf("eventConfirmationHTML() = %q, want When line %q", body, test.want)
			}
		})
	}
}
