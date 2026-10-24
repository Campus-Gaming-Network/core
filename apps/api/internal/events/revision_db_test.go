package events

import (
	"context"
	"reflect"
	"testing"
	"time"
)

// The revision a calendar file carries as SEQUENCE rises with each change the
// file shows and with cancelling, and not with a save that changes nothing
// the file shows.
func TestEventRevisionRisesOnlyWithCalendarChanges(t *testing.T) {
	ctx := context.Background()
	f := newOrganizerFixture(t)
	creator := f.user(t, "Creator")
	event := f.event(t, creator, "Calendar Night", VisibilityPublic)
	revision := func() int {
		t.Helper()
		var value int
		if err := f.pool.QueryRow(ctx, `SELECT revision FROM events WHERE id = $1::uuid`, event.ID).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	update := func(change func(*UpdateInput)) int {
		t.Helper()
		input := UpdateInput{
			Slug: event.Slug, EditorUserID: creator, Title: event.Title, HostSchoolID: f.schoolID,
			GameIDs: []string{f.gameID}, Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceOpen,
			EventType: EventTypeGameNight, StartsAt: event.StartsAt, EndsAt: event.EndsAt, Timezone: "UTC",
		}
		change(&input)
		updated, err := f.repository.Update(ctx, UpdateParams{UpdateInput: input})
		if err != nil {
			t.Fatalf("Update() error = %v", err)
		}
		if updated.Revision != revision() {
			t.Fatalf("Update() returned revision %d, stored %d", updated.Revision, revision())
		}
		return updated.Revision
	}
	capacity := 10
	moveADay := func(in *UpdateInput) {
		in.StartsAt, in.EndsAt = event.StartsAt.Add(24*time.Hour), event.EndsAt.Add(24*time.Hour)
	}

	got := []int{
		event.Revision,
		update(moveADay),
		update(moveADay),
		update(func(in *UpdateInput) {
			moveADay(in)
			in.Capacity = &capacity
		}),
	}
	if err := f.repository.Delete(ctx, event.Slug, creator); err != nil {
		t.Fatal(err)
	}
	got = append(got, revision())

	// Created at 0; moving it raises it; the same values again leave it;
	// capacity alone is not in the file; cancelling raises it.
	if want := []int{0, 1, 1, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("revisions = %v, want %v", got, want)
	}
}
