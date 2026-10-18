// Package maintenance removes rows that have aged out of usefulness.
//
// Sessions, verification and reset tokens, private event unlocks, event
// organizer invites, Admin Console sessions, and finished email outbox rows are written on ordinary
// activity and would otherwise grow without bound. Deletes run in bounded
// batches and never touch audit history.
package maintenance

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// retentionGrace keeps rows around briefly after they stop being valid, so a
// clock skew or an in-flight request cannot race the delete.
const retentionGrace = 24 * time.Hour

// outboxRetention is how long a delivered or permanently failed email_outbox
// row is kept for support lookups before its recipient address and payload are
// deleted. Pending and retrying rows are never touched.
const outboxRetention = 30 * 24 * time.Hour

// batchSize bounds each DELETE so a large backlog never holds long locks.
const batchSize = 1000

// DefaultInterval is how often the background sweeper runs.
const DefaultInterval = time.Hour

type Sweeper struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
	now    func() time.Time
}

func NewSweeper(pool *pgxpool.Pool, logger *slog.Logger) *Sweeper {
	if logger == nil {
		logger = slog.Default()
	}
	return &Sweeper{pool: pool, logger: logger, now: time.Now}
}

type Result struct {
	Sessions           int64
	VerificationTokens int64
	ResetTokens        int64
	EventUnlocks       int64
	OrganizerInvites   int64
	AdminSessions      int64
	EmailOutbox        int64
}

func (r Result) Total() int64 {
	return r.Sessions + r.VerificationTokens + r.ResetTokens + r.EventUnlocks +
		r.OrganizerInvites + r.AdminSessions + r.EmailOutbox
}

// purge is one table's cleanup. Its where clause takes the cutoff as $1 and
// may reference the table by its own name.
type purge struct {
	table  string
	where  string
	cutoff func(now time.Time) time.Time
	count  func(*Result) *int64
}

func graceCutoff(now time.Time) time.Time { return now.Add(-retentionGrace) }

// purges lists every automated cleanup. Audit logs, admin security events,
// support tickets, and reports are deliberately absent: the audit tables are
// append-only, and the ticket and report clocks wait on a legal-hold check
// (docs/16-legal-and-data-lifecycle-plan.md).
var purges = []purge{
	{
		table:  "auth_sessions",
		where:  "expires_at < $1 OR revoked_at < $1 OR deleted_at < $1",
		cutoff: graceCutoff,
		count:  func(r *Result) *int64 { return &r.Sessions },
	},
	{
		table:  "email_verification_tokens",
		where:  "expires_at < $1 OR consumed_at < $1 OR deleted_at < $1",
		cutoff: graceCutoff,
		count:  func(r *Result) *int64 { return &r.VerificationTokens },
	},
	{
		table:  "password_reset_tokens",
		where:  "expires_at < $1 OR consumed_at < $1 OR deleted_at < $1",
		cutoff: graceCutoff,
		count:  func(r *Result) *int64 { return &r.ResetTokens },
	},
	{
		table:  "event_private_unlocks",
		where:  "expires_at < $1 OR deleted_at < $1",
		cutoff: graceCutoff,
		count:  func(r *Result) *int64 { return &r.EventUnlocks },
	},
	{
		// An invite holds the address it was sent to, so it goes once it can no
		// longer be used.
		table:  "event_organizer_invites",
		where:  "expires_at < $1 OR accepted_at < $1 OR revoked_at < $1",
		cutoff: graceCutoff,
		count:  func(r *Result) *int64 { return &r.OrganizerInvites },
	},
	{
		// Sessions that audit_logs or admin_security_events still reference are
		// kept: deleting them would null the session link on append-only audit
		// history.
		table: "admin_sessions",
		where: `(LEAST(idle_expires_at, absolute_expires_at) < $1 OR revoked_at < $1)
			AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.admin_session_id = admin_sessions.id)
			AND NOT EXISTS (SELECT 1 FROM admin_security_events e WHERE e.admin_session_id = admin_sessions.id)`,
		cutoff: graceCutoff,
		count:  func(r *Result) *int64 { return &r.AdminSessions },
	},
	{
		table:  "email_outbox",
		where:  "delivered_at < $1 OR failed_at < $1",
		cutoff: func(now time.Time) time.Time { return now.Add(-outboxRetention) },
		count:  func(r *Result) *int64 { return &r.EmailOutbox },
	},
}

// Run performs one pass. Deletes are independent, so a failure on one table
// still lets the others through; the first error is returned. Each table is
// deleted in batches until a batch comes back short, so reruns are idempotent.
func (s *Sweeper) Run(ctx context.Context) (Result, error) {
	now := s.now()

	var result Result
	var firstErr error

	for _, p := range purges {
		statement := fmt.Sprintf(
			"DELETE FROM %[1]s WHERE id IN (SELECT id FROM %[1]s WHERE %[2]s ORDER BY id LIMIT %[3]d)",
			p.table, p.where, batchSize,
		)
		cutoff := p.cutoff(now)
		var deleted int64
		for {
			tag, err := s.pool.Exec(ctx, statement, cutoff)
			if err != nil {
				s.logger.Error("maintenance sweep failed", "error", err, "table", p.table)
				if firstErr == nil {
					firstErr = fmt.Errorf("sweep %s: %w", p.table, err)
				}
				break
			}
			deleted += tag.RowsAffected()
			if tag.RowsAffected() < batchSize {
				break
			}
		}
		*p.count(&result) = deleted
	}

	return result, firstErr
}

// Start runs a pass immediately and then on every tick until ctx is cancelled.
// It blocks, so callers should run it in its own goroutine.
func (s *Sweeper) Start(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultInterval
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		if result, err := s.Run(ctx); err == nil && result.Total() > 0 {
			s.logger.Info("maintenance sweep",
				"sessions", result.Sessions,
				"verification_tokens", result.VerificationTokens,
				"reset_tokens", result.ResetTokens,
				"event_unlocks", result.EventUnlocks,
				"admin_sessions", result.AdminSessions,
				"email_outbox", result.EmailOutbox,
			)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
