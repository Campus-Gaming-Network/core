package httpapi

import (
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

type paginationItem struct {
	ID        string
	Timestamp time.Time
}

func TestMakeCursorPageTrimsForwardLookahead(t *testing.T) {
	items := paginationItems(4)
	page := makeCursorPage(items, 3, nil, nil, paginationItemKey)

	if len(page.Items) != 3 || !page.HasMore || page.HasPrevious {
		t.Fatalf("page = %#v, want three items with only a next page", page)
	}
	decoded, err := pagecursor.Decode(page.NextCursor)
	if err != nil || decoded.ID != items[2].ID {
		t.Fatalf("next cursor = %#v, %v; want third item", decoded, err)
	}
}

func TestMakeCursorPageTrimsBackwardLookaheadFromTheFront(t *testing.T) {
	items := paginationItems(4)
	before := pagecursor.Cursor{Timestamp: items[3].Timestamp.Add(time.Hour), ID: "99999999-9999-9999-9999-999999999999"}
	page := makeCursorPage(items, 3, nil, &before, paginationItemKey)

	if len(page.Items) != 3 || page.Items[0].ID != items[1].ID {
		t.Fatalf("items = %#v, want the lookahead item removed from the front", page.Items)
	}
	if !page.HasMore || !page.HasPrevious || page.NextCursor == "" || page.PreviousCursor == "" {
		t.Fatalf("page = %#v, want navigation in both directions", page)
	}
}

func paginationItems(count int) []paginationItem {
	items := make([]paginationItem, 0, count)
	for index := 0; index < count; index++ {
		items = append(items, paginationItem{
			ID: []string{
				"11111111-1111-1111-1111-111111111111",
				"22222222-2222-2222-2222-222222222222",
				"33333333-3333-3333-3333-333333333333",
				"44444444-4444-4444-4444-444444444444",
			}[index],
			Timestamp: time.Date(2026, time.September, 5, index, 0, 0, 0, time.UTC),
		})
	}
	return items
}

func paginationItemKey(item paginationItem) (time.Time, string) {
	return item.Timestamp, item.ID
}
