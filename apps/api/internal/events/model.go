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

func (e Event) IsPrivate() bool {
	return e.Visibility == VisibilityPrivate
}

func (e Event) Locked() LockedEvent {
	return LockedEvent{
		Slug:       e.Slug,
		Visibility: e.Visibility,
		Locked:     true,
	}
}
