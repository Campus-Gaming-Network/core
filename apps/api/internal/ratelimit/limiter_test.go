package ratelimit

import (
	"fmt"
	"testing"
	"time"
)

type testClock struct{ now time.Time }

func (clock *testClock) Now() time.Time { return clock.now }

func newTestClock() *testClock {
	return &testClock{now: time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)}
}

func TestLimiterAllowsUpToLimitWithinWindow(t *testing.T) {
	limiter := New(2, time.Hour)

	if !limiter.Allow("key") || !limiter.Allow("key") {
		t.Fatal("limiter rejected requests within the limit")
	}
	if limiter.Allow("key") {
		t.Fatal("limiter allowed a request past the limit")
	}
}

func TestLimiterTracksKeysIndependently(t *testing.T) {
	limiter := New(1, time.Hour)

	if !limiter.Allow("first") {
		t.Fatal("limiter rejected the first key")
	}
	if !limiter.Allow("second") {
		t.Fatal("one key's limit consumed another key's budget")
	}
}

func TestLimiterReportsRetryAfterAndResetsAtWindowBoundary(t *testing.T) {
	clock := newTestClock()
	limiter := NewWithClock(1, time.Minute, clock.Now)

	if allowed, _ := limiter.Take("key"); !allowed {
		t.Fatal("limiter rejected the first request")
	}
	clock.now = clock.now.Add(20 * time.Second)
	if allowed, retryAfter := limiter.Take("key"); allowed || retryAfter != 40*time.Second {
		t.Fatalf("over-limit take = %t %s, want false 40s", allowed, retryAfter)
	}
	clock.now = clock.now.Add(40*time.Second - time.Nanosecond)
	if allowed, retryAfter := limiter.Take("key"); allowed || retryAfter != time.Nanosecond {
		t.Fatalf("take before reset = %t %s, want false 1ns", allowed, retryAfter)
	}
	clock.now = clock.now.Add(time.Nanosecond)
	if allowed, _ := limiter.Take("key"); !allowed {
		t.Fatal("limiter did not reset at the window boundary")
	}
}

func TestLimiterBlockedDoesNotCountAttempts(t *testing.T) {
	clock := newTestClock()
	limiter := NewWithClock(2, time.Minute, clock.Now)

	for range 3 {
		if blocked, _ := limiter.Blocked("key"); blocked {
			t.Fatal("an untouched key was reported as blocked")
		}
	}
	limiter.Take("key")
	limiter.Take("key")
	clock.now = clock.now.Add(15 * time.Second)
	if blocked, retryAfter := limiter.Blocked("key"); !blocked || retryAfter != 45*time.Second {
		t.Fatalf("exhausted key = %t %s, want true 45s", blocked, retryAfter)
	}
}

// Keys include per-user and per-IP identifiers, so without a sweep the map
// grows with unique visitors and never shrinks for the life of the process.
func TestLimiterDropsExpiredEntries(t *testing.T) {
	clock := newTestClock()
	limiter := NewWithClock(5, 10*time.Millisecond, clock.Now)

	for i := 0; i < 500; i++ {
		limiter.Allow(fmt.Sprintf("key-%d", i))
	}
	if got := limiter.Size(); got != 500 {
		t.Fatalf("Size() = %d, want 500 tracked windows", got)
	}

	clock.now = clock.now.Add(20 * time.Millisecond)

	// The sweep runs on the next call, which then records its own key.
	limiter.Allow("trigger")

	if got := limiter.Size(); got != 1 {
		t.Fatalf("Size() = %d, want only the surviving key after the sweep", got)
	}
}

func TestLimiterSweepKeepsLiveWindows(t *testing.T) {
	limiter := New(5, time.Hour)

	limiter.Allow("live")
	limiter.Allow("also-live")

	if got := limiter.Size(); got != 2 {
		t.Fatalf("Size() = %d, want 2", got)
	}
	if !limiter.Allow("live") {
		t.Fatal("a live window was dropped by the sweep")
	}
}
