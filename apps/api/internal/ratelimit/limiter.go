package ratelimit

import (
	"sync"
	"time"
)

// Limiter is a small fixed-window limiter for sensitive API actions. It is
// intentionally process-local for the MVP; a shared limiter can replace this
// boundary when the API is deployed across multiple instances.
type Limiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	entries map[string]entry
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
	return &Limiter{limit: limit, window: window, entries: make(map[string]entry)}
}

func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

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
