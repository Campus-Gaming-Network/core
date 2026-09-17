package adminidentity

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func TestValidatorAcceptsValidCloudflareAccessAssertionAndCachesKeys(t *testing.T) {
	privateKey := testPrivateKey(t)
	var requests atomic.Int32
	client := testHTTPClient(func(req *http.Request) []byte {
		requests.Add(1)
		return testJWKS(t, "key-1", &privateKey.PublicKey)
	})
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	validator := testValidator(t, client, now)
	token := signTestToken(t, privateKey, "key-1", map[string]any{
		"iss": "https://cgn.cloudflareaccess.com", "sub": "access-subject",
		"email": "ADMIN@Example.test", "aud": []string{"other", "admin-audience"},
		"iat": now.Add(-time.Minute).Unix(), "exp": now.Add(time.Hour).Unix(),
	})

	for index := 0; index < 2; index++ {
		identity, err := validator.Validate(context.Background(), token)
		if err != nil {
			t.Fatalf("Validate() error = %v", err)
		}
		if identity.Subject != "access-subject" || identity.Email != "admin@example.test" ||
			identity.Issuer != "https://cgn.cloudflareaccess.com" {
			t.Fatalf("Validate() = %#v", identity)
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("JWKS requests = %d, want 1", requests.Load())
	}
}

func TestValidatorRefreshesCachedKeysForRotation(t *testing.T) {
	firstKey := testPrivateKey(t)
	secondKey := testPrivateKey(t)
	var rotated atomic.Bool
	client := testHTTPClient(func(req *http.Request) []byte {
		if rotated.Load() {
			return testJWKS(t, "key-2", &secondKey.PublicKey)
		}
		return testJWKS(t, "key-1", &firstKey.PublicKey)
	})
	now := time.Now().UTC().Truncate(time.Second)
	validator := testValidator(t, client, now)
	claims := map[string]any{"iss": "https://cgn.cloudflareaccess.com", "sub": "subject",
		"email": "admin@example.test", "aud": "admin-audience", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix()}
	if _, err := validator.Validate(context.Background(), signTestToken(t, firstKey, "key-1", claims)); err != nil {
		t.Fatalf("Validate(first) error = %v", err)
	}
	rotated.Store(true)
	if _, err := validator.Validate(context.Background(), signTestToken(t, secondKey, "key-2", claims)); err != nil {
		t.Fatalf("Validate(rotated) error = %v", err)
	}
}

func TestValidatorRejectsUnsafeAssertions(t *testing.T) {
	privateKey := testPrivateKey(t)
	client := testHTTPClient(func(req *http.Request) []byte {
		return testJWKS(t, "key-1", &privateKey.PublicKey)
	})
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	validClaims := map[string]any{
		"iss": "https://cgn.cloudflareaccess.com", "sub": "access-subject",
		"email": "admin@example.test", "aud": []string{"admin-audience"},
		"iat": now.Add(-time.Minute).Unix(), "exp": now.Add(time.Hour).Unix(),
	}

	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "wrong issuer", mutate: func(claims map[string]any) { claims["iss"] = "https://attacker.example" }},
		{name: "wrong audience", mutate: func(claims map[string]any) { claims["aud"] = []string{"public-app"} }},
		{name: "expired", mutate: func(claims map[string]any) { claims["exp"] = now.Add(-time.Minute).Unix() }},
		{name: "future issuance", mutate: func(claims map[string]any) { claims["iat"] = now.Add(time.Hour).Unix() }},
		{name: "future not before", mutate: func(claims map[string]any) { claims["nbf"] = now.Add(time.Hour).Unix() }},
		{name: "service token subject", mutate: func(claims map[string]any) { claims["sub"] = "" }},
		{name: "missing email", mutate: func(claims map[string]any) { delete(claims, "email") }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims := cloneClaims(validClaims)
			tt.mutate(claims)
			validator := testValidator(t, client, now)
			_, err := validator.Validate(context.Background(), signTestToken(t, privateKey, "key-1", claims))
			if !errors.Is(err, ErrInvalidAssertion) {
				t.Fatalf("Validate() error = %v, want ErrInvalidAssertion", err)
			}
		})
	}
}

func TestValidatorRejectsMissingMalformedAndTamperedAssertions(t *testing.T) {
	privateKey := testPrivateKey(t)
	client := testHTTPClient(func(req *http.Request) []byte {
		return testJWKS(t, "key-1", &privateKey.PublicKey)
	})
	now := time.Now().UTC().Truncate(time.Second)
	validator := testValidator(t, client, now)
	if _, err := validator.Validate(context.Background(), ""); !errors.Is(err, ErrMissingAssertion) {
		t.Fatalf("missing assertion error = %v", err)
	}
	if _, err := validator.Validate(context.Background(), "not-a-token"); !errors.Is(err, ErrInvalidAssertion) {
		t.Fatalf("malformed assertion error = %v", err)
	}
	token := signTestToken(t, privateKey, "key-1", map[string]any{
		"iss": "https://cgn.cloudflareaccess.com", "sub": "subject", "email": "admin@example.test",
		"aud": "admin-audience", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	tamperIndex := len(token) - 20
	replacement := "A"
	if token[tamperIndex] == 'A' {
		replacement = "B"
	}
	tampered := token[:tamperIndex] + replacement + token[tamperIndex+1:]
	if _, err := validator.Validate(context.Background(), tampered); !errors.Is(err, ErrInvalidAssertion) {
		t.Fatalf("tampered assertion error = %v", err)
	}
}

func testValidator(t *testing.T, client *http.Client, now time.Time) *Validator {
	t.Helper()
	validator, err := NewValidator(Config{
		Issuer: "https://cgn.cloudflareaccess.com", Audience: "admin-audience",
		JWKSURL: "https://jwks.example.test/certs", CacheTTL: time.Hour, ClockSkew: 30 * time.Second,
	}, client)
	if err != nil {
		t.Fatalf("NewValidator() error = %v", err)
	}
	validator.now = func() time.Time { return now }
	return validator
}

func testPrivateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

func testJWKS(t *testing.T, keyID string, key *rsa.PublicKey) []byte {
	t.Helper()
	exponent := big.NewInt(int64(key.E)).Bytes()
	value := map[string]any{"keys": []map[string]string{{
		"kid": keyID, "kty": "RSA", "use": "sig", "alg": "RS256",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(exponent),
	}}}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode JWKS: %v", err)
	}
	return encoded
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return function(req)
}

func testHTTPClient(response func(*http.Request) []byte) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewReader(response(req))),
			Request:    req,
		}, nil
	})}
}

func signTestToken(t *testing.T, key *rsa.PrivateKey, keyID string, claims map[string]any) string {
	t.Helper()
	headerBytes, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": keyID, "typ": "JWT"})
	claimBytes, _ := json.Marshal(claims)
	header := base64.RawURLEncoding.EncodeToString(headerBytes)
	payload := base64.RawURLEncoding.EncodeToString(claimBytes)
	digest := sha256.Sum256([]byte(header + "." + payload))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return header + "." + payload + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func cloneClaims(source map[string]any) map[string]any {
	copy := make(map[string]any, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}
