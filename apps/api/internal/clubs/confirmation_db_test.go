package clubs

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestAnOfficerConfirmsTheClubAndOldConfirmationsNeedRenewal(t *testing.T) {
	ctx := context.Background()
	f := newOfficerFixture(t)
	now := time.Date(2031, time.June, 1, 12, 0, 0, 0, time.UTC)
	f.repository.now = func() time.Time { return now }
	owner, member := f.user(t, "owner"), f.user(t, "member")
	f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{member, RoleMember})
	stale := f.club(t, "stale-club")
	recent := f.club(t, "recent-club")
	for clubID, age := range map[string]int{stale: 91, recent: 89} {
		if _, err := f.pool.Exec(ctx, `UPDATE clubs SET confirmed_at = $2, confirmed_source = 'cgn' WHERE id = $1::uuid`,
			clubID, now.AddDate(0, 0, -age)); err != nil {
			t.Fatal(err)
		}
	}

	if err := f.repository.Confirm(ctx, "smash-club", member); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("member Confirm() error = %v, want ErrNotClubOfficer", err)
	}
	if err := f.repository.Confirm(ctx, "smash-club", owner); err != nil {
		t.Fatalf("owner Confirm() error = %v", err)
	}
	club, err := f.repository.GetBySlug(ctx, "smash-club")
	if err != nil {
		t.Fatal(err)
	}
	if club.ConfirmedAt == nil || !club.ConfirmedAt.Equal(now) || club.ConfirmedSource != ConfirmedByClub || club.NeedsConfirmation {
		t.Fatalf("confirmed club = %v %q needs %v, want %v by the club", club.ConfirmedAt, club.ConfirmedSource, club.NeedsConfirmation, now)
	}

	got := map[string]bool{}
	for _, slug := range []string{"stale-club", "recent-club"} {
		club, err := f.repository.GetBySlug(ctx, slug)
		if err != nil {
			t.Fatal(err)
		}
		got["page:"+slug] = club.NeedsConfirmation
	}
	listed, err := f.repository.ListBySchool(ctx, "officer-university")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range listed {
		got["school:"+item.Slug] = item.NeedsConfirmation
	}
	directory, err := f.repository.List(ctx, ListParams{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range directory {
		got["directory:"+item.Slug] = item.NeedsConfirmation
	}
	want := map[string]bool{
		"page:stale-club": true, "page:recent-club": false,
		"school:smash-club": false, "school:stale-club": true, "school:recent-club": false,
		"directory:smash-club": false, "directory:stale-club": true, "directory:recent-club": false,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("needs confirmation = %v, want %v", got, want)
	}
}

func TestOwnersAreRemindedOncePerLapsedConfirmation(t *testing.T) {
	ctx := context.Background()
	f := newOfficerFixture(t)
	now := time.Date(2031, time.June, 1, 12, 0, 0, 0, time.UTC)
	f.repository.now = func() time.Time { return now }
	owner, coOwner, editor := f.user(t, "owner"), f.user(t, "co-owner"), f.user(t, "editor")
	lapsed := f.club(t, "lapsed-club", [2]string{owner, RoleOwner}, [2]string{coOwner, RoleOwner}, [2]string{editor, RoleEditor})
	current := f.club(t, "current-club", [2]string{owner, RoleOwner})
	unclaimed := f.club(t, "unclaimed-club")
	for clubID, age := range map[string]int{lapsed: 91, current: 89, unclaimed: 200} {
		if _, err := f.pool.Exec(ctx, `UPDATE clubs SET confirmed_at = $2, confirmed_source = 'club' WHERE id = $1::uuid`,
			clubID, now.AddDate(0, 0, -age)); err != nil {
			t.Fatal(err)
		}
	}
	reminders := func() []string {
		t.Helper()
		rows, err := f.pool.Query(ctx, `SELECT recipient || ' ' || (payload->>'club_slug') FROM email_outbox
			WHERE kind = 'club_confirmation_due' ORDER BY created_at, 1`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		sent := []string{}
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatal(err)
			}
			sent = append(sent, line)
		}
		return sent
	}
	queue := func() int {
		t.Helper()
		reminded, err := f.repository.QueueConfirmationReminders(ctx)
		if err != nil {
			t.Fatalf("QueueConfirmationReminders() error = %v", err)
		}
		return reminded
	}

	first, again := queue(), queue()
	afterFirstLapse := reminders()

	if err := f.repository.Confirm(ctx, "lapsed-club", editor); err != nil {
		t.Fatal(err)
	}
	stillCurrent := queue()
	now = now.AddDate(0, 0, 91)
	second := queue()

	got := []any{first, again, afterFirstLapse, stillCurrent, second, reminders()}
	want := []any{
		1, 0, []string{"co-owner@example.test lapsed-club", "owner@example.test lapsed-club"},
		0, 2,
		[]string{
			"co-owner@example.test lapsed-club", "owner@example.test lapsed-club",
			"co-owner@example.test lapsed-club", "owner@example.test current-club", "owner@example.test lapsed-club",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("reminders = %v, want %v", got, want)
	}
}
