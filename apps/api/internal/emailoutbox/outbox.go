// Package emailoutbox persists and delivers email intent outside request paths.
package emailoutbox

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	KindAccountVerification = "account_verification"
	KindPasswordReset       = "password_reset"
	KindRSVPConfirmation    = "event_rsvp_confirmation"
	KindEventCancellation   = "event_cancellation"
)

const (
	DefaultPollInterval   = 2 * time.Second
	DefaultConcurrency    = 4
	DefaultMessageTimeout = 10 * time.Second
	DefaultLeaseDuration  = 2 * time.Minute
	DefaultMaxAttempts    = 8
)

type Intent struct {
	Kind           string
	Recipient      string
	Payload        any
	IdempotencyKey string
}

type Message struct {
	ID             string
	Kind           string
	Recipient      string
	Payload        json.RawMessage
	IdempotencyKey string
	Attempts       int
	LockedBy       string
}

func TokenKey(kind string, tokenHash []byte) string {
	return kind + ":" + base64.RawURLEncoding.EncodeToString(tokenHash)
}

type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// Enqueue inserts an intent on the caller's transaction. A repeated durable
// key is a no-op, which makes application and worker retries safe.
func Enqueue(ctx context.Context, db execer, intent Intent) error {
	payload, err := json.Marshal(intent.Payload)
	if err != nil {
		return fmt.Errorf("encode email outbox payload: %w", err)
	}
	if strings.TrimSpace(intent.Kind) == "" || strings.TrimSpace(intent.Recipient) == "" || strings.TrimSpace(intent.IdempotencyKey) == "" {
		return errors.New("email outbox kind, recipient, and idempotency key are required")
	}
	_, err = db.Exec(ctx, `
		INSERT INTO email_outbox (kind, recipient, payload, idempotency_key)
		VALUES ($1, $2, $3::jsonb, $4)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, intent.Kind, strings.TrimSpace(intent.Recipient), payload, intent.IdempotencyKey)
	if err != nil {
		return fmt.Errorf("enqueue email: %w", err)
	}
	return nil
}

type Store interface {
	Claim(context.Context, int, time.Duration, string) ([]Message, error)
	MarkDelivered(context.Context, Message, string) error
	MarkFailed(context.Context, Message, time.Time, bool, string) error
}

type PostgresStore struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool, now: time.Now}
}

func (s *PostgresStore) Claim(ctx context.Context, limit int, lease time.Duration, workerID string) ([]Message, error) {
	if limit < 1 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		WITH candidates AS (
			SELECT id
			FROM email_outbox
			WHERE delivered_at IS NULL
			  AND failed_at IS NULL
			  AND next_attempt_at <= $1
			  AND (locked_at IS NULL OR locked_at < $1 - ($2 * INTERVAL '1 second'))
			ORDER BY next_attempt_at, created_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT $3
		)
		UPDATE email_outbox o
		SET locked_at = $1, locked_by = $4
		FROM candidates c
		WHERE o.id = c.id
		RETURNING o.id::text, o.kind, o.recipient, o.payload,
		          o.idempotency_key, o.attempts, o.locked_by
	`, s.now(), lease.Seconds(), limit, workerID)
	if err != nil {
		return nil, fmt.Errorf("claim email outbox: %w", err)
	}
	defer rows.Close()
	messages := make([]Message, 0, limit)
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.Kind, &message.Recipient, &message.Payload, &message.IdempotencyKey, &message.Attempts, &message.LockedBy); err != nil {
			return nil, fmt.Errorf("scan email outbox: %w", err)
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate email outbox: %w", err)
	}
	return messages, nil
}

