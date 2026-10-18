package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

type organizerFixture struct {
	pool       *pgxpool.Pool
	repository *PostgresRepository
	schoolID   string
	gameID     string
}

func newOrganizerFixture(t *testing.T) organizerFixture {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "event_organizers")
	fixture := organizerFixture{pool: pool, repository: NewPostgresRepository(pool)}
	if err := pool.QueryRow(ctx, `INSERT INTO schools (name, slug) VALUES ('Host', 'host') RETURNING id::text`).Scan(&fixture.schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO games (name, slug) VALUES ('Chess', 'chess') RETURNING id::text`).Scan(&fixture.gameID); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	return fixture
}

func (f organizerFixture) user(t *testing.T, name string) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', $2, $3::uuid, NOW())
		RETURNING id::text`, Slugify(name)+"@example.test", name, f.schoolID).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", name, err)
	}
	return id
}

func (f organizerFixture) event(t *testing.T, creatorID, title, visibility string) Event {
	t.Helper()
	startsAt := time.Date(2030, time.March, 1, 19, 0, 0, 0, time.UTC)
	input := CreateInput{
		Title:         title,
		CreatorUserID: creatorID,
		HostSchoolID:  f.schoolID,
		GameIDs:       []string{f.gameID},
		Visibility:    visibility,
		Format:        FormatOnline,
		Audience:      AudienceOpen,
		EventType:     EventTypeGameNight,
		StartsAt:      startsAt,
		EndsAt:        startsAt.Add(time.Hour),
		Timezone:      "UTC",
	}
	params := CreateParams{CreateInput: input}
	if visibility == VisibilityPrivate {
		params.PrivatePassword = "a long enough password"
		params.PrivatePasswordHash = "hash"
	}
	event, err := f.repository.Create(context.Background(), params)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	return event
}

func (f organizerFixture) invite(t *testing.T, slug, creatorID, email, token string) (OrganizerInvite, error) {
	t.Helper()
	return f.repository.InviteOrganizer(context.Background(), OrganizerInviteParams{
		Slug:          slug,
		CreatorUserID: creatorID,
		Email:         email,
		RawToken:      token,
		TokenHash:     []byte("hash-" + token),
		ExpiresAt:     time.Now().Add(time.Hour),
	})
}

