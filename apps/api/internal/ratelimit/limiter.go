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
	entries   map[string]entry
	lastSweep time.Time
}

type entry struct {
	started time.Time
	count   int
}

func New(limit int, window time.Duration) *Limiter {
	if limit < 1 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &Limiter{
		limit:     limit,
		window:    window,
		entries:   make(map[string]entry),
		lastSweep: time.Now(),
	}
}

func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	l.sweepLocked(now)

	current, ok := l.entries[key]
	if !ok || now.Sub(current.started) >= l.window {
		l.entries[key] = entry{started: now, count: 1}
		return true
	}
	if current.count >= l.limit {
		return false
	}
	current.count++
	l.entries[key] = current
	return true
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
