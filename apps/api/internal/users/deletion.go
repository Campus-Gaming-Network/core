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
// The row has to survive: events reference creator_user_id without a cascade,
// and deleting the account should not delete events other people have RSVP'd to
// and hold calendar entries for. Nothing exposes a creator or organizer name on
// an event, so scrubbing the user row is enough to remove the person from those
// surfaces.
//
// Everything happens in one transaction:
//
//   - Teams they own transfer to the longest-tenured captain, else the
//     longest-tenured member, else are soft-deleted when they were alone.
//   - Identifying columns are overwritten and the account is marked deleted.
//     The email becomes a unique placeholder, which also releases the real
//     address for re-registration.
//   - Purely personal rows — social links, school follows, RSVPs, interests —
//     are hard deleted.
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
		    WHERE m.user_id <> $1::uuid
		      AND m.deleted_at IS NULL
		    ORDER BY m.team_id,
		             CASE m.role WHEN 'captain' THEN 0 ELSE 1 END,
		             m.created_at
		)
		UPDATE teams t
		SET owner_user_id = successor.user_id
		FROM successor
		WHERE t.id = successor.team_id
	`, userID); err != nil {
		return fmt.Errorf("transfer owned teams: %w", err)
	}

	// Give the new owner the owner role.
	if _, err := tx.Exec(ctx, `
		UPDATE team_members m
		SET role = 'owner'
		FROM teams t
		WHERE t.id = m.team_id
		  AND t.owner_user_id = m.user_id
		  AND m.deleted_at IS NULL
		  AND m.role <> 'owner'
	`); err != nil {
		return fmt.Errorf("promote new team owners: %w", err)
	}

	// Anything still owned by this user had no other member.
	if _, err := tx.Exec(ctx, `
		UPDATE teams
		SET deleted_at = NOW()
		WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
	`, userID); err != nil {
		return fmt.Errorf("soft delete orphaned teams: %w", err)
	}

	for _, statement := range []string{
		`DELETE FROM team_members WHERE user_id = $1::uuid`,
		`DELETE FROM user_social_links WHERE user_id = $1::uuid`,
		`DELETE FROM user_school_follows WHERE user_id = $1::uuid`,
		`DELETE FROM event_rsvps WHERE user_id = $1::uuid`,
		`DELETE FROM event_interests WHERE user_id = $1::uuid`,
		`DELETE FROM email_verification_tokens WHERE user_id = $1::uuid`,
		`DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`,
		`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
	} {
		if _, err := tx.Exec(ctx, statement, userID); err != nil {
			return fmt.Errorf("clear account data: %w", err)
		}
	}

	// The organizer rows stay so events keep a creator reference, but the
	// person behind them is gone once the user row is scrubbed.
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
