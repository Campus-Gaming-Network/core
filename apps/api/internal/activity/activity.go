// Package activity records the UTC days on which each signed-in account uses
// the site, for active-user counts and retention.
package activity

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store writes activity days.
type Store interface {
	// RecordDay notes that userID was active on day, a UTC date in
	// YYYY-MM-DD form. Recording the same day again is a no-op.
	RecordDay(ctx context.Context, userID string, day string) error
}

// Recorder writes an account's day once per process and skips the write for
// the rest of that day. Several processes each write once; the store ignores
// the repeats.
type Recorder struct {
	store  Store
	logger *slog.Logger
	now    func() time.Time

	mu   sync.Mutex
	day  string
	seen map[string]struct{}
}

// NewRecorder returns a recorder that writes to store.
func NewRecorder(store Store, logger *slog.Logger) *Recorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &Recorder{store: store, logger: logger, now: time.Now}
}

// Record notes that userID is active today. A failed write is logged and
// retried on the account's next request; it never fails the request.
func (r *Recorder) Record(ctx context.Context, userID string) {
	day := r.now().UTC().Format(time.DateOnly)

	r.mu.Lock()
	// A new day starts an empty set, so the cache holds at most one day of
	// accounts.
	if r.day != day {
		r.day = day
		r.seen = map[string]struct{}{}
	}
	_, recorded := r.seen[userID]
	r.mu.Unlock()
	if recorded {
		return
	}

	// A client that disconnects mid-request was still active.
	if err := r.store.RecordDay(context.WithoutCancel(ctx), userID, day); err != nil {
		r.logger.Error("record activity day", "error", err)
		return
	}

	r.mu.Lock()
	if r.day == day {
		r.seen[userID] = struct{}{}
	}
	r.mu.Unlock()
}

// Middleware records the day for each request that carries a signed-in
// account. It runs after auth.WithSession.
func Middleware(recorder *Recorder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if userID, ok := auth.UserID(req.Context()); ok {
				recorder.Record(req.Context(), userID)
			}
			next.ServeHTTP(w, req)
		})
	}
}

// PostgresStore writes activity days to Postgres.
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewPostgresStore returns a store backed by pool.
func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

// RecordDay writes nothing for a deleted or suspended account. The share lock
// waits out an account deletion in progress, which holds the user row, so its
// cleanup can never miss a row written here.
func (s *PostgresStore) RecordDay(ctx context.Context, userID string, day string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_activity_days (user_id, day)
		SELECT id, $2::date FROM users
		WHERE id = $1::uuid AND account_status = 'active' AND deleted_at IS NULL
		FOR SHARE
		ON CONFLICT DO NOTHING
	`, userID, day)
	return err
}
