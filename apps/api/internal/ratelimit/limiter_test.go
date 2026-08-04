package ratelimit

import (
	"fmt"
	"testing"
	"time"
)

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

func TestLimiterResetsAfterWindow(t *testing.T) {
	limiter := New(1, time.Millisecond)

	if !limiter.Allow("key") {
		t.Fatal("limiter rejected the first request")
	}
	time.Sleep(2 * time.Millisecond)
	if !limiter.Allow("key") {
		t.Fatal("limiter did not reset after the window elapsed")
	}
}

// Keys include per-user and per-IP identifiers, so without a sweep the map
// grows with unique visitors and never shrinks for the life of the process.
func TestLimiterDropsExpiredEntries(t *testing.T) {
	limiter := New(5, 10*time.Millisecond)

	for i := 0; i < 500; i++ {
		limiter.Allow(fmt.Sprintf("key-%d", i))
	}
	if got := limiter.Size(); got != 500 {
		t.Fatalf("Size() = %d, want 500 tracked windows", got)
	}

	time.Sleep(20 * time.Millisecond)

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
