package users

import (
	"context"
	"fmt"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
	"github.com/jackc/pgx/v5"
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
//   - Reports and support tickets assigned to the account are unassigned,
//     with one audit entry per item.
//   - Sessions are revoked and outstanding tokens are dropped.
func (r *PostgresRepository) DeleteAccount(ctx context.Context, userID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback(ctx)
	// Account deletion must participate in the same last-admin invariant as
	// suspension and grant revocation.
	if _, err := tx.Exec(ctx, `LOCK TABLE site_role_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}

	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT TRUE FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status <> 'deleted'
		FOR UPDATE
	`, userID).Scan(&exists); err != nil {
		return fmt.Errorf("lock account for deletion: %w", err)
	}
	var lastAdmin bool
	if err := tx.QueryRow(ctx, `SELECT
	 EXISTS(SELECT 1 FROM site_role_grants WHERE user_id=$1::uuid AND revoked_at IS NULL)
	 AND NOT EXISTS(SELECT 1 FROM site_role_grants g JOIN users u ON u.id=g.user_id
	 WHERE g.user_id<>$1::uuid AND g.revoked_at IS NULL AND u.deleted_at IS NULL AND u.account_status='active' AND u.email_verified_at IS NOT NULL)`, userID).Scan(&lastAdmin); err != nil {
		return err
	}
	if lastAdmin {
		return adminaccess.ErrLastActiveSiteAdmin
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

	// Events still owned by this account have no eligible successor and are
	// cancelled below. Persist one independent notification per active attendee
	// of each event that has not ended, before RSVP rows and the owner's
	// identity are scrubbed.
	if _, err := tx.Exec(ctx, `
		INSERT INTO email_outbox (kind, recipient, payload, idempotency_key)
		SELECT 'event_cancellation',
		       attendee.email::text,
		       jsonb_build_object('event', jsonb_build_object(
		           'id', e.id::text,
		           'title', e.title,
		           'slug', e.slug
		       )),
		       'event-cancellation:' || e.id::text || ':' || attendee.id::text
		FROM events e
		JOIN event_rsvps r ON r.event_id = e.id
		JOIN users attendee ON attendee.id = r.user_id
		WHERE e.creator_user_id = $1::uuid
		  AND e.deleted_at IS NULL
		  AND e.ends_at > NOW()
		  AND r.deleted_at IS NULL
		  AND r.response IN ('yes', 'maybe')
		  AND attendee.id <> $1::uuid
		  AND attendee.deleted_at IS NULL
		  AND attendee.account_status = 'active'
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID); err != nil {
		return fmt.Errorf("enqueue deleted-account event cancellations: %w", err)
	}
	// The same attendees get an inbox notice.
	if _, err := tx.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
		SELECT attendee.id, $2, 'Event cancelled',
		       LEFT(e.title || ' was cancelled because its organizer deleted their account.', 2000),
		       'event', e.id
		FROM events e
		JOIN event_rsvps r ON r.event_id = e.id
		JOIN users attendee ON attendee.id = r.user_id
		WHERE e.creator_user_id = $1::uuid
		  AND e.deleted_at IS NULL
		  AND e.ends_at > NOW()
		  AND r.deleted_at IS NULL
		  AND r.response IN ('yes', 'maybe')
		  AND attendee.id <> $1::uuid
		  AND attendee.deleted_at IS NULL
		  AND attendee.account_status = 'active'
	`, userID, notifications.TypeEventCancelled); err != nil {
		return fmt.Errorf("notify deleted-account event cancellations: %w", err)
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

	if err := unassignDeletedAccountQueueWork(ctx, tx, userID); err != nil {
		return err
	}

	for _, statement := range []string{
		`DELETE FROM team_members WHERE user_id = $1::uuid`,
		`DELETE FROM event_organizers WHERE user_id = $1::uuid`,
		// A club the account was the last owner of passes to its
		// longest-serving active editor, then member, as an event passes to
		// its longest-serving organizer. With no one left it returns to
		// unclaimed; its page stays up either way.
		`WITH sole AS (
		     SELECT m.club_id FROM club_members m
		     WHERE m.user_id = $1::uuid AND m.role = 'owner'
		       AND NOT EXISTS (
		           SELECT 1 FROM club_members o JOIN users u ON u.id = o.user_id
		           WHERE o.club_id = m.club_id AND o.role = 'owner' AND o.user_id <> $1::uuid
		             AND u.deleted_at IS NULL AND u.account_status = 'active')),
		 successor AS (
		     SELECT DISTINCT ON (c.club_id) c.club_id, c.user_id
		     FROM club_members c
		     JOIN sole ON sole.club_id = c.club_id
		     JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL AND u.account_status = 'active'
		     WHERE c.user_id <> $1::uuid
		     ORDER BY c.club_id, CASE c.role WHEN 'editor' THEN 0 ELSE 1 END, c.created_at, c.user_id)
		 UPDATE club_members m SET role = 'owner'
		 FROM successor
		 WHERE m.club_id = successor.club_id AND m.user_id = successor.user_id`,
		`DELETE FROM club_ownership_offers WHERE from_user_id = $1::uuid OR to_user_id = $1::uuid`,
		`DELETE FROM club_members WHERE user_id = $1::uuid`,
		// Invites to edit a club hold the address; they cannot be accepted
		// once the account is gone.
		`DELETE FROM club_editor_invites
		 WHERE email = (SELECT email FROM users WHERE id = $1::uuid)`,
		// Claims hold the applicant's evidence. Their decisions stay in the
		// audit history.
		`DELETE FROM club_claims WHERE applicant_user_id = $1::uuid`,
		// Administrative grants are revoked rather than deleted so their
		// audited history stays addressable.
		`UPDATE school_admins SET deleted_at = NOW() WHERE user_id = $1::uuid AND deleted_at IS NULL`,
		`UPDATE site_role_grants
		 SET revoked_at = GREATEST(NOW(), granted_at), revoked_by_user_id = $1::uuid, revoke_reason = 'account deleted'
		 WHERE user_id = $1::uuid AND revoked_at IS NULL`,
		`DELETE FROM user_social_links WHERE user_id = $1::uuid`,
		`DELETE FROM user_school_follows WHERE user_id = $1::uuid`,
		`DELETE FROM user_games WHERE user_id = $1::uuid`,
		`DELETE FROM event_rsvps WHERE user_id = $1::uuid`,
		`DELETE FROM event_interests WHERE user_id = $1::uuid`,
		`DELETE FROM notifications WHERE user_id = $1::uuid`,
		`DELETE FROM email_outbox
		 WHERE recipient = (SELECT email::text FROM users WHERE id = $1::uuid)
		    OR payload ->> 'user_id' = ($1::uuid)::text`,
		// Invites to co-organize hold the address; they cannot be accepted
		// once the account is gone.
		`DELETE FROM event_organizer_invites
		 WHERE email = (SELECT email FROM users WHERE id = $1::uuid)`,
		`DELETE FROM email_verification_tokens WHERE user_id = $1::uuid`,
		`DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`,
		`DELETE FROM email_change_tokens WHERE user_id = $1::uuid`,
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

// unassignDeletedAccountQueueWork clears the account from every report and
// support ticket assigned to it and records each one in the audit history,
// so an item's history explains why it lost its assignee.
func unassignDeletedAccountQueueWork(ctx context.Context, tx pgx.Tx, userID string) error {
	audit := adminaudit.NewPostgresStoreForTransaction(tx)
	for _, queue := range []struct {
		statement  string
		action     adminaudit.Action
		entityType adminaudit.EntityType
	}{
		{
			statement: `UPDATE reports SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1::uuid
			 RETURNING id::text, status, retention_started_at`,
			action:     adminaudit.ActionReportAssigneeDeleted,
			entityType: adminaudit.EntityReport,
		},
		{
			statement: `UPDATE support_tickets SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1::uuid
			 RETURNING id::text, status, retention_started_at`,
			action:     adminaudit.ActionSupportTicketAssigneeDeleted,
			entityType: adminaudit.EntitySupportTicket,
		},
	} {
		rows, err := tx.Query(ctx, queue.statement, userID)
		if err != nil {
			return fmt.Errorf("unassign %s work: %w", queue.entityType, err)
		}
		type unassigned struct {
			id                 string
			status             string
			retentionStartedAt *time.Time
		}
		items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (unassigned, error) {
			var item unassigned
			if err := row.Scan(&item.id, &item.status, &item.retentionStartedAt); err != nil {
				return unassigned{}, err
			}
			if item.retentionStartedAt != nil {
				utc := item.retentionStartedAt.UTC()
				item.retentionStartedAt = &utc
			}
			return item, nil
		})
		if err != nil {
			return fmt.Errorf("unassign %s work: %w", queue.entityType, err)
		}
		for _, item := range items {
			if _, err := audit.Insert(ctx, adminaudit.WriteInput{
				Correlation: adminaudit.Correlation{ActorUserID: userID},
				Action:      queue.action,
				EntityType:  queue.entityType,
				EntityID:    item.id,
				Before: adminaudit.QueueState{
					Status:             item.status,
					AssignedToUserID:   &userID,
					RetentionStartedAt: item.retentionStartedAt,
				},
				After: adminaudit.QueueState{
					Status:             item.status,
					RetentionStartedAt: item.retentionStartedAt,
				},
			}); err != nil {
				return fmt.Errorf("audit %s unassignment: %w", queue.entityType, err)
			}
		}
	}
	return nil
}
