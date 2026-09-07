package emailoutbox

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type claimCall struct {
	limit    int
	lease    time.Duration
	workerID string
}

type failedDelivery struct {
	message  Message
	next     time.Time
	terminal bool
	detail   string
}

type deliveredMessage struct {
	message    Message
	providerID string
}

type recordingStore struct {
	mu sync.Mutex

	messages  []Message
	claims    []claimCall
	failed    []failedDelivery
	delivered []deliveredMessage
}

func (s *recordingStore) Claim(_ context.Context, limit int, lease time.Duration, workerID string) ([]Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.claims = append(s.claims, claimCall{limit: limit, lease: lease, workerID: workerID})
	if limit > len(s.messages) {
		limit = len(s.messages)
	}
	claimed := append([]Message(nil), s.messages[:limit]...)
	s.messages = s.messages[limit:]
	for index := range claimed {
		claimed[index].LockedBy = workerID
	}
	return claimed, nil
}

func (s *recordingStore) MarkDelivered(_ context.Context, message Message, providerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.delivered = append(s.delivered, deliveredMessage{message: message, providerID: providerID})
	return nil
}

func (s *recordingStore) MarkFailed(_ context.Context, message Message, next time.Time, terminal bool, detail string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.failed = append(s.failed, failedDelivery{
		message:  message,
		next:     next,
		terminal: terminal,
		detail:   detail,
	})
	return nil
}

type dispatcherFunc func(context.Context, Message) (string, error)

func (f dispatcherFunc) Send(ctx context.Context, message Message) (string, error) {
	return f(ctx, message)
}

func TestWorkerRunOnceSchedulesRetriesAndQuarantinesPoisonMessages(t *testing.T) {
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name         string
		attempts     int
		dispatchErr  error
		maxAttempts  int
		wantDelay    time.Duration
		wantTerminal bool
	}{
		{
			name:        "first transient failure",
			dispatchErr: errors.New("provider unavailable"),
			maxAttempts: 4,
			wantDelay:   time.Minute,
		},
		{
			name:         "permanent provider rejection",
			dispatchErr:  Permanent(errors.New("recipient rejected")),
			maxAttempts:  4,
			wantDelay:    time.Minute,
			wantTerminal: true,
		},
		{
			name:         "attempt budget exhausted",
			attempts:     3,
			dispatchErr:  errors.New("provider unavailable"),
			maxAttempts:  4,
			wantDelay:    8 * time.Minute,
			wantTerminal: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &recordingStore{messages: []Message{{
				ID:       "message-1",
				Attempts: tt.attempts,
			}}}
			worker := NewWorker(store, dispatcherFunc(func(context.Context, Message) (string, error) {
				return "", tt.dispatchErr
			}), nil)
			worker.MaxAttempts = tt.maxAttempts
			worker.WorkerID = "worker-under-test"
			worker.now = func() time.Time { return now }

			if err := worker.RunOnce(t.Context()); err != nil {
				t.Fatalf("RunOnce() error = %v", err)
			}
			if len(store.failed) != 1 {
				t.Fatalf("failed deliveries = %d, want 1", len(store.failed))
			}
			failure := store.failed[0]
			if got := failure.next.Sub(now); got != tt.wantDelay {
				t.Errorf("next retry delay = %v, want %v", got, tt.wantDelay)
			}
			if failure.terminal != tt.wantTerminal {
				t.Errorf("terminal = %v, want %v", failure.terminal, tt.wantTerminal)
			}
			if failure.detail != tt.dispatchErr.Error() {
				t.Errorf("failure detail = %q, want %q", failure.detail, tt.dispatchErr.Error())
			}
			if len(store.delivered) != 0 {
				t.Errorf("delivered messages = %d, want 0", len(store.delivered))
			}
			stats := worker.Stats()
			if stats.DeliveryFailures != 1 {
				t.Errorf("delivery failures = %d, want 1", stats.DeliveryFailures)
			}
			wantTerminalFailures := uint64(0)
			if tt.wantTerminal {
				wantTerminalFailures = 1
			}
			if stats.TerminalFailures != wantTerminalFailures {
				t.Errorf("terminal failures = %d, want %d", stats.TerminalFailures, wantTerminalFailures)
			}
		})
	}
}

func TestRetryDelayIsExponentialAndCapped(t *testing.T) {
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{attempt: 0, want: time.Minute},
		{attempt: 1, want: time.Minute},
		{attempt: 2, want: 2 * time.Minute},
		{attempt: 5, want: 16 * time.Minute},
		{attempt: 9, want: 256 * time.Minute},
		{attempt: 20, want: 256 * time.Minute},
	}

	for _, tt := range tests {
		if got := retryDelay(tt.attempt); got != tt.want {
			t.Errorf("retryDelay(%d) = %v, want %v", tt.attempt, got, tt.want)
		}
	}
}

func TestWorkerRunOnceBoundsDeliveryConcurrency(t *testing.T) {
	const concurrency = 3
	messages := make([]Message, 8)
	for index := range messages {
		messages[index].ID = string(rune('a' + index))
	}
	store := &recordingStore{messages: messages}

	var mu sync.Mutex
	active := 0
	maximumActive := 0
	dispatcher := dispatcherFunc(func(context.Context, Message) (string, error) {
		mu.Lock()
		active++
		if active > maximumActive {
			maximumActive = active
		}
		mu.Unlock()

		time.Sleep(15 * time.Millisecond)

		mu.Lock()
		active--
		mu.Unlock()
		return "provider-id", nil
	})
	worker := NewWorker(store, dispatcher, nil)
	worker.Concurrency = concurrency
	worker.WorkerID = "bounded-worker"

	for range 3 {
		if err := worker.RunOnce(t.Context()); err != nil {
			t.Fatalf("RunOnce() error = %v", err)
		}
	}

	if len(store.delivered) != len(messages) {
		t.Errorf("delivered messages = %d, want %d", len(store.delivered), len(messages))
	}
	if maximumActive > concurrency {
		t.Errorf("maximum concurrent deliveries = %d, want at most %d", maximumActive, concurrency)
	}
	if maximumActive < 2 {
		t.Errorf("maximum concurrent deliveries = %d, want worker to process messages concurrently", maximumActive)
	}
	for _, claim := range store.claims {
		if claim.limit != concurrency {
			t.Errorf("claim limit = %d, want %d", claim.limit, concurrency)
		}
	}
}

