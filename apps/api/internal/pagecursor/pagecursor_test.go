package pagecursor

import (
	"encoding/base64"
	"errors"
	"testing"
	"time"
)

func TestRoundTrip(t *testing.T) {
	timestamp := time.Date(2026, time.September, 5, 12, 34, 56, 789, time.FixedZone("test", -7*60*60))
	id := "22222222-2222-2222-2222-222222222222"

	decoded, err := Decode(Encode(timestamp, id))
	if err != nil {
		t.Fatalf("Decode(Encode()) error = %v", err)
	}
	if !decoded.Timestamp.Equal(timestamp) || decoded.ID != id {
		t.Fatalf("Decode(Encode()) = %#v, want %s and %q", decoded, timestamp, id)
	}
}

func TestDecodeRejectsMalformedCursors(t *testing.T) {
	for _, encoded := range []string{
		"",
		"not-base64!",
		base64Value(`{"v":2,"t":"2026-09-05T12:00:00Z","id":"22222222-2222-2222-2222-222222222222"}`),
		base64Value(`{"v":1,"t":"tomorrow","id":"22222222-2222-2222-2222-222222222222"}`),
		base64Value(`{"v":1,"t":"2026-09-05T12:00:00Z","id":"not-a-uuid"}`),
		base64Value(`{"v":1,"t":"2026-09-05T12:00:00Z","id":"22222222-2222-2222-2222-222222222222","extra":true}`),
	} {
		if _, err := Decode(encoded); !errors.Is(err, ErrInvalid) {
			t.Fatalf("Decode(%q) error = %v, want ErrInvalid", encoded, err)
		}
	}
}

func base64Value(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}
