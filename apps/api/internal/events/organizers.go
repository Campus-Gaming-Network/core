package events

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
	"github.com/jackc/pgx/v5"
)

// MaximumOrganizers bounds an event's organizers, the creator included, plus
// the invites still waiting on an answer.
const MaximumOrganizers = 10

var (
	ErrCreatorRequired           = apperror.New(apperror.KindAuthorization, "not_event_creator", "only the event's creator can do this")
	ErrOrganizerLimit            = apperror.New(apperror.KindConflict, "organizer_limit_reached", "the event has as many organizers and invites as it can")
	ErrOrganizerInviteNotFound   = apperror.New(apperror.KindNotFound, "organizer_invite_not_found", "organizer invite not found or no longer valid")
	ErrOrganizerInviteWrongEmail = apperror.New(apperror.KindAuthorization, "organizer_invite_wrong_account", "the invite was sent to another email address")
	ErrOrganizerNotFound         = apperror.New(apperror.KindNotFound, "organizer_not_found", "organizer not found")
	ErrCreatorCannotLeave        = apperror.New(apperror.KindConflict, "creator_cannot_leave", "the creator cannot be removed; hand the event to another organizer first")
)

// OrganizerInvite is a pending invite as the event's creator sees it.
type OrganizerInvite struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// OrganizerInviteParams describes one invite. Only TokenHash is stored; the
// raw token goes to the invited address in the email.
type OrganizerInviteParams struct {
	Slug          string
	CreatorUserID string
	Email         string
	RawToken      string
	TokenHash     []byte
	ExpiresAt     time.Time
}

// OrganizerInvitePayload is what the invite email shows. A private event's
// title is left out, because the address may not be the one the creator meant.
type OrganizerInvitePayload struct {
	Token       string `json:"token"`
	EventTitle  string `json:"event_title,omitempty"`
	InviterName string `json:"inviter_name"`
}

// lockOwnedEvent locks the event and returns its ID when userID created it.
func lockOwnedEvent(ctx context.Context, tx pgx.Tx, slug string, userID string) (string, error) {
	var eventID, creatorID string
	err := tx.QueryRow(ctx, `
		SELECT id::text, creator_user_id::text
		FROM events
		WHERE slug = $1 AND deleted_at IS NULL
		FOR UPDATE
	`, strings.TrimSpace(slug)).Scan(&eventID, &creatorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrEventNotFound
	}
	if err != nil {
		return "", fmt.Errorf("lock event: %w", err)
	}
	if creatorID != strings.TrimSpace(userID) {
		return "", ErrCreatorRequired
	}
	return eventID, nil
}

// lockCancellableEvent locks the event and returns its ID when userID created
// it or owns or edits its host club.
func lockCancellableEvent(ctx context.Context, tx pgx.Tx, slug string, userID string) (string, error) {
	var eventID string
	var allowed bool
	err := tx.QueryRow(ctx, `
		SELECT e.id::text, e.creator_user_id = $2::uuid OR `+hostClubOfficer("$2")+`
		FROM events e
		WHERE e.slug = $1 AND e.deleted_at IS NULL
		FOR UPDATE OF e
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&eventID, &allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrEventNotFound
	}
	if err != nil {
		return "", fmt.Errorf("lock event: %w", err)
	}
	if !allowed {
		return "", ErrCreatorRequired
	}
	return eventID, nil
}

// InviteOrganizer records an invite and queues its email. The result is the
// same whether or not the address has an account, so an invite reveals
// nothing about who is registered. Inviting an address again replaces its
// pending invite.
func (r *PostgresRepository) InviteOrganizer(ctx context.Context, params OrganizerInviteParams) (OrganizerInvite, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return OrganizerInvite{}, fmt.Errorf("begin organizer invite: %w", err)
	}
	defer tx.Rollback(ctx)

	eventID, err := lockOwnedEvent(ctx, tx, params.Slug, params.CreatorUserID)
	if err != nil {
		return OrganizerInvite{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_organizer_invites
		SET revoked_at = NOW()
		WHERE event_id = $1::uuid AND email = $2::citext
		  AND accepted_at IS NULL AND revoked_at IS NULL
	`, eventID, params.Email); err != nil {
		return OrganizerInvite{}, fmt.Errorf("replace organizer invite: %w", err)
	}
	var organizers, pending int
	var title, visibility, inviterName string
	if err := tx.QueryRow(ctx, `
		SELECT (SELECT COUNT(*) FROM event_organizers
		        WHERE event_id = e.id AND deleted_at IS NULL),
		       (SELECT COUNT(*) FROM event_organizer_invites
		        WHERE event_id = e.id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2),
		       e.title, e.visibility, u.name
		FROM events e
		JOIN users u ON u.id = e.creator_user_id
		WHERE e.id = $1::uuid
	`, eventID, r.now()).Scan(&organizers, &pending, &title, &visibility, &inviterName); err != nil {
		return OrganizerInvite{}, fmt.Errorf("count organizers: %w", err)
	}
	if organizers+pending >= MaximumOrganizers {
		return OrganizerInvite{}, ErrOrganizerLimit
	}

	var invite OrganizerInvite
	if err := tx.QueryRow(ctx, `
		INSERT INTO event_organizer_invites (event_id, invited_by_user_id, email, token_hash, expires_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5)
		RETURNING id::text, email::text, expires_at, created_at
	`, eventID, params.CreatorUserID, params.Email, params.TokenHash, params.ExpiresAt).Scan(
		&invite.ID, &invite.Email, &invite.ExpiresAt, &invite.CreatedAt,
	); err != nil {
		return OrganizerInvite{}, fmt.Errorf("insert organizer invite: %w", err)
	}
	payload := OrganizerInvitePayload{Token: params.RawToken, InviterName: inviterName}
	if visibility != VisibilityPrivate {
		payload.EventTitle = title
	}
	if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
		Kind:           emailoutbox.KindOrganizerInvite,
		Recipient:      params.Email,
		Payload:        payload,
		IdempotencyKey: emailoutbox.TokenKey(emailoutbox.KindOrganizerInvite, params.TokenHash),
	}); err != nil {
		return OrganizerInvite{}, fmt.Errorf("enqueue organizer invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizerInvite{}, fmt.Errorf("commit organizer invite: %w", err)
	}
	return invite, nil
}

