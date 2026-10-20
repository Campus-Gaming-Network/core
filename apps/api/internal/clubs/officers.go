package clubs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
	"github.com/jackc/pgx/v5"
)

// Club roles. A club with an owner is claimed.
const (
	RoleOwner  = "owner"
	RoleEditor = "editor"
	RoleMember = "member"
)

// MaximumEditorInvites bounds a club's pending editor invites.
const MaximumEditorInvites = 10

// Actions a club's officers and members write to the club's audit history.
const (
	ActionProfileEdited          = "club.profile_edited"
	ActionLinksEdited            = "club.links_edited"
	ActionEditorInvited          = "club.editor_invited"
	ActionEditorInviteRevoked    = "club.editor_invite_revoked"
	ActionEditorAdded            = "club.editor_added"
	ActionMemberRemoved          = "club.member_removed"
	ActionMemberLeft             = "club.member_left"
	ActionOwnershipOffered       = "club.ownership_offered"
	ActionOwnershipOfferCanceled = "club.ownership_offer_cancelled"
	ActionOwnershipTransferred   = "club.ownership_transferred"
)

var (
	ErrNotClubOfficer           = apperror.New(apperror.KindAuthorization, "not_club_officer", "only the club's owners and editors can do this")
	ErrNotClubOwner             = apperror.New(apperror.KindAuthorization, "not_club_owner", "only the club's owners can do this")
	ErrClubMemberNotFound       = apperror.New(apperror.KindNotFound, "club_member_not_found", "that person is not in the club")
	ErrLastOwner                = apperror.New(apperror.KindConflict, "last_club_owner", "the last owner cannot leave; hand the club to another member first")
	ErrOwnerCannotBeRemoved     = apperror.New(apperror.KindConflict, "club_owner_cannot_be_removed", "an owner cannot be removed")
	ErrEditorInviteLimit        = apperror.New(apperror.KindConflict, "editor_invite_limit_reached", "the club has as many pending editor invites as it can")
	ErrEditorInviteNotFound     = apperror.New(apperror.KindNotFound, "editor_invite_not_found", "editor invite not found or no longer valid")
	ErrEditorInviteWrongAccount = apperror.New(apperror.KindAuthorization, "editor_invite_wrong_account", "the invite was sent to another email address")
	ErrOwnershipOfferNotFound   = apperror.New(apperror.KindNotFound, "ownership_offer_not_found", "there is no ownership offer to answer")
)

// Viewer is a signed-in person's place in a club, for the club page.
type Viewer struct {
	// Role is owner, editor, or member, and empty for someone not in the club.
	Role string `json:"role,omitempty"`
	// OwnershipOffered is true when an owner has offered the viewer the club.
	OwnershipOffered bool `json:"ownership_offered,omitempty"`
}

