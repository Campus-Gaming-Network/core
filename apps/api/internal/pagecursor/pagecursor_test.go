package pagecursor

import (
	"encoding/base64"
	"errors"
	"strings"
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

func TestKeyCursorRoundTrip(t *testing.T) {
	want := KeyCursor{Key: "0jos\u00e9 \"the <wall>\" o'neil \u65e5\u672c", ID: "22222222-2222-2222-2222-222222222222"}

	got, err := DecodeKey(EncodeKey(want.Key, want.ID))
	if err != nil {
		t.Fatalf("DecodeKey(EncodeKey()) error = %v", err)
	}
	if got != want {
		t.Fatalf("DecodeKey(EncodeKey()) = %#v, want %#v", got, want)
	}
}

// A name is at most 120 bytes and lowercasing can add a byte for some
// characters. Control characters are the worst case for JSON escaping.
func TestKeyCursorOfALongestNameStaysDecodable(t *testing.T) {
	key := strings.Repeat("\u0001", 120) + strings.Repeat("\u0130", 30)
	id := "22222222-2222-2222-2222-222222222222"

	got, err := DecodeKey(EncodeKey(key, id))
	if err != nil || got.Key != key {
		t.Fatalf("DecodeKey(EncodeKey()) = %#v, %v; want the original key", got, err)
	}
}

func TestDecodeKeyRejectsMalformedCursors(t *testing.T) {
	timestampCursor := Encode(time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC), "22222222-2222-2222-2222-222222222222")
	for name, encoded := range map[string]string{
		"empty":              "",
		"not base64":         "not-base64!",
		"timestamp cursor":   timestampCursor,
		"wrong version":      base64Value(`{"v":2,"k":"YWxpY2U","id":"22222222-2222-2222-2222-222222222222"}`),
		"empty key":          base64Value(`{"v":1,"k":"","id":"22222222-2222-2222-2222-222222222222"}`),
		"missing key":        base64Value(`{"v":1,"id":"22222222-2222-2222-2222-222222222222"}`),
		"key is not base64":  base64Value(`{"v":1,"k":"***","id":"22222222-2222-2222-2222-222222222222"}`),
		"key is not text":    base64Value(`{"v":1,"k":"/w","id":"22222222-2222-2222-2222-222222222222"}`),
		"bad id":             base64Value(`{"v":1,"k":"YWxpY2U","id":"not-a-uuid"}`),
		"unknown field":      base64Value(`{"v":1,"k":"YWxpY2U","id":"22222222-2222-2222-2222-222222222222","extra":true}`),
		"trailing data":      base64Value(`{"v":1,"k":"YWxpY2U","id":"22222222-2222-2222-2222-222222222222"}{}`),
		"too long to decode": strings.Repeat("A", 513),
	} {
		if _, err := DecodeKey(encoded); !errors.Is(err, ErrInvalid) {
			t.Fatalf("DecodeKey(%s) error = %v, want ErrInvalid", name, err)
		}
	}
}

func TestDecodeRejectsKeyCursors(t *testing.T) {
	if _, err := Decode(EncodeKey("alice", "22222222-2222-2222-2222-222222222222")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Decode(key cursor) error = %v, want ErrInvalid", err)
	}
}

func base64Value(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}
