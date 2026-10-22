package pagecursor

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

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

func TestTimestampCursorRoundTripsInUTC(t *testing.T) {
	zone := time.FixedZone("offset", -7*60*60)
	timestamp := time.Date(2026, 3, 4, 5, 6, 7, 123456789, zone)
	id := "0198f1c2-7a3b-7c11-8d2e-1234567890ab"

	got, err := Decode(Encode(timestamp, id))
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if want := (Cursor{Timestamp: timestamp.UTC(), ID: id}); got != want {
		t.Errorf("Decode() = %+v, want %+v", got, want)
	}
}

func TestDecodeRejectsTamperedAndOutOfBoundsPayloads(t *testing.T) {
	const id = "0198f1c2-7a3b-7c11-8d2e-1234567890ab"
	raw := func(text string) string { return base64.RawURLEncoding.EncodeToString([]byte(text)) }
	tests := map[string]string{
		"future version":      raw(`{"v":2,"t":"2026-01-01T00:00:00Z","id":"` + id + `"}`),
		"missing version":     raw(`{"t":"2026-01-01T00:00:00Z","id":"` + id + `"}`),
		"unknown field":       raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"` + id + `","x":1}`),
		"trailing object":     raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"` + id + `"}{}`),
		"trailing garbage":    raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"` + id + `"} x`),
		"bad timestamp":       raw(`{"v":1,"t":"yesterday","id":"` + id + `"}`),
		"date only timestamp": raw(`{"v":1,"t":"2026-01-01","id":"` + id + `"}`),
		"id not hex":          raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"0198f1c2-7a3b-7c11-8d2e-123456789zzz"}`),
		"id misplaced dash":   raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"0198f1c27-a3b-7c11-8d2e-1234567890ab"}`),
		"id wrong length":     raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"0198f1c2-7a3b-7c11-8d2e-1234567890a"}`),
		"id sql injection":    raw(`{"v":1,"t":"2026-01-01T00:00:00Z","id":"' OR 1=1; --                         "}`),
		"json array":          raw(`[1,2,3]`),
		"standard alphabet":   "++//",
		"over length limit":   strings.Repeat("A", maximumEncodedLength+1),
		"null payload":        raw(`null`),
	}
	for name, encoded := range tests {
		if _, err := Decode(encoded); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: Decode() error = %v, want ErrInvalid", name, err)
		}
	}
}

func TestDecodeKeyRejectsEmptyAndNonUTF8Keys(t *testing.T) {
	const id = "0198f1c2-7a3b-7c11-8d2e-1234567890ab"
	tests := map[string]string{
		"empty key":    EncodeKey("", id),
		"invalid utf8": EncodeKey(string([]byte{0xff, 0xfe}), id),
	}
	for name, encoded := range tests {
		if _, err := DecodeKey(encoded); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: DecodeKey() error = %v, want ErrInvalid", name, err)
		}
	}
	if got, err := DecodeKey(EncodeKey("ünï", "0198F1C2-7A3B-7C11-8D2E-1234567890AB")); err != nil || got.Key != "ünï" {
		t.Errorf("DecodeKey(uppercase uuid) = %+v, %v", got, err)
	}
}