// Member is one person in a club as its officers see them.
type Member struct {
	UserID   string    `json:"user_id"`
	PublicID string    `json:"public_id"`
	Name     string    `json:"name"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

// EditorInvite is a pending editor invite as the club's owners see it.
type EditorInvite struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// OwnershipOffer is the club's pending offer of ownership to a member.
type OwnershipOffer struct {
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// Management is what the Manage club page shows an owner or editor. Invites
// are listed for owners only.
type Management struct {
	Club           Club            `json:"club"`
	Role           string          `json:"role"`
	Members        []Member        `json:"members"`
	Invites        []EditorInvite  `json:"invites"`
	OwnershipOffer *OwnershipOffer `json:"ownership_offer,omitempty"`
}

// ProfileEdit is the profile an officer edits. The slug, school, status, and
// confirmation stay with site admins.
type ProfileEdit struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Summary   string   `json:"summary"`
	HowToJoin string   `json:"how_to_join"`
	GameIDs   []string `json:"game_ids"`
}

// EditorInviteParams describes one invite. Only TokenHash is stored; the raw
// token goes to the invited address in the email.
type EditorInviteParams struct {
	Slug        string
	OwnerUserID string
	Email       string
	RawToken    string
	TokenHash   []byte
	ExpiresAt   time.Time
}

// EditorInvitePayload is what the invite email says.
type EditorInvitePayload struct {
	Token       string `json:"token"`
	ClubName    string `json:"club_name"`
	InviterName string `json:"inviter_name"`
}

// OwnershipOfferPayload is what the ownership offer email says.
type OwnershipOfferPayload struct {
	ClubName  string `json:"club_name"`
	ClubSlug  string `json:"club_slug"`
	OwnerName string `json:"owner_name"`
}

// clubRef is a locked, published club and the actor's role in it.
type clubRef struct {
	id, name, slug, role string
}

// lockClub locks the published club with slug and reads userID's role in it.
func lockClub(ctx context.Context, tx pgx.Tx, slug, userID string) (clubRef, error) {
	var ref clubRef
	err := tx.QueryRow(ctx, `
		SELECT c.id::text, c.name, c.slug,
		       COALESCE((SELECT m.role FROM club_members m WHERE m.club_id = c.id AND m.user_id = $2::uuid), '')
		FROM clubs c
		WHERE c.slug = $1 AND `+publishedClub+`
		FOR UPDATE OF c
	`, strings.TrimSpace(slug), userID).Scan(&ref.id, &ref.name, &ref.slug, &ref.role)
	if errors.Is(err, pgx.ErrNoRows) {
		return clubRef{}, ErrClubNotFound
	}
	if err != nil {
		return clubRef{}, fmt.Errorf("lock club: %w", err)
	}
	return ref, nil
}

func (ref clubRef) officer() bool { return ref.role == RoleOwner || ref.role == RoleEditor }

// officerChange runs one officer or member command on the published club with slug
// in a transaction, with the club locked and the actor's role read.
func (r *PostgresRepository) officerChange(ctx context.Context, slug, userID string, apply func(pgx.Tx, clubRef) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin club change: %w", err)
	}
	defer tx.Rollback(ctx)
	ref, err := lockClub(ctx, tx, slug, userID)
	if err != nil {
		return err
	}
	if err := apply(tx, ref); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// audit records a club change made by a person on the public site. States hold
// IDs and roles only, never names, email addresses, or text.
func audit(ctx context.Context, tx pgx.Tx, actorUserID, action, clubID string, before, after map[string]string, editedFields []string) error {
	type metadata struct {
		EditedFields []string `json:"edited_fields,omitempty"`
	}
	if before == nil {
		before = map[string]string{}
	}
	if after == nil {
		after = map[string]string{}
	}
	documents := make([][]byte, 0, 3)
	for _, value := range []any{before, after, metadata{EditedFields: editedFields}} {
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		documents = append(documents, encoded)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, metadata)
		VALUES ($1::uuid, $2, 'club', $3::uuid, $4::jsonb, $5::jsonb, $6::jsonb)
	`, actorUserID, action, clubID, documents[0], documents[1], documents[2]); err != nil {
		return fmt.Errorf("audit %s: %w", action, err)
	}
	return nil
}

func memberState(userID, role string) map[string]string {
	return map[string]string{"user_id": userID, "role": role}
}

