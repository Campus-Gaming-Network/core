package clubs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/jackc/pgx/v5"
)

// ConfirmationWindow is how long a club's details count as confirmed. An
// older confirmation shows "Needs confirmation" and reminds a claimed club's
// owners. It never hides the club or marks it inactive.
const ConfirmationWindow = 90 * 24 * time.Hour

// ActionDetailsConfirmed is the audit action for an officer confirming the
// club's details are current.
const ActionDetailsConfirmed = "club.details_confirmed"

// DefaultReminderInterval is how often the API looks for clubs whose owners
// need a reminder.
const DefaultReminderInterval = time.Hour

// reminderBatchSize bounds the clubs one reminder transaction locks.
const reminderBatchSize = 100

// ConfirmationDuePayload is what the reminder to confirm a club says.
type ConfirmationDuePayload struct {
	ClubName string `json:"club_name"`
	ClubSlug string `json:"club_slug"`
}

// NeedsConfirmation reports whether a confirmation at confirmedAt is older
// than ConfirmationWindow at now. A club never confirmed has no date to age.
func NeedsConfirmation(confirmedAt *time.Time, now time.Time) bool {
	return confirmedAt != nil && now.Sub(*confirmedAt) > ConfirmationWindow
}

// Confirm records that an owner or editor confirmed the club's details are
// current.
func (r *PostgresRepository) Confirm(ctx context.Context, slug, userID string) error {
	return r.officerChange(ctx, slug, userID, func(tx pgx.Tx, ref clubRef) error {
		if !ref.officer() {
			return ErrNotClubOfficer
		}
		if _, err := tx.Exec(ctx, `
			UPDATE clubs SET confirmed_at = $2, confirmed_source = 'club' WHERE id = $1::uuid
		`, ref.id, r.now()); err != nil {
			return fmt.Errorf("confirm club: %w", err)
		}
		return audit(ctx, tx, userID, ActionDetailsConfirmed, ref.id, nil, nil, nil)
	})
}

// QueueConfirmationReminders emails the owners of each claimed club whose
// confirmation has passed ConfirmationWindow, once per lapse, and returns how
// many clubs it reminded. A club is reminded again only after it is
// confirmed and that confirmation lapses too.
func (r *PostgresRepository) QueueConfirmationReminders(ctx context.Context) (int, error) {
	cutoff := r.now().Add(-ConfirmationWindow)
	total := 0
	for {
		reminded, err := r.queueReminderBatch(ctx, cutoff)
		total += reminded
		if err != nil || reminded < reminderBatchSize {
			return total, err
		}
	}
}

func (r *PostgresRepository) queueReminderBatch(ctx context.Context, cutoff time.Time) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin club reminders: %w", err)
	}
	defer tx.Rollback(ctx)

	type lapsed struct {
		id, name, slug string
		confirmedAt    time.Time
	}
	rows, err := tx.Query(ctx, `
		SELECT c.id::text, c.name, c.slug, c.confirmed_at
		FROM clubs c
		WHERE `+publishedClub+` AND c.confirmed_at < $1 AND `+claimedColumn+`
		  AND NOT EXISTS (SELECT 1 FROM club_confirmation_reminders r
		                  WHERE r.club_id = c.id AND r.confirmed_at = c.confirmed_at)
		ORDER BY c.confirmed_at, c.id
		LIMIT $2
		FOR UPDATE OF c SKIP LOCKED
	`, cutoff, reminderBatchSize)
	if err != nil {
		return 0, fmt.Errorf("find lapsed clubs: %w", err)
	}
	clubs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (lapsed, error) {
		var club lapsed
		err := row.Scan(&club.id, &club.name, &club.slug, &club.confirmedAt)
		return club, err
	})
	if err != nil {
		return 0, fmt.Errorf("scan lapsed clubs: %w", err)
	}

	for _, club := range clubs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO club_confirmation_reminders (club_id, confirmed_at) VALUES ($1::uuid, $2)
			ON CONFLICT (club_id) DO UPDATE SET confirmed_at = EXCLUDED.confirmed_at, sent_at = NOW()
		`, club.id, club.confirmedAt); err != nil {
			return 0, fmt.Errorf("record club reminder: %w", err)
		}
		rows, err := tx.Query(ctx, `
			SELECT u.id::text, u.email::text
			FROM club_members m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND u.account_status = 'active'
			WHERE m.club_id = $1::uuid AND m.role = 'owner'
			ORDER BY u.id
		`, club.id)
		if err != nil {
			return 0, fmt.Errorf("list club owners: %w", err)
		}
		owners, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) ([2]string, error) {
			var owner [2]string
			err := row.Scan(&owner[0], &owner[1])
			return owner, err
		})
		if err != nil {
			return 0, fmt.Errorf("scan club owners: %w", err)
		}
		for _, owner := range owners {
			if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
				Kind:      emailoutbox.KindClubConfirmationDue,
				Recipient: owner[1],
				Payload:   ConfirmationDuePayload{ClubName: club.name, ClubSlug: club.slug},
				IdempotencyKey: fmt.Sprintf("%s:%s:%s:%d", emailoutbox.KindClubConfirmationDue, club.id, owner[0],
					club.confirmedAt.UnixMicro()),
			}); err != nil {
				return 0, fmt.Errorf("enqueue club reminder: %w", err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit club reminders: %w", err)
	}
	return len(clubs), nil
}

// StartConfirmationReminders queues reminders immediately and then on every
// tick until ctx is cancelled. It blocks, so callers run it in its own
// goroutine.
func (r *PostgresRepository) StartConfirmationReminders(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	if interval <= 0 {
		interval = DefaultReminderInterval
	}
	if logger == nil {
		logger = slog.Default()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		reminded, err := r.QueueConfirmationReminders(ctx)
		if err != nil {
			logger.Error("club confirmation reminders failed", "error", err)
		} else if reminded > 0 {
			logger.Info("club confirmation reminders", "clubs", reminded)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
