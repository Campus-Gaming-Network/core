package auth

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

func TestHashPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("a-long-enough-password")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if hash == "a-long-enough-password" {
		t.Fatal("HashPassword returned the password unchanged")
	}
	if !ComparePassword(hash, "a-long-enough-password") {
		t.Fatal("ComparePassword rejected the correct password")
	}
	if ComparePassword(hash, "a-long-enough-passworD") {
		t.Fatal("ComparePassword accepted an incorrect password")
	}
}

func TestHashPasswordEncodesParameters(t *testing.T) {
	hash, err := HashPassword("a-long-enough-password")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}

	wantPrefix := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$",
		argon2.Version, argonMemoryKiB, argonIterations, argonLanes,
	)
	if !strings.HasPrefix(hash, wantPrefix) {
		t.Fatalf("hash = %q, want prefix %q", hash, wantPrefix)
	}
	if got := len(strings.Split(hash, "$")); got != 6 {
		t.Fatalf("hash has %d PHC segments, want 6: %q", got, hash)
	}
}

func TestHashPasswordUsesDistinctSalts(t *testing.T) {
	first, err := HashPassword("a-long-enough-password")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	second, err := HashPassword("a-long-enough-password")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if first == second {
		t.Fatal("hashing the same password twice produced identical hashes")
	}
}

// Parameters are read back from the stored hash rather than assumed, so a hash
// written under different settings still verifies. This is what makes tuning
// the cost later a no-op for existing hashes.
func TestComparePasswordHonorsParametersFromStoredHash(t *testing.T) {
	const password = "a-long-enough-password"
	salt := []byte("0123456789abcdef")
	var (
		memory     uint32 = 8192
		iterations uint32 = 1
		lanes      uint8  = 1
	)
	key := argon2.IDKey([]byte(password), salt, iterations, memory, lanes, argonKeyLength)
	hash := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memory, iterations, lanes,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)

	if !ComparePassword(hash, password) {
		t.Fatal("ComparePassword rejected a hash written with different parameters")
	}
	if ComparePassword(hash, "another-password") {
		t.Fatal("ComparePassword accepted the wrong password")
	}
}

func TestComparePasswordAcceptsLegacyBcrypt(t *testing.T) {
	legacy, err := bcrypt.GenerateFromPassword([]byte("a-long-enough-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("bcrypt.GenerateFromPassword() error = %v", err)
	}
	if !ComparePassword(string(legacy), "a-long-enough-password") {
		t.Fatal("ComparePassword rejected a valid bcrypt hash")
	}
	if ComparePassword(string(legacy), "wrong-password") {
		t.Fatal("ComparePassword accepted a wrong password against a bcrypt hash")
	}
}

func TestComparePasswordRejectsMalformedHashes(t *testing.T) {
	for _, hash := range []string{
		"",
		"not-a-hash",
		"$argon2id$v=19$m=19456,t=2,p=1$onlyfoursegments",
		"$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$a2V5a2V5",
		"$argon2id$v=99$m=19456,t=2,p=1$c2FsdHNhbHQ$a2V5a2V5",
		"$argon2id$v=19$m=bad,t=2,p=1$c2FsdHNhbHQ$a2V5a2V5",
		"$argon2id$v=19$m=19456,t=2,p=1$!!!notbase64$a2V5a2V5",
	} {
		if ComparePassword(hash, "a-long-enough-password") {
			t.Fatalf("ComparePassword accepted malformed hash %q", hash)
		}
	}
}
