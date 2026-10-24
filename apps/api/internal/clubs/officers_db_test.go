package clubs

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/jackc/pgx/v5/pgxpool"
)

type officerFixture struct {
	pool       *pgxpool.Pool
	repository *PostgresRepository
	schoolID   string
}

func newOfficerFixture(t *testing.T) officerFixture {
	t.Helper()
	pool := dbtest.NewSchemaPool(t, "club_officers")
	if err := migrate.Run(context.Background(), pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	f := officerFixture{pool: pool, repository: NewPostgresRepository(pool)}
	f.schoolID = f.insert(t, `INSERT INTO schools (name, slug) VALUES ('Officer University', 'officer-university')`)
	return f
}

func (f officerFixture) insert(t *testing.T, query string, args ...any) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(context.Background(), query+" RETURNING id::text", args...).Scan(&id); err != nil {
		t.Fatalf("insert %q: %v", query, err)
	}
	return id
}

func (f officerFixture) user(t *testing.T, name string) string {
	t.Helper()
	return f.insert(t, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at, email_verified_at)
		VALUES ($1, 'hash', $2, $3::uuid, NOW(), NOW())
	`, name+"@example.test", name, f.schoolID)
}

// club creates a published club whose people hold the given roles, in order
// of joining.
func (f officerFixture) club(t *testing.T, slug string, roles ...[2]string) string {
	t.Helper()
	clubID := f.insert(t, `INSERT INTO clubs (school_id, name, slug, type) VALUES ($1::uuid, $2, $2, 'student_club')`, f.schoolID, slug)
	for index, role := range roles {
		if _, err := f.pool.Exec(context.Background(), `
			INSERT INTO club_members (club_id, user_id, role, created_at)
			VALUES ($1::uuid, $2::uuid, $3, NOW() + make_interval(secs => $4))
		`, clubID, role[0], role[1], index); err != nil {
			t.Fatalf("insert club member: %v", err)
		}
	}
	return clubID
}

// roles reads the club's people as user ID to role.
func (f officerFixture) roles(t *testing.T, clubID string) map[string]string {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT user_id::text, role FROM club_members WHERE club_id = $1::uuid`, clubID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	roles := map[string]string{}
	for rows.Next() {
		var userID, role string
		if err := rows.Scan(&userID, &role); err != nil {
			t.Fatal(err)
		}
		roles[userID] = role
	}
	return roles
}