// Join lists userID on the published club with slug as a member. Joining on
// CGN needs a verified email and grants nothing in the club itself. Someone
// already in the club keeps their role, and a removed member may join again.
func (r *PostgresRepository) Join(ctx context.Context, slug, userID string) error {
	if err := r.requireVerified(ctx, userID); err != nil {
		return err
	}
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		if ref.role != "" {
			return nil
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO club_members (club_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member')
			ON CONFLICT (club_id, user_id) DO NOTHING
		`, ref.id, userID); err != nil {
			return fmt.Errorf("join club: %w", err)
		}
		return nil
	})
}

// Viewer returns userID's role in the club with clubID, and whether an owner
// has offered them the club.
func (r *PostgresRepository) Viewer(ctx context.Context, clubID, userID string) (Viewer, error) {
	var viewer Viewer
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT role FROM club_members WHERE club_id = $1::uuid AND user_id = $2::uuid), ''),
		       EXISTS (SELECT 1 FROM club_ownership_offers WHERE club_id = $1::uuid AND to_user_id = $2::uuid)
	`, clubID, userID).Scan(&viewer.Role, &viewer.OwnershipOffered)
	if err != nil {
		return Viewer{}, fmt.Errorf("read club viewer: %w", err)
	}
	return viewer, nil
}

// Manage returns the club with its members, an owner's pending invites, and
// any ownership offer, to an owner or editor.
func (r *PostgresRepository) Manage(ctx context.Context, slug, userID string) (Management, error) {
	club, err := r.getByCurrentSlug(ctx, slug)
	if err != nil {
		return Management{}, err
	}
	viewer, err := r.Viewer(ctx, club.ID, userID)
	if err != nil {
		return Management{}, err
	}
	if viewer.Role != RoleOwner && viewer.Role != RoleEditor {
		return Management{}, ErrNotClubOfficer
	}
	management := Management{Club: club, Role: viewer.Role, Invites: []EditorInvite{}}
	rows, err := r.pool.Query(ctx, `
		SELECT m.user_id::text, u.public_id, u.name, m.role, m.created_at
		FROM club_members m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
		WHERE m.club_id = $1::uuid
		ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.created_at, m.user_id
	`, club.ID)
	if err != nil {
		return Management{}, fmt.Errorf("list club members: %w", err)
	}
	management.Members, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Member, error) {
		var member Member
		err := row.Scan(&member.UserID, &member.PublicID, &member.Name, &member.Role, &member.JoinedAt)
		return member, err
	})
	if err != nil {
		return Management{}, fmt.Errorf("scan club members: %w", err)
	}
	if viewer.Role == RoleOwner {
		rows, err := r.pool.Query(ctx, `
			SELECT id::text, email::text, expires_at, created_at
			FROM club_editor_invites
			WHERE club_id = $1::uuid AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
			ORDER BY created_at DESC, id
		`, club.ID)
		if err != nil {
			return Management{}, fmt.Errorf("list editor invites: %w", err)
		}
		management.Invites, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EditorInvite, error) {
			var invite EditorInvite
			err := row.Scan(&invite.ID, &invite.Email, &invite.ExpiresAt, &invite.CreatedAt)
			return invite, err
		})
		if err != nil {
			return Management{}, fmt.Errorf("scan editor invites: %w", err)
		}
	}
	var offer OwnershipOffer
	err = r.pool.QueryRow(ctx, `
		SELECT o.to_user_id::text, u.name, o.created_at
		FROM club_ownership_offers o JOIN users u ON u.id = o.to_user_id
		WHERE o.club_id = $1::uuid
	`, club.ID).Scan(&offer.UserID, &offer.Name, &offer.CreatedAt)
	if err == nil {
		management.OwnershipOffer = &offer
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Management{}, fmt.Errorf("read ownership offer: %w", err)
	}
	return management, nil
}

