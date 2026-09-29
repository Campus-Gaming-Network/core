// Package ratelimit provides in-process request limiters.
package ratelimit

import (
	"sync"
	"time"
)

// Limiter is a small fixed-window limiter for sensitive API actions. It is
// intentionally process-local; a shared limiter must replace this boundary
// before the API is deployed across multiple instances, because each instance
// otherwise enforces its own independent quota.
type Limiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	now       func() time.Time
	entries   map[string]entry
	lastSweep time.Time
}

type entry struct {
	started time.Time
	count   int
}

func New(limit int, window time.Duration) *Limiter {
	return NewWithClock(limit, window, time.Now)
}

// NewWithClock lets tests cross window boundaries without sleeping.
func NewWithClock(limit int, window time.Duration, now func() time.Time) *Limiter {
	if limit < 1 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &Limiter{
		limit:     limit,
		window:    window,
		now:       now,
		entries:   make(map[string]entry),
		lastSweep: now(),
	}
}

func (l *Limiter) Allow(key string) bool {
	allowed, _ := l.Take(key)
	return allowed
}

// Take counts one attempt against key. When the window is already exhausted
// it returns false and how long remains until the window resets.
func (l *Limiter) Take(key string) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	l.sweepLocked(now)

	current, ok := l.entries[key]
	if !ok || now.Sub(current.started) >= l.window {
		l.entries[key] = entry{started: now, count: 1}
		return true, 0
	}
	if current.count >= l.limit {
		return false, current.started.Add(l.window).Sub(now)
	}
	current.count++
	l.entries[key] = current
	return true, 0
}

// Blocked reports whether key has no attempts left in its current window
// without counting an attempt. Callers that only count failures use it to
// refuse work before the failure-producing operation runs.
func (l *Limiter) Blocked(key string) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	current, ok := l.entries[key]
	if !ok || now.Sub(current.started) >= l.window || current.count < l.limit {
		return false, 0
	}
	return true, current.started.Add(l.window).Sub(now)
}

// sweepLocked drops entries whose window has closed. Without it the map retains
// every key it has ever seen for the life of the process, and the keys include
// per-user and per-IP identifiers, so it grows with unique visitors rather than
// with concurrent load.
//
// Runs at most once per window, so the O(n) walk is amortized across the
// requests that arrive during it. The caller must hold l.mu.
func (l *Limiter) sweepLocked(now time.Time) {
	if now.Sub(l.lastSweep) < l.window {
		return
	}
	l.lastSweep = now

	for key, value := range l.entries {
		if now.Sub(value.started) >= l.window {
			delete(l.entries, key)
		}
	}
}

// Size reports how many windows are currently tracked. Exported for tests and
// for anything that wants to observe limiter growth.
func (l *Limiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}
