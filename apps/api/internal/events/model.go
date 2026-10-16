package events

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"time"
)

// GenerateSlug returns a stable, URL-safe slug for an event.
func GenerateSlug(title string, creatorUserID string, createdAt time.Time) string {
	base := Slugify(title)
	hash := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(creatorUserID),
		createdAt.UTC().Format(time.DateOnly),
		strings.TrimSpace(title),
	}, "|")))
	suffix := base64.RawURLEncoding.EncodeToString(hash[:])[:8]

	return base + "-" + suffix
}

// Slugify converts a title into a URL-safe slug.
func Slugify(value string) string {
	var builder strings.Builder
	previousHyphen := false

	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		isAlphaNumeric := (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')
		isSeparator := character == ' ' || character == '-' || character == '_'

		switch {
		case isAlphaNumeric:
			builder.WriteRune(character)
			previousHyphen = false
		case isSeparator && !previousHyphen && builder.Len() > 0:
			builder.WriteRune('-')
			previousHyphen = true
		}
	}

	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "event"
	}
	return result
}

// Lifecycle returns the current display state of an event.
func Lifecycle(now time.Time, startsAt time.Time, endsAt time.Time, capacity *int, yesCount int) string {
	if !now.Before(endsAt) {
		return LifecycleEnded
	}
	if capacity != nil && yesCount >= *capacity {
		return LifecycleFull
	}
	if !now.Before(startsAt) {
		return LifecycleHappeningNow
	}
	return LifecycleUpcoming
}

// IsPrivate reports whether the event is private.
func (e Event) IsPrivate() bool {
	return e.Visibility == VisibilityPrivate
}

// HideOnlineURLUnlessGoing removes the online meeting link unless the viewer
// RSVP'd yes or can edit the event: only people going, and the organizers who
// manage the event, receive it. Call it after the viewer fields are set; an
// event with none (a public list) always loses the link.
func (e *Event) HideOnlineURLUnlessGoing() {
	if e.ViewerCanEdit || (e.ViewerRSVP != nil && *e.ViewerRSVP == RSVPYes) {
		return
	}
	e.OnlineURL = ""
}

// Locked returns the placeholder shown for a private event the viewer has not
// unlocked.
func (e Event) Locked() LockedEvent {
	return LockedEvent{
		Slug:       e.Slug,
		Visibility: e.Visibility,
		Locked:     true,
	}
}