// ListOrganizerInvites returns the event's pending invites, newest first, to
// its creator.
func (r *PostgresRepository) ListOrganizerInvites(ctx context.Context, slug string, creatorUserID string) ([]OrganizerInvite, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin organizer invite list: %w", err)
	}
	defer tx.Rollback(ctx)
	eventID, err := lockOwnedEvent(ctx, tx, slug, creatorUserID)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text, email::text, expires_at, created_at
		FROM event_organizer_invites
		WHERE event_id = $1::uuid AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2
		ORDER BY created_at DESC, id
	`, eventID, r.now())
	if err != nil {
		return nil, fmt.Errorf("list organizer invites: %w", err)
	}
	invites, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (OrganizerInvite, error) {
		var invite OrganizerInvite
		err := row.Scan(&invite.ID, &invite.Email, &invite.ExpiresAt, &invite.CreatedAt)
		return invite, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan organizer invites: %w", err)
	}
	return invites, tx.Commit(ctx)
}

// RevokeOrganizerInvite withdraws a pending invite, so its link stops working.
func (r *PostgresRepository) RevokeOrganizerInvite(ctx context.Context, slug string, creatorUserID string, inviteID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin organizer invite revoke: %w", err)
	}
	defer tx.Rollback(ctx)
	eventID, err := lockOwnedEvent(ctx, tx, slug, creatorUserID)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE event_organizer_invites
		SET revoked_at = NOW()
		WHERE id = $1::uuid AND event_id = $2::uuid AND accepted_at IS NULL AND revoked_at IS NULL
	`, inviteID, eventID)
	if err != nil {
		return fmt.Errorf("revoke organizer invite: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrOrganizerInviteNotFound
	}
	return tx.Commit(ctx)
}