func TestWorkerRunOnceGivesEveryMessageADeadline(t *testing.T) {
	const messageTimeout = 25 * time.Millisecond
	store := &recordingStore{messages: []Message{
		{ID: "message-1"},
		{ID: "message-2"},
	}}

	var mu sync.Mutex
	deadlines := make([]time.Time, 0, 2)
	dispatcher := dispatcherFunc(func(ctx context.Context, _ Message) (string, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			return "", errors.New("message context has no deadline")
		}
		mu.Lock()
		deadlines = append(deadlines, deadline)
		mu.Unlock()
		<-ctx.Done()
		return "", ctx.Err()
	})
	worker := NewWorker(store, dispatcher, nil)
	worker.Concurrency = 2
	worker.MessageTimeout = messageTimeout

	startedAt := time.Now()
	if err := worker.RunOnce(t.Context()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 10*messageTimeout {
		t.Errorf("RunOnce() duration = %v, want bounded by per-message deadlines", elapsed)
	}
	if len(deadlines) != 2 {
		t.Fatalf("dispatcher deadlines = %d, want 2", len(deadlines))
	}
	if len(store.failed) != 2 {
		t.Fatalf("failed deliveries = %d, want 2", len(store.failed))
	}
	for _, failure := range store.failed {
		if failure.detail != context.DeadlineExceeded.Error() {
			t.Errorf("failure detail = %q, want %q", failure.detail, context.DeadlineExceeded)
		}
	}
}

func TestWorkerForwardsDurableIdempotencyKey(t *testing.T) {
	message := Message{
		ID:             "message-1",
		Kind:           KindRSVPConfirmation,
		Recipient:      "player@example.com",
		IdempotencyKey: "rsvp:event-1:user-1:yes",
	}
	store := &recordingStore{messages: []Message{message}}
	var dispatched Message
	worker := NewWorker(store, dispatcherFunc(func(_ context.Context, message Message) (string, error) {
		dispatched = message
		return "provider-message-1", nil
	}), nil)
	worker.WorkerID = "idempotency-worker"

	if err := worker.RunOnce(t.Context()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if dispatched.IdempotencyKey != message.IdempotencyKey {
		t.Errorf("dispatched idempotency key = %q, want %q", dispatched.IdempotencyKey, message.IdempotencyKey)
	}
	if len(store.delivered) != 1 {
		t.Fatalf("delivered messages = %d, want 1", len(store.delivered))
	}
	if store.delivered[0].providerID != "provider-message-1" {
		t.Errorf("provider ID = %q, want provider-message-1", store.delivered[0].providerID)
	}
}

type leasedMessageStore struct {
	mu sync.Mutex

	now       time.Time
	message   Message
	lockedAt  time.Time
	delivered bool
}

func (s *leasedMessageStore) Claim(_ context.Context, limit int, lease time.Duration, workerID string) ([]Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if limit < 1 || s.delivered {
		return nil, nil
	}
	if s.message.LockedBy != "" && !s.lockedAt.Before(s.now.Add(-lease)) {
		return nil, nil
	}
	s.message.LockedBy = workerID
	s.lockedAt = s.now
	return []Message{s.message}, nil
}

func (s *leasedMessageStore) MarkDelivered(_ context.Context, message Message, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if message.LockedBy != s.message.LockedBy {
		return errors.New("email outbox lease lost")
	}
	s.delivered = true
	s.message.LockedBy = ""
	return nil
}

func (s *leasedMessageStore) MarkFailed(context.Context, Message, time.Time, bool, string) error {
	return nil
}

func TestReplacementWorkerReclaimsAnAbandonedLease(t *testing.T) {
	lease := 2 * time.Minute
	store := &leasedMessageStore{
		now: time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC),
		message: Message{
			ID:             "message-1",
			IdempotencyKey: "verification:user-1:token-1",
		},
	}

	claimed, err := store.Claim(t.Context(), 1, lease, "worker-that-stopped")
	if err != nil {
		t.Fatalf("initial Claim() error = %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("initial Claim() messages = %d, want 1", len(claimed))
	}

	dispatches := 0
	worker := NewWorker(store, dispatcherFunc(func(context.Context, Message) (string, error) {
		dispatches++
		return "provider-message-1", nil
	}), nil)
	worker.WorkerID = "replacement-worker"
	worker.LeaseDuration = lease

	store.now = store.now.Add(lease)
	if err := worker.RunOnce(t.Context()); err != nil {
		t.Fatalf("RunOnce() at lease boundary error = %v", err)
	}
	if dispatches != 0 {
		t.Fatalf("dispatches at lease boundary = %d, want 0", dispatches)
	}

	store.now = store.now.Add(time.Nanosecond)
	if err := worker.RunOnce(t.Context()); err != nil {
		t.Fatalf("RunOnce() after lease expiry error = %v", err)
	}
	if dispatches != 1 {
		t.Fatalf("dispatches after lease expiry = %d, want 1", dispatches)
	}
	if !store.delivered {
		t.Fatal("message was not marked delivered by replacement worker")
	}
}
