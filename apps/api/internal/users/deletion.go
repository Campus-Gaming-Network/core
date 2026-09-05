package users

import (
	"context"
	"fmt"
)

// DeletedNamePlaceholder is what a deleted account renders as anywhere a name
// would otherwise appear.
const DeletedNamePlaceholder = "Deleted user"

// deletedPasswordSentinel is not a valid hash in any supported format, so
// ComparePassword can never match it.
const deletedPasswordSentinel = "deleted"

// DeleteAccount anonymizes a user in place rather than removing the row.
//
// The row has to survive because domain history keeps foreign keys to it. Public
// and personally scoped data is removed, transferred, or anonymized around that
// retained row.
//
// Everything happens in one transaction:
//
//   - Teams they own transfer to the longest-tenured captain, else the
//     longest-tenured member, else are soft-deleted when they were alone.
//   - Events they created transfer to the longest-tenured other active
//     organizer, else are soft-deleted so no public event is orphaned.
//   - Support tickets are detached. Terminal tickets lose direct contact
//     fields; pending tickets retain them so the support conversation can end.
//   - Identifying columns are overwritten and the account is marked deleted.
//     The email becomes a unique placeholder, which also releases the real
//     address for re-registration.
//   - Purely personal rows — social links, school follows, RSVPs, interests,
//     and notifications — are hard deleted. Domain audit history remains.
//   - Open moderation and support work is unassigned from the deleted account.
//   - Sessions are revoked and outstanding tokens are dropped.
func (r *PostgresRepository) DeleteAccount(ctx context.Context, userID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT TRUE FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status <> 'deleted'
		FOR UPDATE
	`, userID).Scan(&exists); err != nil {
		return fmt.Errorf("lock account for deletion: %w", err)
	}

	// Promote a successor for each owned team. ROW_NUMBER picks captains ahead
	// of members and, within each role, whoever joined first.
	if _, err := tx.Exec(ctx, `
		WITH owned AS (
		    SELECT id FROM teams
		    WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
		), successor AS (
		    SELECT DISTINCT ON (m.team_id) m.team_id, m.user_id
		    FROM team_members m
		    JOIN owned o ON o.id = m.team_id
		    JOIN users u ON u.id = m.user_id
		    WHERE m.user_id <> $1::uuid
		      AND m.deleted_at IS NULL
		      AND u.deleted_at IS NULL
		      AND u.account_status = 'active'
		    ORDER BY m.team_id,
		             CASE m.role WHEN 'captain' THEN 0 ELSE 1 END,
		             m.created_at,
		             m.user_id
		), transferred AS (
		    UPDATE teams t
		    SET owner_user_id = successor.user_id
		    FROM successor
		    WHERE t.id = successor.team_id
		    RETURNING t.id, t.owner_user_id
		)
		UPDATE team_members m
		SET role = 'owner'
		FROM transferred
		WHERE m.team_id = transferred.id
		  AND m.user_id = transferred.owner_user_id
		  AND m.deleted_at IS NULL
		  AND m.role <> 'owner'
	`, userID); err != nil {
		return fmt.Errorf("transfer owned teams: %w", err)
	}

	// Anything still owned by this user had no other member.
	if _, err := tx.Exec(ctx, `
		UPDATE teams
		SET deleted_at = NOW()
		WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
	`, userID); err != nil {
		return fmt.Errorf("soft delete orphaned teams: %w", err)
	}

	// Keep an event manageable when another active organizer exists. Events
	// without a successor are archived below instead of remaining public under
	// an account that can no longer manage them.
	if _, err := tx.Exec(ctx, `
		WITH owned AS (
		    SELECT id
		    FROM events
		    WHERE creator_user_id = $1::uuid
		      AND deleted_at IS NULL
		      AND ends_at > NOW()
		), successor AS (
		    SELECT DISTINCT ON (eo.event_id) eo.event_id, eo.user_id
		    FROM event_organizers eo
		    JOIN owned o ON o.id = eo.event_id
		    JOIN users u ON u.id = eo.user_id
		    WHERE eo.user_id <> $1::uuid
		      AND eo.deleted_at IS NULL
		      AND u.deleted_at IS NULL
		      AND u.account_status = 'active'
		    ORDER BY eo.event_id, eo.created_at, eo.user_id
		), transferred AS (
		    UPDATE events e
		    SET creator_user_id = successor.user_id
		    FROM successor
		    WHERE e.id = successor.event_id
		    RETURNING e.id, e.creator_user_id
		)
		UPDATE event_organizers eo
		SET role = 'creator'
		FROM transferred
		WHERE eo.event_id = transferred.id
		  AND eo.user_id = transferred.creator_user_id
	`, userID); err != nil {
		return fmt.Errorf("transfer created events: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		WITH archived_events AS (
		    UPDATE events
		    SET deleted_at = NOW()
		    WHERE creator_user_id = $1::uuid AND deleted_at IS NULL
		    RETURNING id
		), archived_organizers AS (
		    UPDATE event_organizers eo
		    SET deleted_at = NOW()
		    FROM archived_events e
		    WHERE eo.event_id = e.id AND eo.deleted_at IS NULL
		), archived_rsvps AS (
		    UPDATE event_rsvps er
		    SET deleted_at = NOW()
		    FROM archived_events e
		    WHERE er.event_id = e.id AND er.deleted_at IS NULL
		), archived_interests AS (
		    UPDATE event_interests ei
		    SET deleted_at = NOW()
		    FROM archived_events e
		    WHERE ei.event_id = e.id AND ei.deleted_at IS NULL
		)
		UPDATE event_private_unlocks eu
		SET deleted_at = NOW()
		FROM archived_events e
		WHERE eu.event_id = e.id AND eu.deleted_at IS NULL
	`, userID); err != nil {
		return fmt.Errorf("soft delete orphaned events: %w", err)
	}

	// A submitted ticket remains available to support, but the account link is
	// removed. Closed work no longer needs a reply address or submitter name.
	if _, err := tx.Exec(ctx, `
		UPDATE support_tickets
		SET submitter_user_id = NULL,
		    submitter_deleted_at = NOW(),
		    contact_email = CASE
		        WHEN status IN ('resolved', 'closed') THEN 'deleted@deleted.invalid'
		        ELSE contact_email
		    END,
		    name = CASE
		        WHEN status IN ('resolved', 'closed') THEN ''
		        ELSE name
		    END
		WHERE submitter_user_id = $1::uuid
	`, userID); err != nil {
		return fmt.Errorf("detach support tickets: %w", err)
	}

	for _, statement := range []string{
		`UPDATE reports SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1::uuid`,
		`UPDATE support_tickets SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1::uuid`,
		`DELETE FROM team_members WHERE user_id = $1::uuid`,
		`DELETE FROM event_organizers WHERE user_id = $1::uuid`,
		`DELETE FROM school_admins WHERE user_id = $1::uuid`,
		`DELETE FROM user_social_links WHERE user_id = $1::uuid`,
		`DELETE FROM user_school_follows WHERE user_id = $1::uuid`,
		`DELETE FROM event_rsvps WHERE user_id = $1::uuid`,
		`DELETE FROM event_interests WHERE user_id = $1::uuid`,
		`DELETE FROM notifications WHERE user_id = $1::uuid`,
		`DELETE FROM email_verification_tokens WHERE user_id = $1::uuid`,
		`DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`,
		`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
	} {
		if _, err := tx.Exec(ctx, statement, userID); err != nil {
			return fmt.Errorf("clear account data: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET email = 'deleted-' || id::text || '@deleted.invalid',
		    name = $2,
		    bio = NULL,
		    timezone = 'UTC',
		    password_hash = $3,
		    verification_level = 'basic',
		    email_verified_at = NULL,
		    account_status = 'deleted',
		    deleted_at = NOW()
		WHERE id = $1::uuid
	`, userID, DeletedNamePlaceholder, deletedPasswordSentinel); err != nil {
		return fmt.Errorf("anonymize account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit account deletion: %w", err)
	}
	return nil
}