// EditProfile replaces the club's name, type, text, and games for an owner or
// editor.
func (r *PostgresRepository) EditProfile(ctx context.Context, slug, userID string, edit ProfileEdit) error {
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		if !ref.officer() {
			return ErrNotClubOfficer
		}
		fields := AdminFields{Name: edit.Name, Slug: ref.slug, Type: edit.Type, Summary: edit.Summary, HowToJoin: edit.HowToJoin, GameIDs: edit.GameIDs}
		if err := fields.Validate(); err != nil {
			return err
		}
		for field, value := range map[string]string{"name": fields.Name, "summary": fields.Summary, "how to join": fields.HowToJoin} {
			if err := safety.ValidateCleanText(field, value); err != nil {
				return err
			}
		}
		before, err := loadForUpdate(ctx, tx, ref.id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE clubs SET name = $2, type = $3, summary = $4, how_to_join = $5 WHERE id = $1::uuid
		`, ref.id, fields.Name, fields.Type, fields.Summary, fields.HowToJoin); err != nil {
			return adminmutation.Error(err)
		}
		if err := setGames(ctx, tx, ref.id, fields.GameIDs); err != nil {
			return err
		}
		after, err := loadForUpdate(ctx, tx, ref.id)
		if err != nil {
			return err
		}
		edited, err := adminmutation.EditedFields(before.form(), after.form())
		if err != nil {
			return err
		}
		return audit(ctx, tx, userID, ActionProfileEdited, ref.id, nil, nil, edited)
	})
}

// EditLinks replaces the club's links, in order, for an owner or editor.
func (r *PostgresRepository) EditLinks(ctx context.Context, slug, userID string, links []Link) error {
	for index := range links {
		links[index].Label = strings.TrimSpace(links[index].Label)
		links[index].URL = strings.TrimSpace(links[index].URL)
	}
	if err := validateLinks(links); err != nil {
		return err
	}
	for _, link := range links {
		if err := safety.ValidateCleanText("link label", link.Label); err != nil {
			return err
		}
	}
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		if !ref.officer() {
			return ErrNotClubOfficer
		}
		if _, err := tx.Exec(ctx, `DELETE FROM club_links WHERE club_id = $1::uuid`, ref.id); err != nil {
			return err
		}
		for position, link := range links {
			if _, err := tx.Exec(ctx, `
				INSERT INTO club_links (club_id, type, label, url, position) VALUES ($1::uuid, $2, $3, $4, $5)
			`, ref.id, link.Type, link.Label, link.URL, position); err != nil {
				return err
			}
		}
		if err := touch(ctx, tx, ref.id); err != nil {
			return err
		}
		return audit(ctx, tx, userID, ActionLinksEdited, ref.id, nil, nil, nil)
	})
}

// InviteEditor records an editor invite from an owner and queues its email.
// The answer is the same whether or not the address has an account. Inviting
// an address again replaces its pending invite.
func (r *PostgresRepository) InviteEditor(ctx context.Context, params EditorInviteParams) (EditorInvite, error) {
	var invite EditorInvite
	err := r.officerChange(ctx, params.Slug, params.OwnerUserID, func(tx pgx.Tx, ref clubRef) error {
		if ref.role != RoleOwner {
			return ErrNotClubOwner
		}
		if _, err := tx.Exec(ctx, `
			UPDATE club_editor_invites SET revoked_at = NOW()
			WHERE club_id = $1::uuid AND email = $2::citext AND accepted_at IS NULL AND revoked_at IS NULL
		`, ref.id, params.Email); err != nil {
			return fmt.Errorf("replace editor invite: %w", err)
		}
		var pending int
		var inviterName string
		if err := tx.QueryRow(ctx, `
			SELECT (SELECT COUNT(*) FROM club_editor_invites
			        WHERE club_id = $1::uuid AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()),
			       (SELECT name FROM users WHERE id = $2::uuid)
		`, ref.id, params.OwnerUserID).Scan(&pending, &inviterName); err != nil {
			return fmt.Errorf("count editor invites: %w", err)
		}
		if pending >= MaximumEditorInvites {
			return ErrEditorInviteLimit
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO club_editor_invites (club_id, invited_by_user_id, email, token_hash, expires_at)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5)
			RETURNING id::text, email::text, expires_at, created_at
		`, ref.id, params.OwnerUserID, params.Email, params.TokenHash, params.ExpiresAt).Scan(
			&invite.ID, &invite.Email, &invite.ExpiresAt, &invite.CreatedAt,
		); err != nil {
			return fmt.Errorf("insert editor invite: %w", err)
		}
		if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
			Kind:           emailoutbox.KindClubEditorInvite,
			Recipient:      params.Email,
			Payload:        EditorInvitePayload{Token: params.RawToken, ClubName: ref.name, InviterName: inviterName},
			IdempotencyKey: emailoutbox.TokenKey(emailoutbox.KindClubEditorInvite, params.TokenHash),
		}); err != nil {
			return fmt.Errorf("enqueue editor invite: %w", err)
		}
		return audit(ctx, tx, params.OwnerUserID, ActionEditorInvited, ref.id, nil, map[string]string{"invite_id": invite.ID}, nil)
	})
	return invite, err
}

