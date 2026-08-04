package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// Argon2id parameters. These follow an OWASP-recommended configuration
// (19 MiB of memory, two passes, one lane).
//
// They are written into every hash rather than assumed at verification time,
// so raising them later only affects newly written hashes. Existing hashes keep
// verifying under the parameters they were created with, which means the cost
// can be tuned without a rehash-on-login migration.
const (
	argonMemoryKiB  uint32 = 19456
	argonIterations uint32 = 2
	argonLanes      uint8  = 1
	argonSaltLength        = 16
	argonKeyLength  uint32 = 32
)

var errInvalidHashFormat = errors.New("password hash is not in a recognized format")

// HashPassword derives an Argon2id hash and encodes it, with its parameters, as
// a PHC string: $argon2id$v=19$m=...,t=...,p=...$<salt>$<key>.
//
// This is also used for team join passwords and private event passwords, which
// are shared secrets rather than user credentials but are stored the same way.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}

	key := argon2.IDKey(
		[]byte(password),
		salt,
		argonIterations,
		argonMemoryKiB,
		argonLanes,
		argonKeyLength,
	)

	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemoryKiB,
		argonIterations,
		argonLanes,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// ComparePassword reports whether password matches hash. Argon2id parameters are
// read back out of the stored hash, so hashes written under older settings keep
// working after the constants above change.
//
// bcrypt hashes are still accepted so databases seeded before the switch keep
// working. Nothing writes them any more.
func ComparePassword(hash string, password string) bool {
	if strings.HasPrefix(hash, "$2a$") || strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$") {
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
	}

	salt, key, memory, iterations, lanes, err := decodeArgonHash(hash)
	if err != nil {
		return false
	}

	candidate := argon2.IDKey(
		[]byte(password),
		salt,
		iterations,
		memory,
		lanes,
		uint32(len(key)),
	)

	return subtle.ConstantTimeCompare(candidate, key) == 1
}

func decodeArgonHash(hash string) (salt, key []byte, memory, iterations uint32, lanes uint8, err error) {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}
	if version != argon2.Version {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &lanes); err != nil {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}

	salt, err = base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}
	key, err = base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}
	if len(salt) == 0 || len(key) == 0 {
		return nil, nil, 0, 0, 0, errInvalidHashFormat
	}

	return salt, key, memory, iterations, lanes, nil
}
