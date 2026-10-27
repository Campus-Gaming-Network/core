package events

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
)

func TestEventActivityLogRecordsChangesAndFiltersThemByViewer(t *testing.T) {
	ctx := context.Background()
	f := newOrganizerFixture(t)
	creator, coOrganizer, clubEditor, outsider, helper := f.user(t, "Creator"), f.user(t, "Co Organizer"),
		f.user(t, "Club Editor"), f.user(t, "Outsider"), f.user(t, "Helper")
	var clubID, otherGameID string
	if err := f.pool.QueryRow(ctx, `INSERT INTO clubs (school_id, name, slug, type) VALUES ($1::uuid, 'Chess Club', 'chess-club', 'student_club')
		RETURNING id::text`, f.schoolID).Scan(&clubID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO club_members (club_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner'), ($1::uuid, $3::uuid, 'editor')`,
		clubID, creator, clubEditor); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `INSERT INTO games (name, slug) VALUES ('Go', 'go') RETURNING id::text`).Scan(&otherGameID); err != nil {
		t.Fatal(err)
	}

	startsAt := time.Date(2030, time.March, 1, 19, 0, 0, 0, time.UTC)
	created, err := f.repository.Create(ctx, CreateParams{CreateInput: CreateInput{
		Title: "Chess Night", Description: "Secret strategy notes", CreatorUserID: creator, HostSchoolID: f.schoolID,
		HostClubID: clubID, GameIDs: []string{f.gameID}, Visibility: VisibilityPublic, Format: FormatOnline,
		Audience: AudienceOpen, EventType: EventTypeGameNight, StartsAt: startsAt, EndsAt: startsAt.Add(time.Hour),
		Timezone: "UTC", OnlineURL: "https://meet.example.test/old-room",
	}})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	slug := created.Slug
	join := func(userID, email, token string) {
		t.Helper()
		if _, err := f.invite(t, slug, coOrganizerCreator(t, f, slug), email, token); err != nil {
			t.Fatalf("invite %s: %v", email, err)
		}
		if _, err := f.repository.AcceptOrganizerInvite(ctx, []byte("hash-"+token), userID); err != nil {
			t.Fatalf("accept %s: %v", email, err)
		}
	}
	join(coOrganizer, "co-organizer@example.test", "co-token")

	update := func(editorID string, change func(*UpdateInput)) {
		t.Helper()
		input := UpdateInput{
			Slug: slug, EditorUserID: editorID, Title: "Chess Night", Description: "Secret strategy notes",
			HostSchoolID: f.schoolID, HostClubID: clubID, GameIDs: []string{f.gameID}, Visibility: VisibilityPublic,
			Format: FormatOnline, Audience: AudienceOpen, EventType: EventTypeGameNight, StartsAt: startsAt,
			EndsAt: startsAt.Add(time.Hour), Timezone: "UTC", OnlineURL: "https://meet.example.test/old-room",
		}
		change(&input)
		if _, err := f.repository.Update(ctx, UpdateParams{UpdateInput: input}); err != nil {
			t.Fatalf("Update() error = %v", err)
		}
	}
	capacity := 20
	update(creator, func(in *UpdateInput) {
		in.Title = "Chess Night Finals"
		in.Description = "Newer secret notes"
		in.OnlineURL = "https://meet.example.test/new-room"
		in.GameIDs = []string{f.gameID, otherGameID}
		in.Capacity = &capacity
	})
	update(creator, func(in *UpdateInput) {
		in.Title, in.Description, in.OnlineURL = "Chess Night Finals", "Newer secret notes", "https://meet.example.test/new-room"
		in.GameIDs, in.Capacity = []string{f.gameID, otherGameID}, &capacity
	})
	update(coOrganizer, func(in *UpdateInput) {
		in.Title, in.Description, in.OnlineURL = "Chess Night Finals", "Newer secret notes", "https://meet.example.test/new-room"
		in.GameIDs, in.Capacity = []string{f.gameID, otherGameID}, &capacity
		in.Audience = AudienceCampus
	})

	// Before anyone leaves, the creator, a co-organizer, and the club's
	// editor see every entry and who made it; anyone else sees only the
	// public part of the first edit.
	views := map[string]string{}
	for name, userID := range map[string]string{"creator": creator, "co-organizer": coOrganizer, "club editor": clubEditor, "outsider": outsider, "visitor": ""} {
		editor := false
		if userID != "" {
			access, err := f.repository.Access(ctx, slug, userID)
			if err != nil {
				t.Fatal(err)
			}
			editor = access.Edit
		}
		page, err := f.repository.Activity(ctx, created.ID, editor, nil, 50)
		if err != nil {
			t.Fatalf("Activity(%s) error = %v", name, err)
		}
		views[name] = entriesJSON(t, page.Entries)
	}
	editorView := `[
		{"action":"event.updated","visibility":"editors","changes":[{"field":"audience","before":"open","after":"campus"}],
		 "actor":{"name":"Co Organizer"}},
		{"action":"event.updated","visibility":"public","changes":[
			{"field":"title","before":"Chess Night","after":"Chess Night Finals"},
			{"field":"online_url"},
			{"field":"description"},
			{"field":"games","before":[],"after":[{"name":"Go","slug":"go"}]},
			{"field":"capacity","before":null,"after":20}],
		 "actor":{"name":"Creator"}},
		{"action":"event.organizer_joined","visibility":"editors","changes":[],"actor":{"name":"Co Organizer"}},
		{"action":"event.created","visibility":"editors","changes":[],"actor":{"name":"Creator"}}]`
	publicView := `[
		{"action":"event.updated","visibility":"public","changes":[
			{"field":"title","before":"Chess Night","after":"Chess Night Finals"},
			{"field":"online_url"}]}]`
	want := map[string]string{
		"creator": normalized(t, editorView), "co-organizer": normalized(t, editorView), "club editor": normalized(t, editorView),
		"outsider": normalized(t, publicView), "visitor": normalized(t, publicView),
	}
	if !reflect.DeepEqual(views, want) {
		t.Fatalf("views = %v\nwant %v", views, want)
	}

	// The creator hands over the event and is then removed; a helper joins
	// and steps down; the club's editor cancels.
	if err := f.repository.TransferCreator(ctx, slug, creator, coOrganizer); err != nil {
		t.Fatal(err)
	}
	if err := f.repository.RemoveOrganizer(ctx, slug, coOrganizer, creator); err != nil {
		t.Fatal(err)
	}
	join(helper, "helper@example.test", "helper-token")
	if err := f.repository.RemoveOrganizer(ctx, slug, helper, helper); err != nil {
		t.Fatal(err)
	}
	if err := f.repository.Delete(ctx, slug, clubEditor); err != nil {
		t.Fatalf("Delete(club editor) error = %v", err)
	}

	var actions []string
	var after *pagecursor.Cursor
	for {
		page, err := f.repository.Activity(ctx, created.ID, true, after, 2)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range page.Entries {
			actions = append(actions, entry.Action)
		}
		if page.NextCursor == "" {
			break
		}
		cursor, err := pagecursor.Decode(page.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		after = &cursor
	}
	wantActions := []string{
		ActionCancelled, ActionOrganizerLeft, ActionOrganizerJoined, ActionOrganizerRemoved, ActionCreatorTransferred,
		ActionUpdated, ActionUpdated, ActionOrganizerJoined, ActionCreated,
	}
	if !reflect.DeepEqual(actions, wantActions) {
		t.Fatalf("actions = %v, want %v", actions, wantActions)
	}
	visitor, err := f.repository.Activity(ctx, created.ID, false, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{visitor.Entries[0].Action, visitor.Entries[1].Action}; len(visitor.Entries) != 2 ||
		!reflect.DeepEqual(got, []string{ActionCancelled, ActionUpdated}) {
		t.Fatalf("visitor after cancel = %s, want the cancellation and the public edit", entriesJSON(t, visitor.Entries))
	}

	// A day after the cancellation the page, and with it the log, is gone.
	f.repository.now = func() time.Time { return time.Now().Add(CancelledEventVisibility + time.Hour) }
	if _, err := f.repository.GetPageBySlug(ctx, slug); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetPageBySlug() a day after cancelling error = %v, want no rows", err)
	}
}

func TestEventActivityNeverRecordsSecrets(t *testing.T) {
	ctx := context.Background()
	f := newOrganizerFixture(t)
	creator := f.user(t, "Creator")
	event := f.event(t, creator, "Private Night", VisibilityPrivate)
	input := UpdateInput{
		Slug: event.Slug, EditorUserID: creator, Title: "Private Night", Description: "description-secret",
		HostSchoolID: f.schoolID, GameIDs: []string{f.gameID}, Visibility: VisibilityPrivate, Format: FormatOnline,
		Audience: AudienceOpen, EventType: EventTypeGameNight, StartsAt: event.StartsAt, EndsAt: event.EndsAt,
		Timezone: "UTC", OnlineURL: "https://online-secret.example.test", Cost: CostPaid,
		PaymentNote: "payment-note-secret", PaymentURL: "https://payment-secret.example.test",
	}
	if _, err := f.repository.Update(ctx, UpdateParams{UpdateInput: input, PrivatePasswordHash: "password-hash-secret"}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	var recorded, edited string
	if err := f.pool.QueryRow(ctx, `
		SELECT string_agg(before_json::text || after_json::text || metadata::text, ' '),
		       (SELECT metadata::text FROM audit_logs WHERE entity_id = $1::uuid AND action = $2)
		FROM audit_logs WHERE entity_id = $1::uuid
	`, event.ID, ActionUpdated).Scan(&recorded, &edited); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"description-secret", "online-secret", "payment-note-secret", "payment-secret", "password-hash-secret", `"hash"`} {
		if strings.Contains(recorded, secret) {
			t.Errorf("activity log contains %q: %s", secret, recorded)
		}
	}
	for _, field := range []string{"description", "online_url", "payment_note", "payment_url", "private_password"} {
		if !strings.Contains(edited, `"`+field+`"`) {
			t.Errorf("edit entry %s does not list %s as changed", edited, field)
		}
	}
}

func coOrganizerCreator(t *testing.T, f organizerFixture, slug string) string {
	t.Helper()
	var creatorID string
	if err := f.pool.QueryRow(context.Background(), `SELECT creator_user_id::text FROM events WHERE slug = $1`, slug).Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	return creatorID
}

// entriesJSON encodes entries without their IDs, times, and actor public IDs,
// which vary per run.
func entriesJSON(t *testing.T, entries []ActivityEntry) string {
	t.Helper()
	encoded, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	var decoded []map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, entry := range decoded {
		delete(entry, "id")
		delete(entry, "occurred_at")
		if actor, ok := entry["actor"].(map[string]any); ok {
			delete(actor, "public_id")
		}
	}
	return normalized(t, decoded)
}

func normalized(t *testing.T, value any) string {
	t.Helper()
	if text, ok := value.(string); ok {
		var decoded any
		if err := json.Unmarshal([]byte(text), &decoded); err != nil {
			t.Fatal(err)
		}
		value = decoded
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