// RevokeEditorInvite withdraws a pending editor invite, so its link stops
// working.
func (r *PostgresRepository) RevokeEditorInvite(ctx context.Context, slug, ownerUserID, inviteID string) error {
	return r.officerChange(ctx, slug, ownerUserID, func(tx pgx.Tx, ref clubRef) error {
		if ref.role != RoleOwner {
			return ErrNotClubOwner
		}
		tag, err := tx.Exec(ctx, `
			UPDATE club_editor_invites SET revoked_at = NOW()
			WHERE id = $1::uuid AND club_id = $2::uuid AND accepted_at IS NULL AND revoked_at IS NULL
		`, inviteID, ref.id)
		if err != nil {
			return fmt.Errorf("revoke editor invite: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrEditorInviteNotFound
		}
		return audit(ctx, tx, ownerUserID, ActionEditorInviteRevoked, ref.id, map[string]string{"invite_id": inviteID}, nil, nil)
	})
}

// AcceptEditorInvite makes userID an editor of the invite's club and returns
// the club's slug. The invite must be pending and unexpired, its club
// published, and its address the account's own; a wrong account leaves the
// invite usable by the right one. A member becomes an editor, and an owner
// or editor keeps their role.
func (r *PostgresRepository) AcceptEditorInvite(ctx context.Context, tokenHash []byte, userID string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin editor invite accept: %w", err)
	}
	defer tx.Rollback(ctx)
	var inviteID, clubID, slug string
	var emailMatches bool
	err = tx.QueryRow(ctx, `
		SELECT i.id::text, c.id::text, c.slug,
		       EXISTS (SELECT 1 FROM users u
		               WHERE u.id = $2::uuid AND u.email = i.email AND u.deleted_at IS NULL AND u.account_status = 'active')
		FROM club_editor_invites i
		JOIN clubs c ON c.id = i.club_id AND `+publishedClub+`
		WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
		FOR UPDATE OF i, c
	`, tokenHash, userID).Scan(&inviteID, &clubID, &slug, &emailMatches)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrEditorInviteNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find editor invite: %w", err)
	}
	if !emailMatches {
		return "", ErrEditorInviteWrongAccount
	}
	if _, err := tx.Exec(ctx, `
		UPDATE club_editor_invites SET accepted_at = NOW(), accepted_by_user_id = $2::uuid WHERE id = $1::uuid
	`, inviteID, userID); err != nil {
		return "", fmt.Errorf("accept editor invite: %w", err)
	}
	var before string
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE((SELECT role FROM club_members WHERE club_id = $1::uuid AND user_id = $2::uuid), '')
	`, clubID, userID).Scan(&before); err != nil {
		return "", fmt.Errorf("read club role: %w", err)
	}
	if before == "" || before == RoleMember {
		if _, err := tx.Exec(ctx, `
			INSERT INTO club_members (club_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'editor')
			ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'editor'
		`, clubID, userID); err != nil {
			return "", fmt.Errorf("add club editor: %w", err)
		}
		var previous map[string]string
		if before != "" {
			previous = memberState(userID, before)
		}
		if err := audit(ctx, tx, userID, ActionEditorAdded, clubID, previous, memberState(userID, RoleEditor), nil); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit editor invite accept: %w", err)
	}
	return slug, nil
}

// RemoveMember takes targetUserID out of the club. Owners remove editors and
// members; editors remove members. No one removes an owner, and a person
// leaves with Leave. The club and what it published stay as they are.
func (r *PostgresRepository) RemoveMember(ctx context.Context, slug, actorUserID, targetUserID string) error {
	return r.officerChange(ctx, slug, actorUserID, func(tx pgx.Tx, ref clubRef) error {
		if !ref.officer() {
			return ErrNotClubOfficer
		}
		role, err := memberRole(ctx, tx, ref.id, targetUserID)
		if err != nil {
			return err
		}
		switch {
		case targetUserID == actorUserID:
			return ErrClubMemberNotFound
		case role == RoleOwner:
			return ErrOwnerCannotBeRemoved
		case role == RoleEditor && ref.role != RoleOwner:
			return ErrNotClubOwner
		}
		if err := removeMember(ctx, tx, ref.id, targetUserID); err != nil {
			return err
		}
		return audit(ctx, tx, actorUserID, ActionMemberRemoved, ref.id, memberState(targetUserID, role), nil, nil)
	})
}

// Leave takes userID out of the club. The last owner cannot leave.
func (r *PostgresRepository) Leave(ctx context.Context, slug, userID string) error {
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		if ref.role == "" {
			return ErrClubMemberNotFound
		}
		if ref.role == RoleOwner {
			var otherOwners bool
			if err := tx.QueryRow(ctx, `
				SELECT EXISTS (SELECT 1 FROM club_members WHERE club_id = $1::uuid AND role = 'owner' AND user_id <> $2::uuid)
			`, ref.id, userID).Scan(&otherOwners); err != nil {
				return fmt.Errorf("count club owners: %w", err)
			}
			if !otherOwners {
				return ErrLastOwner
			}
		}
		if err := removeMember(ctx, tx, ref.id, userID); err != nil {
			return err
		}
		return audit(ctx, tx, userID, ActionMemberLeft, ref.id, memberState(userID, ref.role), nil, nil)
	})
}

func memberRole(ctx context.Context, tx pgx.Tx, clubID, userID string) (string, error) {
	var role string
	err := tx.QueryRow(ctx, `SELECT role FROM club_members WHERE club_id = $1::uuid AND user_id = $2::uuid`, clubID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrClubMemberNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read club role: %w", err)
	}
	return role, nil
}

// removeMember deletes the role and any ownership offer to or from the person.
func removeMember(ctx context.Context, tx pgx.Tx, clubID, userID string) error {
	if _, err := tx.Exec(ctx, `
		DELETE FROM club_ownership_offers WHERE club_id = $1::uuid AND (from_user_id = $2::uuid OR to_user_id = $2::uuid)
	`, clubID, userID); err != nil {
		return fmt.Errorf("drop ownership offer: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM club_members WHERE club_id = $1::uuid AND user_id = $2::uuid`, clubID, userID); err != nil {
		return fmt.Errorf("remove club member: %w", err)
	}
	return nil
}

