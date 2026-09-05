// Package pagecursor encodes and validates opaque cursors for keyset pagination.
package pagecursor

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
)

const version = 1

var ErrInvalid = errors.New("invalid pagination cursor")

type Cursor struct {
	Timestamp time.Time
	ID        string
}

type payload struct {
	Version   int    `json:"v"`
	Timestamp string `json:"t"`
	ID        string `json:"id"`
}

func Encode(timestamp time.Time, id string) string {
	encoded, _ := json.Marshal(payload{
		Version:   version,
		Timestamp: timestamp.UTC().Format(time.RFC3339Nano),
		ID:        id,
	})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func Decode(encoded string) (Cursor, error) {
	if encoded == "" || len(encoded) > 512 {
		return Cursor{}, ErrInvalid
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return Cursor{}, ErrInvalid
	}

	var value payload
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil || value.Version != version || !isUUID(value.ID) {
		return Cursor{}, ErrInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Cursor{}, ErrInvalid
	}

	timestamp, err := time.Parse(time.RFC3339Nano, value.Timestamp)
	if err != nil {
		return Cursor{}, ErrInvalid
	}

	return Cursor{Timestamp: timestamp.UTC(), ID: value.ID}, nil
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