func (f officerFixture) auditActions(t *testing.T, clubID string) []string {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT action FROM audit_logs WHERE entity_type = 'club' AND entity_id = $1::uuid ORDER BY created_at, id`, clubID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	actions := []string{}
	for rows.Next() {
		var action string
		if err := rows.Scan(&action); err != nil {
			t.Fatal(err)
		}
		actions = append(actions, action)
	}
	return actions
}

var renamed = ProfileEdit{Name: "Renamed Club", Type: TypeStudentClub, Summary: "We play weekly.", HowToJoin: "Come to a meeting."}

func TestAnEditorOfOneClubCannotEditAnother(t *testing.T) {
	f := newOfficerFixture(t)
	ctx := context.Background()
	owner, editor, other := f.user(t, "owner"), f.user(t, "editor"), f.user(t, "other")
	smashID := f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{editor, RoleEditor})
	f.club(t, "chess-club", [2]string{other, RoleOwner})

	if err := f.repository.EditProfile(ctx, "smash-club", editor, renamed); err != nil {
		t.Fatalf("EditProfile(own club) error = %v", err)
	}
	if err := f.repository.EditProfile(ctx, "chess-club", editor, renamed); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("EditProfile(another club) error = %v, want ErrNotClubOfficer", err)
	}
	if err := f.repository.EditLinks(ctx, "chess-club", editor, []Link{{Type: LinkWebsite, Label: "Site", URL: "https://chess.example.test"}}); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("EditLinks(another club) error = %v, want ErrNotClubOfficer", err)
	}
	chess, err := f.repository.GetBySlug(ctx, "chess-club")
	if err != nil || chess.Name != "chess-club" || len(chess.Links) != 0 {
		t.Fatalf("chess club = %+v, %v; want it unchanged", chess, err)
	}
	smash, err := f.repository.GetBySlug(ctx, "smash-club")
	if err != nil || smash.Name != renamed.Name || smash.Summary != renamed.Summary || smash.HowToJoin != renamed.HowToJoin {
		t.Fatalf("smash club = %+v, %v; want the edit", smash, err)
	}
	var edited string
	if err := f.pool.QueryRow(ctx, `SELECT metadata->>'edited_fields' FROM audit_logs WHERE entity_id = $1::uuid AND actor_user_id = $2::uuid`, smashID, editor).Scan(&edited); err != nil || edited != `["how_to_join", "name", "summary"]` {
		t.Fatalf("audit edited fields = %q, %v", edited, err)
	}
}

func TestAnInvitedEditorCanEditTheProfile(t *testing.T) {
	f := newOfficerFixture(t)
	ctx := context.Background()
	owner, editor, invitee, stranger := f.user(t, "owner"), f.user(t, "editor"), f.user(t, "invitee"), f.user(t, "stranger")
	clubID := f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{editor, RoleEditor})
	token, tokenHash, err := auth.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	invite := EditorInviteParams{Slug: "smash-club", OwnerUserID: owner, Email: "invitee@example.test", RawToken: token, TokenHash: tokenHash, ExpiresAt: time.Now().Add(time.Hour)}

	editorInvite := invite
	editorInvite.OwnerUserID = editor
	if _, err := f.repository.InviteEditor(ctx, editorInvite); !errors.Is(err, ErrNotClubOwner) {
		t.Fatalf("InviteEditor(by an editor) error = %v, want ErrNotClubOwner", err)
	}
	if _, err := f.repository.InviteEditor(ctx, invite); err != nil {
		t.Fatalf("InviteEditor() error = %v", err)
	}
	if err := f.repository.EditProfile(ctx, "smash-club", invitee, renamed); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("EditProfile(before accepting) error = %v, want ErrNotClubOfficer", err)
	}
	if _, err := f.repository.AcceptEditorInvite(ctx, auth.HashToken(token), stranger); !errors.Is(err, ErrEditorInviteWrongAccount) {
		t.Fatalf("AcceptEditorInvite(wrong account) error = %v", err)
	}
	slug, err := f.repository.AcceptEditorInvite(ctx, auth.HashToken(token), invitee)
	if err != nil || slug != "smash-club" {
		t.Fatalf("AcceptEditorInvite() = %q, %v", slug, err)
	}
	if _, err := f.repository.AcceptEditorInvite(ctx, auth.HashToken(token), invitee); !errors.Is(err, ErrEditorInviteNotFound) {
		t.Fatalf("AcceptEditorInvite(again) error = %v, want ErrEditorInviteNotFound", err)
	}
	if err := f.repository.EditProfile(ctx, "smash-club", invitee, renamed); err != nil {
		t.Fatalf("EditProfile(invited editor) error = %v", err)
	}
	if got, want := f.roles(t, clubID), map[string]string{owner: RoleOwner, editor: RoleEditor, invitee: RoleEditor}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roles = %v, want %v", got, want)
	}
	if got, want := f.auditActions(t, clubID), []string{ActionEditorInvited, ActionEditorAdded, ActionProfileEdited}; !reflect.DeepEqual(got, want) {
		t.Fatalf("audit = %v, want %v", got, want)
	}
	var queued int
	if err := f.pool.QueryRow(ctx, `SELECT COUNT(*) FROM email_outbox WHERE kind = 'club_editor_invite' AND recipient = 'invitee@example.test'`).Scan(&queued); err != nil || queued != 1 {
		t.Fatalf("editor invite emails = %d, %v; want 1", queued, err)
	}
}

func TestAnOwnershipTransferWaitsForTheRecipient(t *testing.T) {
	f := newOfficerFixture(t)
	ctx := context.Background()
	owner, editor, member := f.user(t, "owner"), f.user(t, "editor"), f.user(t, "member")
	clubID := f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{editor, RoleEditor}, [2]string{member, RoleMember})
	before := f.roles(t, clubID)

	if err := f.repository.OfferOwnership(ctx, "smash-club", editor, member); !errors.Is(err, ErrNotClubOwner) {
		t.Fatalf("OfferOwnership(by an editor) error = %v, want ErrNotClubOwner", err)
	}
	if err := f.repository.OfferOwnership(ctx, "smash-club", owner, member); err != nil {
		t.Fatalf("OfferOwnership() error = %v", err)
	}
	if got := f.roles(t, clubID); !reflect.DeepEqual(got, before) {
		t.Fatalf("roles after the offer = %v, want them unchanged %v", got, before)
	}
	if viewer, err := f.repository.Viewer(ctx, clubID, member); err != nil || viewer != (Viewer{Role: RoleMember, OwnershipOffered: true}) {
		t.Fatalf("Viewer(recipient) = %+v, %v", viewer, err)
	}
	if err := f.repository.AcceptOwnership(ctx, "smash-club", editor); !errors.Is(err, ErrOwnershipOfferNotFound) {
		t.Fatalf("AcceptOwnership(not the recipient) error = %v", err)
	}

	// The recipient declines, and nothing changes.
	if err := f.repository.CancelOwnershipOffer(ctx, "smash-club", member); err != nil {
		t.Fatalf("CancelOwnershipOffer(recipient) error = %v", err)
	}
	if err := f.repository.AcceptOwnership(ctx, "smash-club", member); !errors.Is(err, ErrOwnershipOfferNotFound) {
		t.Fatalf("AcceptOwnership(declined) error = %v", err)
	}
	if got := f.roles(t, clubID); !reflect.DeepEqual(got, before) {
		t.Fatalf("roles after declining = %v, want them unchanged", got)
	}

	// Offered again and accepted, the recipient owns the club and the former
	// owner edits it.
	if err := f.repository.OfferOwnership(ctx, "smash-club", owner, member); err != nil {
		t.Fatal(err)
	}
	if err := f.repository.AcceptOwnership(ctx, "smash-club", member); err != nil {
		t.Fatalf("AcceptOwnership() error = %v", err)
	}
	if got, want := f.roles(t, clubID), map[string]string{owner: RoleEditor, editor: RoleEditor, member: RoleOwner}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roles after accepting = %v, want %v", got, want)
	}
	if got, want := f.auditActions(t, clubID), []string{ActionOwnershipOffered, ActionOwnershipOfferCanceled, ActionOwnershipOffered, ActionOwnershipTransferred}; !reflect.DeepEqual(got, want) {
		t.Fatalf("audit = %v, want %v", got, want)
	}
}

func TestTheLastOwnerCannotLeaveOrBeRemoved(t *testing.T) {
	f := newOfficerFixture(t)
	ctx := context.Background()
	owner, editor := f.user(t, "owner"), f.user(t, "editor")
	clubID := f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{editor, RoleEditor})

	if err := f.repository.Leave(ctx, "smash-club", owner); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("Leave(last owner) error = %v, want ErrLastOwner", err)
	}
	if err := f.repository.RemoveMember(ctx, "smash-club", editor, owner); !errors.Is(err, ErrOwnerCannotBeRemoved) {
		t.Fatalf("RemoveMember(owner) error = %v, want ErrOwnerCannotBeRemoved", err)
	}
	if err := f.repository.Leave(ctx, "smash-club", editor); err != nil {
		t.Fatalf("Leave(editor) error = %v", err)
	}
	if got, want := f.roles(t, clubID), map[string]string{owner: RoleOwner}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roles = %v, want %v", got, want)
	}
}

func TestARemovedMemberLosesAccessAndTheClubStays(t *testing.T) {
	f := newOfficerFixture(t)
	ctx := context.Background()
	owner, editor, other, member := f.user(t, "owner"), f.user(t, "editor"), f.user(t, "other"), f.user(t, "member")
	clubID := f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{editor, RoleEditor}, [2]string{other, RoleEditor}, [2]string{member, RoleMember})
	if err := f.repository.EditProfile(ctx, "smash-club", editor, renamed); err != nil {
		t.Fatal(err)
	}
	if err := f.repository.EditLinks(ctx, "smash-club", editor, []Link{{Type: LinkDiscord, Label: "Discord", URL: "https://discord.example.test/smash"}}); err != nil {
		t.Fatal(err)
	}
	published, err := f.repository.GetBySlug(ctx, "smash-club")
	if err != nil {
		t.Fatal(err)
	}

	// An editor removes a member but not another editor; an owner removes an
	// editor.
	if err := f.repository.RemoveMember(ctx, "smash-club", editor, other); !errors.Is(err, ErrNotClubOwner) {
		t.Fatalf("RemoveMember(editor removes editor) error = %v, want ErrNotClubOwner", err)
	}
	if err := f.repository.RemoveMember(ctx, "smash-club", editor, member); err != nil {
		t.Fatalf("RemoveMember(editor removes member) error = %v", err)
	}
	if err := f.repository.RemoveMember(ctx, "smash-club", owner, editor); err != nil {
		t.Fatalf("RemoveMember(owner removes editor) error = %v", err)
	}

	if err := f.repository.EditProfile(ctx, "smash-club", editor, ProfileEdit{Name: "Taken Over", Type: TypeStudentClub}); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("EditProfile(removed editor) error = %v, want ErrNotClubOfficer", err)
	}
	if _, err := f.repository.Manage(ctx, "smash-club", editor); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("Manage(removed editor) error = %v, want ErrNotClubOfficer", err)
	}
	// Only the count of people changes.
	published.MemberCount -= 2
	after, err := f.repository.GetBySlug(ctx, "smash-club")
	if err != nil || !reflect.DeepEqual(after, published) {
		t.Fatalf("club after removals = %+v, %v; want it unchanged %+v", after, err, published)
	}
	if got, want := f.roles(t, clubID), map[string]string{owner: RoleOwner, other: RoleEditor}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roles = %v, want %v", got, want)
	}
	if got, want := f.auditActions(t, clubID), []string{ActionProfileEdited, ActionLinksEdited, ActionMemberRemoved, ActionMemberRemoved}; !reflect.DeepEqual(got, want) {
		t.Fatalf("audit = %v, want %v", got, want)
	}
}

func TestAVerifiedUserJoinsLeavesAndAfterRemovalJoinsAgain(t *testing.T) {
	f := newOfficerFixture(t)
	ctx := context.Background()
	owner, editor, student, outsider := f.user(t, "owner"), f.user(t, "editor"), f.user(t, "student"), f.user(t, "outsider")
	unverified := f.insert(t, `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ('unverified@example.test', 'hash', 'Unverified', $1::uuid, NOW())
	`, f.schoolID)
	clubID := f.club(t, "smash-club", [2]string{owner, RoleOwner}, [2]string{editor, RoleEditor})

	if err := f.repository.Join(ctx, "smash-club", unverified); !errors.Is(err, ErrEmailUnverified) {
		t.Fatalf("Join(unverified) error = %v, want ErrEmailUnverified", err)
	}
	if err := f.repository.Join(ctx, "smash-club", student); err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	// Joining again changes nothing, and an officer who joins keeps their role.
	if err := f.repository.Join(ctx, "smash-club", student); err != nil {
		t.Fatalf("Join(again) error = %v", err)
	}
	if err := f.repository.Join(ctx, "smash-club", editor); err != nil {
		t.Fatalf("Join(editor) error = %v", err)
	}
	if got, want := f.roles(t, clubID), map[string]string{owner: RoleOwner, editor: RoleEditor, student: RoleMember}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roles after joining = %v, want %v", got, want)
	}
	club, err := f.repository.GetBySlug(ctx, "smash-club")
	if err != nil || club.MemberCount != 3 {
		t.Fatalf("member count = %d, %v; want 3", club.MemberCount, err)
	}

	if err := f.repository.Leave(ctx, "smash-club", student); err != nil {
		t.Fatalf("Leave() error = %v", err)
	}
	if err := f.repository.Join(ctx, "smash-club", student); err != nil {
		t.Fatal(err)
	}
	// Someone outside the club removes no one; an editor removes the member,
	// who may join again.
	if err := f.repository.RemoveMember(ctx, "smash-club", outsider, student); !errors.Is(err, ErrNotClubOfficer) {
		t.Fatalf("RemoveMember(outsider) error = %v, want ErrNotClubOfficer", err)
	}
	if err := f.repository.RemoveMember(ctx, "smash-club", editor, student); err != nil {
		t.Fatalf("RemoveMember(editor) error = %v", err)
	}
	if got := f.roles(t, clubID)[student]; got != "" {
		t.Fatalf("removed member's role = %q, want none", got)
	}
	if err := f.repository.Join(ctx, "smash-club", student); err != nil {
		t.Fatalf("Join(after removal) error = %v", err)
	}
	if got := f.roles(t, clubID)[student]; got != RoleMember {
		t.Fatalf("role after joining again = %q, want member", got)
	}
}

func TestListForUserPutsOfficerClubsFirst(t *testing.T) {
	ctx := context.Background()
	f := newOfficerFixture(t)
	person := f.user(t, "person")
	alphaID := f.club(t, "alpha-club", [2]string{person, RoleMember})
	zuluID := f.club(t, "zulu-club", [2]string{person, RoleEditor})
	f.club(t, "other-club")
	hiddenID := f.club(t, "hidden-club", [2]string{person, RoleOwner})
	if _, err := f.pool.Exec(ctx, `UPDATE clubs SET status = 'hidden' WHERE id = $1::uuid`, hiddenID); err != nil {
		t.Fatal(err)
	}

	got, err := f.repository.ListForUser(ctx, person)
	if err != nil {
		t.Fatalf("ListForUser() error = %v", err)
	}
	school := SchoolSummary{ID: f.schoolID, Name: "Officer University", Slug: "officer-university"}
	want := []UserClub{
		{ID: zuluID, Name: "zulu-club", Slug: "zulu-club", School: school, ViewerRole: RoleEditor},
		{ID: alphaID, Name: "alpha-club", Slug: "alpha-club", School: school, ViewerRole: RoleMember},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ListForUser() = %+v, want %+v", got, want)
	}
}
