// Package pagecursor encodes and validates opaque cursors for keyset pagination.
//
// A list is paged either by a timestamp (Cursor) or by a text sort key
// (KeyCursor), such as a person's lowercased name. The two encodings reject
// each other, so a cursor from one kind of list never pages another.
package pagecursor

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"time"
	"unicode/utf8"
)

const (
	version = 1

	// maximumEncodedLength bounds a cursor before it is decoded, which also
	// bounds the text sort key inside a KeyCursor.
	maximumEncodedLength = 512
)

var ErrInvalid = errors.New("invalid pagination cursor")

type Cursor struct {
	Timestamp time.Time
	ID        string
}

// KeyCursor is a position in a list ordered by a text sort key, then by ID.
type KeyCursor struct {
	Key string
	ID  string
}

type payload struct {
	Version   int    `json:"v"`
	Timestamp string `json:"t"`
	ID        string `json:"id"`
}

// keyPayload carries the key as bytes, which JSON encodes as base64, so a
// name full of characters that JSON escapes cannot grow the cursor past its
// length limit.
type keyPayload struct {
	Version int    `json:"v"`
	Key     []byte `json:"k"`
	ID      string `json:"id"`
}

func Encode(timestamp time.Time, id string) string {
	encoded, _ := json.Marshal(payload{
		Version:   version,
		Timestamp: timestamp.UTC().Format(time.RFC3339Nano),
		ID:        id,
	})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

// EncodeKey encodes a position in a list ordered by key, then id. The key is
// the exact value the list sorts by, as the database computed it.
func EncodeKey(key string, id string) string {
	encoded, _ := json.Marshal(keyPayload{Version: version, Key: []byte(key), ID: id})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func Decode(encoded string) (Cursor, error) {
	var value payload
	if err := decodePayload(encoded, &value); err != nil {
		return Cursor{}, err
	}
	if value.Version != version || !isUUID(value.ID) {
		return Cursor{}, ErrInvalid
	}

	timestamp, err := time.Parse(time.RFC3339Nano, value.Timestamp)
	if err != nil {
		return Cursor{}, ErrInvalid
	}

	return Cursor{Timestamp: timestamp.UTC(), ID: value.ID}, nil
}

// DecodeKey decodes a cursor made by EncodeKey. A timestamp cursor is invalid
// here.
func DecodeKey(encoded string) (KeyCursor, error) {
	var value keyPayload
	if err := decodePayload(encoded, &value); err != nil {
		return KeyCursor{}, err
	}
	key := string(value.Key)
	if value.Version != version || !isUUID(value.ID) || key == "" || !utf8.ValidString(key) {
		return KeyCursor{}, ErrInvalid
	}

	return KeyCursor{Key: key, ID: value.ID}, nil
}

// decodePayload strictly decodes one JSON object from an encoded cursor: no
// unknown fields and nothing after the object.
func decodePayload(encoded string, destination any) error {
	if encoded == "" || len(encoded) > maximumEncodedLength {
		return ErrInvalid
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return ErrInvalid
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return ErrInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return ErrInvalid
	}
	return nil
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') ||
			(character >= 'a' && character <= 'f') ||
			(character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}
