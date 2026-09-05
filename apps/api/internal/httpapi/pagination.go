package httpapi

import (
	"errors"
	"net/url"
	"strconv"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

const (
	defaultListLimit = 25
	maximumListLimit = 100
)

type cursorPage[T any] struct {
	Items          []T
	HasMore        bool
	HasPrevious    bool
	NextCursor     string
	PreviousCursor string
}

func parseListLimit(values url.Values) (int, error) {
	value := values.Get("limit")
	if value == "" {
		return defaultListLimit, nil
	}

	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > maximumListLimit {
		return 0, errors.New("invalid limit")
	}
	return limit, nil
}

func parseListCursors(values url.Values) (*pagecursor.Cursor, *pagecursor.Cursor, error) {
	afterValue := values.Get("after")
	beforeValue := values.Get("before")
	if afterValue != "" && beforeValue != "" {
		return nil, nil, pagecursor.ErrInvalid
	}

	var after *pagecursor.Cursor
	if afterValue != "" {
		decoded, err := pagecursor.Decode(afterValue)
		if err != nil {
			return nil, nil, err
		}
		after = &decoded
	}

	var before *pagecursor.Cursor
	if beforeValue != "" {
		decoded, err := pagecursor.Decode(beforeValue)
		if err != nil {
			return nil, nil, err
		}
		before = &decoded
	}

	return after, before, nil
}

func makeCursorPage[T any](
	items []T,
	limit int,
	after *pagecursor.Cursor,
	before *pagecursor.Cursor,
	key func(T) (time.Time, string),
) cursorPage[T] {
	hasLookahead := len(items) > limit
	if hasLookahead {
		if before != nil {
			items = items[1:]
		} else {
			items = items[:limit]
		}
	}

	page := cursorPage[T]{
		Items:       items,
		HasMore:     before != nil || hasLookahead,
		HasPrevious: after != nil || (before != nil && hasLookahead),
	}
	if len(items) == 0 {
		return page
	}
	if page.HasPrevious {
		timestamp, id := key(items[0])
		page.PreviousCursor = pagecursor.Encode(timestamp, id)
	}
	if page.HasMore {
		timestamp, id := key(items[len(items)-1])
		page.NextCursor = pagecursor.Encode(timestamp, id)
	}
	return page
}
