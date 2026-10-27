package events

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryHostClub(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	insert := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, query+" RETURNING id::text", args...).Scan(&id); err != nil {
			t.Fatalf("insert %q: %v", query, err)
		}
		return id
	}
	schoolID := insert(`INSERT INTO schools (name, slug) VALUES ('Club Host School', 'club-host-school')`)
	otherSchoolID := insert(`INSERT INTO schools (name, slug) VALUES ('Other School', 'other-school')`)
	user := func(name string) string {
		t.Helper()
		return insert(`INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1, 'hash', $2, $3::uuid, NOW())`, name+"@example.test", name, schoolID)
	}
	club := func(slug, school string, members map[string]string) string {
		t.Helper()
		clubID := insert(`INSERT INTO clubs (school_id, name, slug, type) VALUES ($1::uuid, $2, $2, 'student_club')`, school, slug)
		for userID, role := range members {
			if _, err := pool.Exec(ctx, `INSERT INTO club_members (club_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
				clubID, userID, role); err != nil {
				t.Fatalf("insert club member: %v", err)
			}
		}
		return clubID
	}
	editor, secondEditor, member, otherOfficer, coOrganizer := user("editor"), user("second-editor"), user("member"), user("other-officer"), user("co-organizer")
	smashID := club("smash-club", schoolID, map[string]string{editor: "editor", secondEditor: "owner", member: "member"})
	club("chess-club", schoolID, map[string]string{otherOfficer: "owner"})
	awayID := club("away-club", otherSchoolID, map[string]string{editor: "owner"})

	repository := NewPostgresRepository(pool)
	repository.now = func() time.Time { return time.Date(2031, time.May, 1, 12, 0, 0, 0, time.UTC) }
	startsAt := time.Date(2031, time.June, 1, 19, 0, 0, 0, time.UTC)
	input := func(title, creatorID, clubID, school string) CreateInput {
		return CreateInput{
			Title: title, CreatorUserID: creatorID, HostSchoolID: school, HostClubID: clubID,
			Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceMembers,
			EventType: EventTypeGameNight, StartsAt: startsAt, EndsAt: startsAt.Add(time.Hour), Timezone: "UTC",
		}
	}

	event, err := repository.Create(ctx, CreateParams{CreateInput: input("Smash Night", editor, smashID, schoolID)})
	if err != nil {
		t.Fatalf("Create(editor) error = %v", err)
	}
	wantSmash := &ClubSummary{ID: smashID, Name: "smash-club", Slug: "smash-club"}
	if !reflect.DeepEqual(event.HostClub, wantSmash) {
		t.Fatalf("host club = %+v, want %+v", event.HostClub, wantSmash)
	}

	rejected := map[string]error{}
	for name, attempt := range map[string]CreateInput{
		"member":         input("Member Night", member, smashID, schoolID),
		"other officer":  input("Chess Night", otherOfficer, smashID, schoolID),
		"other school":   input("Away Night", editor, awayID, schoolID),
		"unknown club":   input("Ghost Night", editor, "00000000-0000-4000-8000-000000000000", schoolID),
		"team and club":  func() CreateInput { in := input("Both", editor, smashID, schoolID); in.HostTeamID = smashID; return in }(),
		"another school": input("Wrong School", editor, smashID, otherSchoolID),
	} {
		_, err := repository.Create(ctx, CreateParams{CreateInput: attempt})
		rejected[name] = err
	}
	for name, want := range map[string]error{
		"member": ErrHostClubNotAllowed, "other officer": ErrHostClubNotAllowed, "other school": ErrHostClubSchool,
		"unknown club": ErrHostClubNotAllowed, "another school": ErrHostClubSchool,
	} {
		if !errors.Is(rejected[name], want) {
			t.Errorf("Create(%s) error = %v, want %v", name, rejected[name], want)
		}
	}
	if rejected["team and club"] == nil {
		t.Error("Create(team and club) succeeded, want a validation error")
	}

	update := func(editorID, title string) error {
		_, err := repository.Update(ctx, UpdateParams{UpdateInput: UpdateInput{
			Slug: event.Slug, EditorUserID: editorID, Title: title, HostSchoolID: schoolID, HostClubID: smashID,
			Visibility: VisibilityPublic, Format: FormatOnline, Audience: AudienceMembers, EventType: EventTypeGameNight,
			StartsAt: event.StartsAt, EndsAt: event.EndsAt, Timezone: event.Timezone,
		}})
		return err
	}
	access := func(userID string) Access {
		t.Helper()
		got, err := repository.Access(ctx, event.Slug, userID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if err := update(secondEditor, "Smash Night Renamed"); err != nil {
		t.Fatalf("Update(second editor) error = %v", err)
	}
	for _, outsider := range []string{member, otherOfficer} {
		if err := update(outsider, "Taken Over"); !errors.Is(err, ErrOrganizerRequired) {
			t.Fatalf("Update(%s) error = %v, want ErrOrganizerRequired", outsider, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO event_organizers (event_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'organizer')
	`, event.ID, coOrganizer); err != nil {
		t.Fatal(err)
	}
	gotAccess := map[string]Access{
		"creator": access(editor), "second editor": access(secondEditor), "member": access(member),
		"other officer": access(otherOfficer), "co-organizer": access(coOrganizer),
	}
	wantAccess := map[string]Access{
		"creator": {Edit: true, Cancel: true}, "second editor": {Edit: true, Cancel: true}, "member": {},
		"other officer": {}, "co-organizer": {Edit: true},
	}
	if !reflect.DeepEqual(gotAccess, wantAccess) {
		t.Fatalf("access = %v, want %v", gotAccess, wantAccess)
	}

	// Leaving the club ends the second editor's access, but the creator keeps
	// theirs as an organizer.
	if _, err := pool.Exec(ctx, `DELETE FROM club_members WHERE club_id = $1::uuid AND user_id IN ($2::uuid, $3::uuid)`,
		smashID, secondEditor, editor); err != nil {
		t.Fatal(err)
	}
	if got, want := []Access{access(secondEditor), access(editor)}, []Access{{}, {Edit: true, Cancel: true}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("access after leaving = %v, want %v", got, want)
	}
	if err := update(secondEditor, "After Leaving"); !errors.Is(err, ErrOrganizerRequired) {
		t.Fatalf("Update(former editor) error = %v, want ErrOrganizerRequired", err)
	}

	listed, err := repository.ListPublic(ctx, ListParams{ClubSlug: "smash-club"})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].Slug != event.Slug || !reflect.DeepEqual(listed[0].HostClub, wantSmash) {
		t.Fatalf("ListPublic(smash-club) = %+v, want only %s", listed, event.Slug)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO club_members (club_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'editor')`,
		smashID, otherOfficer); err != nil {
		t.Fatal(err)
	}
	if err := repository.Delete(ctx, event.Slug, member); !errors.Is(err, ErrCreatorRequired) {
		t.Fatalf("Delete(member) error = %v, want ErrCreatorRequired", err)
	}
	if err := repository.Delete(ctx, event.Slug, otherOfficer); err != nil {
		t.Fatalf("Delete(new editor) error = %v", err)
	}
}