// OfferOwnership offers the club to another of its editors or members, and
// emails them. It replaces any earlier offer. Nothing else changes until the
// recipient accepts.
func (r *PostgresRepository) OfferOwnership(ctx context.Context, slug, ownerUserID, recipientUserID string) error {
	return r.officerChange(ctx, slug, ownerUserID, func(tx pgx.Tx, ref clubRef) error {
		if ref.role != RoleOwner {
			return ErrNotClubOwner
		}
		var recipientRole, recipientEmail, ownerName string
		err := tx.QueryRow(ctx, `
			SELECT m.role, u.email::text, (SELECT name FROM users WHERE id = $3::uuid)
			FROM club_members m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND u.account_status = 'active'
			WHERE m.club_id = $1::uuid AND m.user_id = $2::uuid
		`, ref.id, recipientUserID, ownerUserID).Scan(&recipientRole, &recipientEmail, &ownerName)
		if errors.Is(err, pgx.ErrNoRows) || recipientRole == RoleOwner {
			return ErrClubMemberNotFound
		}
		if err != nil {
			return fmt.Errorf("read ownership recipient: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO club_ownership_offers (club_id, from_user_id, to_user_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
			ON CONFLICT (club_id) DO UPDATE
			SET from_user_id = EXCLUDED.from_user_id, to_user_id = EXCLUDED.to_user_id, created_at = NOW()
		`, ref.id, ownerUserID, recipientUserID); err != nil {
			return fmt.Errorf("record ownership offer: %w", err)
		}
		// One email per offer: a repeated offer to the same person is a new one.
		var offeredAt time.Time
		if err := tx.QueryRow(ctx, `SELECT created_at FROM club_ownership_offers WHERE club_id = $1::uuid`, ref.id).Scan(&offeredAt); err != nil {
			return fmt.Errorf("read ownership offer: %w", err)
		}
		if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
			Kind:      emailoutbox.KindClubOwnershipOffered,
			Recipient: recipientEmail,
			Payload:   OwnershipOfferPayload{ClubName: ref.name, ClubSlug: ref.slug, OwnerName: ownerName},
			IdempotencyKey: fmt.Sprintf("%s:%s:%s:%d", emailoutbox.KindClubOwnershipOffered, ref.id, recipientUserID,
				offeredAt.UnixMicro()),
		}); err != nil {
			return fmt.Errorf("enqueue ownership offer: %w", err)
		}
		return audit(ctx, tx, ownerUserID, ActionOwnershipOffered, ref.id, nil, map[string]string{"to_user_id": recipientUserID}, nil)
	})
}

// CancelOwnershipOffer withdraws the club's ownership offer. An owner
// withdraws it; its recipient declines it.
func (r *PostgresRepository) CancelOwnershipOffer(ctx context.Context, slug, userID string) error {
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		var recipient string
		err := tx.QueryRow(ctx, `
			DELETE FROM club_ownership_offers
			WHERE club_id = $1::uuid AND ($2 = 'owner' OR to_user_id = $3::uuid)
			RETURNING to_user_id::text
		`, ref.id, ref.role, userID).Scan(&recipient)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOwnershipOfferNotFound
		}
		if err != nil {
			return fmt.Errorf("cancel ownership offer: %w", err)
		}
		return audit(ctx, tx, userID, ActionOwnershipOfferCanceled, ref.id, map[string]string{"to_user_id": recipient}, nil, nil)
	})
}

// AcceptOwnership makes the offer's recipient an owner. The owner who made
// the offer becomes an editor.
func (r *PostgresRepository) AcceptOwnership(ctx context.Context, slug, userID string) error {
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		var from string
		err := tx.QueryRow(ctx, `
			DELETE FROM club_ownership_offers WHERE club_id = $1::uuid AND to_user_id = $2::uuid
			RETURNING from_user_id::text
		`, ref.id, userID).Scan(&from)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOwnershipOfferNotFound
		}
		if err != nil {
			return fmt.Errorf("take ownership offer: %w", err)
		}
		if ref.role == "" {
			return ErrClubMemberNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE club_members SET role = 'owner' WHERE club_id = $1::uuid AND user_id = $2::uuid`, ref.id, userID); err != nil {
			return fmt.Errorf("promote club owner: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE club_members SET role = 'editor' WHERE club_id = $1::uuid AND user_id = $2::uuid AND role = 'owner'
		`, ref.id, from); err != nil {
			return fmt.Errorf("demote former owner: %w", err)
		}
		return audit(ctx, tx, userID, ActionOwnershipTransferred, ref.id,
			map[string]string{"owner_user_id": from}, map[string]string{"owner_user_id": userID}, nil)
	})
}