// AcceptOrganizerInvite makes userID an organizer of the invite's event and
// returns the event's slug. The invite must be pending and unexpired, its
// event not cancelled, and its address the account's own. A wrong account
// leaves the invite usable by the right one.
func (r *PostgresRepository) AcceptOrganizerInvite(ctx context.Context, tokenHash []byte, userID string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin organizer invite accept: %w", err)
	}
	defer tx.Rollback(ctx)

	var inviteID, eventID, slug string
	var emailMatches bool
	err = tx.QueryRow(ctx, `
		SELECT i.id::text, e.id::text, e.slug,
		       EXISTS (
		           SELECT 1 FROM users u
		           WHERE u.id = $2::uuid AND u.email = i.email
		             AND u.deleted_at IS NULL AND u.account_status = 'active'
		       )
		FROM event_organizer_invites i
		JOIN events e ON e.id = i.event_id AND e.deleted_at IS NULL
		WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > $3
		FOR UPDATE OF i, e
	`, tokenHash, userID, r.now()).Scan(&inviteID, &eventID, &slug, &emailMatches)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrganizerInviteNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find organizer invite: %w", err)
	}
	if !emailMatches {
		return "", ErrOrganizerInviteWrongEmail
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_organizer_invites
		SET accepted_at = NOW(), accepted_by_user_id = $2::uuid
		WHERE id = $1::uuid
	`, inviteID, userID); err != nil {
		return "", fmt.Errorf("accept organizer invite: %w", err)
	}
	// Someone already organizing keeps their role, the creator's included.
	if _, err := tx.Exec(ctx, `
		INSERT INTO event_organizers (event_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'organizer')
		ON CONFLICT (event_id, user_id) DO UPDATE
		SET deleted_at = NULL,
		    role = CASE WHEN event_organizers.deleted_at IS NULL THEN event_organizers.role ELSE 'organizer' END
	`, eventID, userID); err != nil {
		return "", fmt.Errorf("add event organizer: %w", err)
	}
	var creatorID, title, name string
	if err := tx.QueryRow(ctx, `
		SELECT e.creator_user_id::text, e.title, u.name
		FROM events e, users u
		WHERE e.id = $1::uuid AND u.id = $2::uuid
	`, eventID, userID).Scan(&creatorID, &title, &name); err != nil {
		return "", fmt.Errorf("read accepted invite: %w", err)
	}
	if creatorID != userID {
		if err := notifications.Insert(ctx, tx, notifications.Input{
			UserID:  creatorID,
			Type:    notifications.TypeEventOrganizerJoined,
			Title:   "New co-organizer",
			Body:    name + " accepted your invitation and is now a co-organizer of " + title + ".",
			EventID: eventID,
		}); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit organizer invite accept: %w", err)
	}
	return slug, nil
}

// RemoveOrganizer takes organizerUserID off the event. The creator can remove
// any co-organizer, and a co-organizer can remove themselves; the creator
// cannot be removed.
func (r *PostgresRepository) RemoveOrganizer(ctx context.Context, slug string, actorUserID string, organizerUserID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin organizer removal: %w", err)
	}
	defer tx.Rollback(ctx)

	var eventID, creatorID string
	var actorOrganizes bool
	err = tx.QueryRow(ctx, `
		SELECT e.id::text, e.creator_user_id::text,
		       EXISTS (SELECT 1 FROM event_organizers eo
		               WHERE eo.event_id = e.id AND eo.user_id = $2::uuid AND eo.deleted_at IS NULL)
		FROM events e
		WHERE e.slug = $1 AND e.deleted_at IS NULL
		FOR UPDATE
	`, strings.TrimSpace(slug), actorUserID).Scan(&eventID, &creatorID, &actorOrganizes)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrEventNotFound
	}
	if err != nil {
		return fmt.Errorf("lock event: %w", err)
	}
	switch {
	case !actorOrganizes:
		return ErrOrganizerRequired
	case organizerUserID == creatorID:
		return ErrCreatorCannotLeave
	case actorUserID != creatorID && actorUserID != organizerUserID:
		return ErrCreatorRequired
	}
	tag, err := tx.Exec(ctx, `
		UPDATE event_organizers
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND user_id = $2::uuid AND deleted_at IS NULL
	`, eventID, organizerUserID)
	if err != nil {
		return fmt.Errorf("remove event organizer: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrOrganizerNotFound
	}
	return tx.Commit(ctx)
}

// TransferCreator hands the creator role to a co-organizer. The former
// creator stays on as a co-organizer.
func (r *PostgresRepository) TransferCreator(ctx context.Context, slug string, creatorUserID string, organizerUserID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin creator transfer: %w", err)
	}
	defer tx.Rollback(ctx)

	eventID, err := lockOwnedEvent(ctx, tx, slug, creatorUserID)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE event_organizers eo
		SET role = 'creator'
		FROM users u
		WHERE eo.event_id = $1::uuid AND eo.user_id = $2::uuid AND eo.deleted_at IS NULL
		  AND eo.role = 'organizer'
		  AND u.id = eo.user_id AND u.deleted_at IS NULL AND u.account_status = 'active'
	`, eventID, organizerUserID)
	if err != nil {
		return fmt.Errorf("promote event organizer: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrOrganizerNotFound
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_organizers SET role = 'organizer'
		WHERE event_id = $1::uuid AND user_id = $2::uuid
	`, eventID, creatorUserID); err != nil {
		return fmt.Errorf("demote former creator: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE events SET creator_user_id = $2::uuid WHERE id = $1::uuid
	`, eventID, organizerUserID); err != nil {
		return fmt.Errorf("transfer event creator: %w", err)
	}
	return tx.Commit(ctx)
}
