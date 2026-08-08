// Package maintenance removes rows that have aged out of usefulness.
//
// Sessions, verification tokens, reset tokens, and private event unlocks are
// all written on ordinary user activity and were never deleted, so each table
// grew without bound. Sessions in particular get a row per login and a
// multi-week TTL. Every query here is covered by an existing index.
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

// Result counts what a single pass removed.
type Result struct {
	Sessions           int64
	VerificationTokens int64
	ResetTokens        int64
	EventUnlocks       int64
}

func (r Result) Total() int64 {
	return r.Sessions + r.VerificationTokens + r.ResetTokens + r.EventUnlocks
}

// Run performs one pass. Deletes are independent, so a failure on one table
// still lets the others through; the first error is returned.
func (s *Sweeper) Run(ctx context.Context) (Result, error) {
	cutoff := s.now().Add(-retentionGrace)

	var result Result
	var firstErr error

	record := func(target *int64, label, statement string) {
		tag, err := s.pool.Exec(ctx, statement, cutoff)
		if err != nil {
			s.logger.Error("maintenance sweep failed", "error", err, "table", label)
			if firstErr == nil {
				firstErr = fmt.Errorf("sweep %s: %w", label, err)
			}
			return
		}
		*target = tag.RowsAffected()
	}

	record(&result.Sessions, "auth_sessions", `
		DELETE FROM auth_sessions
		WHERE expires_at < $1
		   OR revoked_at < $1
		   OR deleted_at < $1
	`)
	record(&result.VerificationTokens, "email_verification_tokens", `
		DELETE FROM email_verification_tokens
		WHERE expires_at < $1
		   OR consumed_at < $1
		   OR deleted_at < $1
	`)
	record(&result.ResetTokens, "password_reset_tokens", `
		DELETE FROM password_reset_tokens
		WHERE expires_at < $1
		   OR consumed_at < $1
		   OR deleted_at < $1
	`)
	record(&result.EventUnlocks, "event_private_unlocks", `
		DELETE FROM event_private_unlocks
		WHERE expires_at < $1
		   OR deleted_at < $1
	`)

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
			)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