func TestOrganizerInviteAddsACoOrganizerWhoCanEditButNotCancel(t *testing.T) {
	ctx := context.Background()
	f := newOrganizerFixture(t)
	creatorID := f.user(t, "Creator")
	guestID := f.user(t, "Guest")
	otherID := f.user(t, "Other")
	event := f.event(t, creatorID, "Campus Chess Night", VisibilityPublic)

	if _, err := f.invite(t, event.Slug, guestID, "guest@example.test", "by-guest"); !errors.Is(err, ErrCreatorRequired) {
		t.Fatalf("InviteOrganizer() by a non-creator error = %v, want %v", err, ErrCreatorRequired)
	}
	if _, err := f.invite(t, event.Slug, creatorID, "guest@example.test", "first"); err != nil {
		t.Fatalf("InviteOrganizer() error = %v", err)
	}
	second, err := f.invite(t, event.Slug, creatorID, "guest@example.test", "second")
	if err != nil {
		t.Fatalf("InviteOrganizer() again error = %v", err)
	}
	listed, err := f.repository.ListOrganizerInvites(ctx, event.Slug, creatorID)
	if err != nil || !reflect.DeepEqual(listed, []OrganizerInvite{second}) {
		t.Fatalf("ListOrganizerInvites() = %+v, %v; want only the second invite %+v", listed, err, second)
	}

	var payloads []OrganizerInvitePayload
	rows, err := f.pool.Query(ctx, `SELECT payload FROM email_outbox WHERE kind = 'event_organizer_invite' AND recipient = 'guest@example.test' ORDER BY created_at, id`)
	if err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	for rows.Next() {
		var raw []byte
		var payload OrganizerInvitePayload
		if err := rows.Scan(&raw); err != nil || json.Unmarshal(raw, &payload) != nil {
			t.Fatalf("scan outbox payload: %v", err)
		}
		payloads = append(payloads, payload)
	}
	if want := []OrganizerInvitePayload{
		{Token: "first", EventTitle: "Campus Chess Night", InviterName: "Creator"},
		{Token: "second", EventTitle: "Campus Chess Night", InviterName: "Creator"},
	}; !reflect.DeepEqual(payloads, want) {
		t.Fatalf("invite emails = %+v, want %+v", payloads, want)
	}

	accept := func(token, userID string) (string, error) {
		return f.repository.AcceptOrganizerInvite(ctx, []byte("hash-"+token), userID)
	}
	if _, err := accept("first", guestID); !errors.Is(err, ErrOrganizerInviteNotFound) {
		t.Fatalf("accepting a replaced invite error = %v, want %v", err, ErrOrganizerInviteNotFound)
	}
	if _, err := accept("second", otherID); !errors.Is(err, ErrOrganizerInviteWrongEmail) {
		t.Fatalf("accepting as another account error = %v, want %v", err, ErrOrganizerInviteWrongEmail)
	}
	if slug, err := accept("second", guestID); err != nil || slug != event.Slug {
		t.Fatalf("AcceptOrganizerInvite() = %q, %v; want %q", slug, err, event.Slug)
	}
	if _, err := accept("second", guestID); !errors.Is(err, ErrOrganizerInviteNotFound) {
		t.Fatalf("accepting twice error = %v, want %v", err, ErrOrganizerInviteNotFound)
	}
	var creatorNotices []string
	noticeRows, err := f.pool.Query(ctx, `SELECT type || ':' || body FROM notifications WHERE user_id = $1::uuid`, creatorID)
	if err != nil {
		t.Fatalf("list creator notifications: %v", err)
	}
	for noticeRows.Next() {
		var notice string
		if err := noticeRows.Scan(&notice); err != nil {
			t.Fatalf("scan creator notification: %v", err)
		}
		creatorNotices = append(creatorNotices, notice)
	}
	if want := []string{"event.organizer_joined:Guest accepted your invitation and is now a co-organizer of Campus Chess Night."}; !reflect.DeepEqual(creatorNotices, want) {
		t.Fatalf("creator notifications = %v, want %v", creatorNotices, want)
	}

	updated, err := f.repository.Update(ctx, UpdateParams{UpdateInput: UpdateInput{
		Slug:         event.Slug,
		EditorUserID: guestID,
		Title:        "Campus Chess Night II",
		HostSchoolID: f.schoolID,
		GameIDs:      []string{f.gameID},
		Visibility:   VisibilityPublic,
		Format:       FormatOnline,
		Audience:     AudienceOpen,
		EventType:    EventTypeGameNight,
		StartsAt:     event.StartsAt,
		EndsAt:       event.EndsAt,
		Timezone:     "UTC",
	}})
	if err != nil || updated.Title != "Campus Chess Night II" {
		t.Fatalf("Update() by the co-organizer = %q, %v", updated.Title, err)
	}
	if err := f.repository.Delete(ctx, event.Slug, guestID); !errors.Is(err, ErrCreatorRequired) {
		t.Fatalf("Delete() by the co-organizer error = %v, want %v", err, ErrCreatorRequired)
	}
	if err := f.repository.RemoveOrganizer(ctx, event.Slug, guestID, creatorID); !errors.Is(err, ErrCreatorCannotLeave) {
		t.Fatalf("removing the creator error = %v, want %v", err, ErrCreatorCannotLeave)
	}
	if err := f.repository.TransferCreator(ctx, event.Slug, guestID, guestID); !errors.Is(err, ErrCreatorRequired) {
		t.Fatalf("TransferCreator() by the co-organizer error = %v, want %v", err, ErrCreatorRequired)
	}

	organizers := func() []string {
		t.Helper()
		got, err := f.repository.GetBySlug(ctx, event.Slug)
		if err != nil {
			t.Fatalf("GetBySlug() error = %v", err)
		}
		roles := make([]string, 0, len(got.Organizers))
		for _, organizer := range got.Organizers {
			roles = append(roles, organizer.Name+":"+organizer.Role)
		}
		return roles
	}
	if got, want := organizers(), []string{"Creator:creator", "Guest:organizer"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("organizers after accepting = %v, want %v", got, want)
	}

	if err := f.repository.TransferCreator(ctx, event.Slug, creatorID, guestID); err != nil {
		t.Fatalf("TransferCreator() error = %v", err)
	}
	if got, want := organizers(), []string{"Guest:creator", "Creator:organizer"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("organizers after the transfer = %v, want %v", got, want)
	}
	if err := f.repository.RemoveOrganizer(ctx, event.Slug, creatorID, creatorID); err != nil {
		t.Fatalf("the former creator stepping down error = %v", err)
	}
	if got, want := organizers(), []string{"Guest:creator"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("organizers after stepping down = %v, want %v", got, want)
	}
	if err := f.repository.Delete(ctx, event.Slug, guestID); err != nil {
		t.Fatalf("Delete() by the new creator error = %v", err)
	}
}

func TestOrganizerInvitesKeepAPrivateTitleOutOfTheEmailAndStopAtTheLimit(t *testing.T) {
	ctx := context.Background()
	f := newOrganizerFixture(t)
	creatorID := f.user(t, "Creator")
	event := f.event(t, creatorID, "Secret Scrim", VisibilityPrivate)

	invites := make([]OrganizerInvite, 0, MaximumOrganizers-1)
	for index := range MaximumOrganizers - 1 {
		invite, err := f.invite(t, event.Slug, creatorID, fmt.Sprintf("player%d@example.test", index), fmt.Sprint("token-", index))
		if err != nil {
			t.Fatalf("InviteOrganizer() %d error = %v", index, err)
		}
		invites = append(invites, invite)
	}
	if _, err := f.invite(t, event.Slug, creatorID, "one-more@example.test", "one-more"); !errors.Is(err, ErrOrganizerLimit) {
		t.Fatalf("InviteOrganizer() past the limit error = %v, want %v", err, ErrOrganizerLimit)
	}
	if err := f.repository.RevokeOrganizerInvite(ctx, event.Slug, creatorID, invites[0].ID); err != nil {
		t.Fatalf("RevokeOrganizerInvite() error = %v", err)
	}
	if err := f.repository.RevokeOrganizerInvite(ctx, event.Slug, creatorID, invites[0].ID); !errors.Is(err, ErrOrganizerInviteNotFound) {
		t.Fatalf("revoking twice error = %v, want %v", err, ErrOrganizerInviteNotFound)
	}
	if _, err := f.invite(t, event.Slug, creatorID, "one-more@example.test", "one-more"); err != nil {
		t.Fatalf("InviteOrganizer() after a revoke error = %v", err)
	}

	var titled int
	if err := f.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM email_outbox
		WHERE kind = 'event_organizer_invite' AND payload ? 'event_title'
	`).Scan(&titled); err != nil {
		t.Fatalf("count titled invites: %v", err)
	}
	if titled != 0 {
		t.Fatalf("%d private event invites carry the title, want 0", titled)
	}
}
