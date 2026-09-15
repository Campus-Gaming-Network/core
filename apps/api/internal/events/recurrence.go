package events

import (
	"sort"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
)

type localDateTime struct {
	year       int
	month      time.Month
	day        int
	hour       int
	minute     int
	second     int
	nanosecond int
}

type recurrenceSchedule struct {
	rule     string
	location *time.Location
	anchor   localDateTime
	duration time.Duration
}

func newRecurrenceSchedule(rule string, startsAt time.Time, endsAt time.Time, timezone string) (recurrenceSchedule, error) {
	if !validRecurrenceRule(rule) {
		return recurrenceSchedule{}, apperror.Validation("recurrence rule is invalid")
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return recurrenceSchedule{}, apperror.Validation("recurrence timezone is invalid")
	}
	if !endsAt.After(startsAt) {
		return recurrenceSchedule{}, apperror.Validation("recurrence duration must be positive")
	}

	localStart := startsAt.In(location)
	return recurrenceSchedule{
		rule:     rule,
		location: location,
		anchor:   localDateTimeFromTime(localStart),
		duration: endsAt.Sub(startsAt),
	}, nil
}

// occurrence returns the occurrence at a zero-based offset from the root event.
// Its start remains anchored to the event's local wall-clock time while its end
// preserves the root event's elapsed duration.
func (schedule recurrenceSchedule) occurrence(index int) (time.Time, time.Time, error) {
	if index < 0 {
		return time.Time{}, time.Time{}, apperror.Validation("recurrence occurrence index cannot be negative")
	}

	target := schedule.targetLocalDateTime(index)
	start, err := resolveLocalDateTime(target, schedule.location)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, start.Add(schedule.duration), nil
}

func (schedule recurrenceSchedule) targetLocalDateTime(index int) localDateTime {
	target := schedule.anchor
	if schedule.rule == RecurrenceMonthly {
		monthIndex := int(schedule.anchor.month) - 1 + index
		target.year = schedule.anchor.year + monthIndex/12
		target.month = time.Month(monthIndex%12 + 1)
		lastDay := time.Date(target.year, target.month+1, 0, 0, 0, 0, 0, time.UTC).Day()
		if target.day > lastDay {
			target.day = lastDay
		}
		return target
	}

	days := index * 7
	if schedule.rule == RecurrenceBiweekly {
		days *= 2
	}
	date := time.Date(
		schedule.anchor.year,
		schedule.anchor.month,
		schedule.anchor.day,
		0, 0, 0, 0,
		time.UTC,
	).AddDate(0, 0, days)
	target.year, target.month, target.day = date.Date()
	return target
}

func resolveLocalDateTime(value localDateTime, location *time.Location) (time.Time, error) {
	candidates, offsets := localDateTimeCandidates(value, location)
	if len(candidates) > 0 {
		return candidates[0], nil
	}

	// A nonexistent spring-forward time is moved forward by the transition gap.
	// Trying the observed offset changes also handles non-hour historical gaps.
	gapSet := make(map[time.Duration]struct{})
	for left := range offsets {
		for right := range offsets {
			gap := time.Duration(right-left) * time.Second
			if gap > 0 {
				gapSet[gap] = struct{}{}
			}
		}
	}
	gaps := make([]time.Duration, 0, len(gapSet))
	for gap := range gapSet {
		gaps = append(gaps, gap)
	}
	sort.Slice(gaps, func(left int, right int) bool { return gaps[left] < gaps[right] })

	naive := value.naiveTime()
	for _, gap := range gaps {
		shifted := localDateTimeFromTime(naive.Add(gap))
		shiftedCandidates, _ := localDateTimeCandidates(shifted, location)
		if len(shiftedCandidates) > 0 {
			return shiftedCandidates[0], nil
		}
	}
	return time.Time{}, apperror.Validation("recurrence local time could not be resolved")
}

func localDateTimeCandidates(value localDateTime, location *time.Location) ([]time.Time, map[int]struct{}) {
	naive := value.naiveTime()
	probeStart := naive.Add(-48 * time.Hour)
	probeEnd := naive.Add(48 * time.Hour)
	offsets := make(map[int]struct{})
	for probe := probeStart; !probe.After(probeEnd); probe = probe.Add(15 * time.Minute) {
		_, offset := probe.In(location).Zone()
		offsets[offset] = struct{}{}
	}

	candidates := make([]time.Time, 0, 2)
	for offset := range offsets {
		candidate := naive.Add(-time.Duration(offset) * time.Second)
		if value.matches(candidate.In(location)) {
			candidates = append(candidates, candidate)
		}
	}
	sort.Slice(candidates, func(left int, right int) bool {
		return candidates[left].Before(candidates[right])
	})
	return candidates, offsets
}

func localDateTimeFromTime(value time.Time) localDateTime {
	return localDateTime{
		year:       value.Year(),
		month:      value.Month(),
		day:        value.Day(),
		hour:       value.Hour(),
		minute:     value.Minute(),
		second:     value.Second(),
		nanosecond: value.Nanosecond(),
	}
}

func (value localDateTime) naiveTime() time.Time {
	return time.Date(
		value.year,
		value.month,
		value.day,
		value.hour,
		value.minute,
		value.second,
		value.nanosecond,
		time.UTC,
	)
}

func (value localDateTime) matches(candidate time.Time) bool {
	return value.year == candidate.Year() &&
		value.month == candidate.Month() &&
		value.day == candidate.Day() &&
		value.hour == candidate.Hour() &&
		value.minute == candidate.Minute() &&
		value.second == candidate.Second() &&
		value.nanosecond == candidate.Nanosecond()
}