func (s *PostgresStore) MarkDelivered(ctx context.Context, message Message, providerID string) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE email_outbox
		SET delivered_at = $3, provider_message_id = NULLIF($4, ''),
		    attempts = attempts + 1, locked_at = NULL, locked_by = NULL,
		    last_error = NULL, payload = '{}'::jsonb
		WHERE id = $1::uuid AND locked_by = $2
		  AND delivered_at IS NULL AND failed_at IS NULL
	`, message.ID, message.LockedBy, s.now(), providerID)
	if err != nil {
		return fmt.Errorf("mark email delivered: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("email outbox lease lost")
	}
	return nil
}

func (s *PostgresStore) MarkFailed(ctx context.Context, message Message, next time.Time, terminal bool, detail string) error {
	if len(detail) > 2000 {
		detail = detail[:2000]
	}
	command, err := s.pool.Exec(ctx, `
		UPDATE email_outbox
		SET attempts = attempts + 1,
		    next_attempt_at = $3,
		    failed_at = CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,
		    last_error = $6,
		    payload = CASE WHEN $4 THEN '{}'::jsonb ELSE payload END,
		    locked_at = NULL,
		    locked_by = NULL
		WHERE id = $1::uuid AND locked_by = $2
		  AND delivered_at IS NULL AND failed_at IS NULL
	`, message.ID, message.LockedBy, next, terminal, s.now(), detail)
	if err != nil {
		return fmt.Errorf("mark email failed: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("email outbox lease lost")
	}
	return nil
}

type Dispatcher interface {
	Send(context.Context, Message) (string, error)
}

type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err: err}
}

func IsPermanent(err error) bool {
	var target permanentError
	return errors.As(err, &target)
}

type Worker struct {
	Store          Store
	Dispatcher     Dispatcher
	Logger         *slog.Logger
	PollInterval   time.Duration
	Concurrency    int
	MessageTimeout time.Duration
	LeaseDuration  time.Duration
	MaxAttempts    int
	WorkerID       string
	now            func() time.Time
	failures       atomic.Uint64
	terminal       atomic.Uint64
}

type WorkerStats struct {
	DeliveryFailures uint64
	TerminalFailures uint64
}

func NewWorker(store Store, dispatcher Dispatcher, logger *slog.Logger) *Worker {
	return &Worker{
		Store: store, Dispatcher: dispatcher, Logger: logger,
		PollInterval: DefaultPollInterval, Concurrency: DefaultConcurrency,
		MessageTimeout: DefaultMessageTimeout, LeaseDuration: DefaultLeaseDuration,
		MaxAttempts: DefaultMaxAttempts, WorkerID: fmt.Sprintf("worker-%d", time.Now().UnixNano()),
		now: time.Now,
	}
}

func (w *Worker) Start(ctx context.Context) {
	if err := w.RunOnce(ctx); err != nil {
		w.logRunError()
	}
	interval := w.PollInterval
	if interval <= 0 {
		interval = DefaultPollInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.RunOnce(ctx); err != nil {
				w.logRunError()
			}
		}
	}
}

func (w *Worker) RunOnce(ctx context.Context) error {
	concurrency := w.Concurrency
	if concurrency < 1 {
		concurrency = DefaultConcurrency
	}
	messages, err := w.Store.Claim(ctx, concurrency, w.leaseDuration(), w.WorkerID)
	if err != nil {
		return err
	}
	var wait sync.WaitGroup
	errs := make(chan error, len(messages))
	for _, message := range messages {
		message := message
		wait.Add(1)
		go func() {
			defer wait.Done()
			if err := w.deliver(ctx, message); err != nil {
				errs <- err
			}
		}()
	}
	wait.Wait()
	close(errs)
	return errors.Join(channelErrors(errs)...)
}

func (w *Worker) deliver(parent context.Context, message Message) error {
	timeout := w.MessageTimeout
	if timeout <= 0 {
		timeout = DefaultMessageTimeout
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	providerID, err := w.Dispatcher.Send(ctx, message)
	if err == nil {
		if err := w.Store.MarkDelivered(parent, message, providerID); err != nil {
			return err
		}
		return nil
	}

	attempt := message.Attempts + 1
	terminal := IsPermanent(err) || attempt >= w.maxAttempts()
	next := w.now().Add(retryDelay(attempt))
	if markErr := w.Store.MarkFailed(parent, message, next, terminal, err.Error()); markErr != nil {
		return errors.Join(err, markErr)
	}
	failureCount := w.failures.Add(1)
	terminalCount := w.terminal.Load()
	if terminal {
		terminalCount = w.terminal.Add(1)
	}
	if w.Logger != nil {
		w.Logger.Warn("email outbox delivery failed",
			"outbox_id", message.ID,
			"kind", message.Kind,
			"attempt", attempt,
			"terminal", terminal,
			"delivery_failures", failureCount,
			"terminal_failures", terminalCount,
		)
	}
	return nil
}

func (w *Worker) Stats() WorkerStats {
	return WorkerStats{
		DeliveryFailures: w.failures.Load(),
		TerminalFailures: w.terminal.Load(),
	}
}

func (w *Worker) maxAttempts() int {
	if w.MaxAttempts < 1 {
		return DefaultMaxAttempts
	}
	return w.MaxAttempts
}

func (w *Worker) leaseDuration() time.Duration {
	if w.LeaseDuration <= 0 {
		return DefaultLeaseDuration
	}
	return w.LeaseDuration
}

func (w *Worker) logRunError() {
	if w.Logger != nil {
		// The error itself can contain a provider response. Do not put it in logs;
		// delivery details remain bounded in the row for operator inspection.
		w.Logger.Error("email outbox worker failed")
	}
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	shift := attempt - 1
	if shift > 8 {
		shift = 8
	}
	return time.Minute * time.Duration(1<<shift)
}

func channelErrors(errorsChannel <-chan error) []error {
	var result []error
	for err := range errorsChannel {
		result = append(result, err)
	}
	return result
}
