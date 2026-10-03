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
	return parseCursorPair(values, pagecursor.Decode)
}

// parseKeyListCursors reads the after and before cursors of a list paged by a
// text sort key rather than a timestamp.
func parseKeyListCursors(values url.Values) (*pagecursor.KeyCursor, *pagecursor.KeyCursor, error) {
	return parseCursorPair(values, pagecursor.DecodeKey)
}

func parseCursorPair[C any](values url.Values, decode func(string) (C, error)) (*C, *C, error) {
	afterValue := values.Get("after")
	beforeValue := values.Get("before")
	if afterValue != "" && beforeValue != "" {
		return nil, nil, pagecursor.ErrInvalid
	}

	var after *C
	if afterValue != "" {
		decoded, err := decode(afterValue)
		if err != nil {
			return nil, nil, err
		}
		after = &decoded
	}

	var before *C
	if beforeValue != "" {
		decoded, err := decode(beforeValue)
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
	return makePage(items, limit, after != nil, before != nil, func(item T) string {
		timestamp, id := key(item)
		return pagecursor.Encode(timestamp, id)
	})
}

// makeKeyCursorPage is makeCursorPage for a list paged by a text sort key.
func makeKeyCursorPage[T any](
	items []T,
	limit int,
	after *pagecursor.KeyCursor,
	before *pagecursor.KeyCursor,
	key func(T) (string, string),
) cursorPage[T] {
	return makePage(items, limit, after != nil, before != nil, func(item T) string {
		sortKey, id := key(item)
		return pagecursor.EncodeKey(sortKey, id)
	})
}

// makePage trims the lookahead row a list query fetched beyond the limit and
// derives the navigation flags and cursors. Forward pages drop the lookahead
// from the end; a page read backward drops it from the front.
func makePage[T any](
	items []T,
	limit int,
	hasAfter bool,
	hasBefore bool,
	encode func(T) string,
) cursorPage[T] {
	hasLookahead := len(items) > limit
	if hasLookahead {
		if hasBefore {
			items = items[1:]
		} else {
			items = items[:limit]
		}
	}

	page := cursorPage[T]{
		Items:       items,
		HasMore:     hasBefore || hasLookahead,
		HasPrevious: hasAfter || (hasBefore && hasLookahead),
	}
	if len(items) == 0 {
		return page
	}
	if page.HasPrevious {
		page.PreviousCursor = encode(items[0])
	}
	if page.HasMore {
		page.NextCursor = encode(items[len(items)-1])
	}
	return page
}
