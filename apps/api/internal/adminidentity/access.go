// Package adminidentity validates Cloudflare Access application assertions for
// the Admin Console trust boundary.
package adminidentity

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"
)

var (
	ErrMissingAssertion = errors.New("Cloudflare Access assertion required")
	ErrInvalidAssertion = errors.New("invalid Cloudflare Access assertion")
	ErrKeysUnavailable  = errors.New("Cloudflare Access signing keys unavailable")
)

const maximumJWKSResponseBytes = 1 << 20
const signingKeyRefreshCooldown = 30 * time.Second

type Identity struct {
	Issuer        string
	Subject       string
	Email         string
	Authenticated time.Time
	ExpiresAt     time.Time
}

type Config struct {
	Issuer    string
	Audience  string
	JWKSURL   string
	CacheTTL  time.Duration
	ClockSkew time.Duration
}

type Validator struct {
	config Config
	client *http.Client
	now    func() time.Time

	mu                sync.Mutex
	keys              map[string]*rsa.PublicKey
	keysExpireAt      time.Time
	lastForcedRefresh time.Time
}

func NewValidator(config Config, client *http.Client) (*Validator, error) {
	config.Issuer = strings.TrimSuffix(strings.TrimSpace(config.Issuer), "/")
	config.Audience = strings.TrimSpace(config.Audience)
	config.JWKSURL = strings.TrimSpace(config.JWKSURL)
	if config.Issuer == "" || config.Audience == "" || config.JWKSURL == "" {
		return nil, ErrInvalidAssertion
	}
	if config.CacheTTL <= 0 {
		config.CacheTTL = 5 * time.Minute
	}
	if config.ClockSkew < 0 || config.ClockSkew > 5*time.Minute {
		return nil, ErrInvalidAssertion
	}
	if config.ClockSkew == 0 {
		config.ClockSkew = 30 * time.Second
	}
	if client == nil {
		client = &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return errors.New("JWKS redirects are not allowed")
			},
		}
	}
	return &Validator{config: config, client: client, now: time.Now}, nil
}

func (validator *Validator) Validate(ctx context.Context, assertion string) (Identity, error) {
	assertion = strings.TrimSpace(assertion)
	if assertion == "" {
		return Identity{}, ErrMissingAssertion
	}
	if len(assertion) > 64*1024 {
		return Identity{}, ErrInvalidAssertion
	}
	parts := strings.Split(assertion, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return Identity{}, ErrInvalidAssertion
	}

	var header tokenHeader
	if err := decodeSegment(parts[0], &header); err != nil || header.Algorithm != "RS256" || strings.TrimSpace(header.KeyID) == "" {
		return Identity{}, ErrInvalidAssertion
	}
	var claims tokenClaims
	if err := decodeSegment(parts[1], &claims); err != nil {
		return Identity{}, ErrInvalidAssertion
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Identity{}, ErrInvalidAssertion
	}

	key, err := validator.key(ctx, header.KeyID, false)
	if errors.Is(err, errUnknownKey) {
		key, err = validator.key(ctx, header.KeyID, true)
	}
	if err != nil {
		if errors.Is(err, errUnknownKey) {
			return Identity{}, ErrInvalidAssertion
		}
		return Identity{}, ErrKeysUnavailable
	}
	if len(signature) != key.Size() {
		return Identity{}, ErrInvalidAssertion
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return Identity{}, ErrInvalidAssertion
	}

	return validator.validateClaims(claims)
}

type tokenHeader struct {
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
}

type tokenClaims struct {
	Issuer    string   `json:"iss"`
	Subject   string   `json:"sub"`
	Email     string   `json:"email"`
	Audience  audience `json:"aud"`
	ExpiresAt int64    `json:"exp"`
	IssuedAt  int64    `json:"iat"`
	NotBefore int64    `json:"nbf,omitempty"`
}

type audience []string

func (value *audience) UnmarshalJSON(data []byte) error {
	var values []string
	if err := json.Unmarshal(data, &values); err == nil {
		*value = values
		return nil
	}
	var single string
	if err := json.Unmarshal(data, &single); err != nil {
		return err
	}
	*value = []string{single}
	return nil
}

func (validator *Validator) validateClaims(claims tokenClaims) (Identity, error) {
	now := validator.now().UTC()
	skew := validator.config.ClockSkew
	issuer := strings.TrimSuffix(strings.TrimSpace(claims.Issuer), "/")
	subject := strings.TrimSpace(claims.Subject)
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if issuer != validator.config.Issuer || subject == "" || !validEmail(email) ||
		claims.ExpiresAt == 0 || claims.IssuedAt == 0 || !contains(claims.Audience, validator.config.Audience) {
		return Identity{}, ErrInvalidAssertion
	}
	expiresAt := time.Unix(claims.ExpiresAt, 0).UTC()
	issuedAt := time.Unix(claims.IssuedAt, 0).UTC()
	if !expiresAt.After(now.Add(-skew)) || issuedAt.After(now.Add(skew)) || !expiresAt.After(issuedAt) {
		return Identity{}, ErrInvalidAssertion
	}
	if claims.NotBefore != 0 && time.Unix(claims.NotBefore, 0).UTC().After(now.Add(skew)) {
		return Identity{}, ErrInvalidAssertion
	}
	return Identity{
		Issuer: issuer, Subject: subject, Email: email,
		Authenticated: issuedAt, ExpiresAt: expiresAt,
	}, nil
}

var errUnknownKey = errors.New("unknown signing key")

func (validator *Validator) key(ctx context.Context, keyID string, forceRefresh bool) (*rsa.PublicKey, error) {
	validator.mu.Lock()
	defer validator.mu.Unlock()
	now := validator.now().UTC()
	if !forceRefresh && now.Before(validator.keysExpireAt) {
		if key := validator.keys[keyID]; key != nil {
			return key, nil
		}
		return nil, errUnknownKey
	}
	if forceRefresh {
		if !validator.lastForcedRefresh.IsZero() && now.Sub(validator.lastForcedRefresh) < signingKeyRefreshCooldown {
			return nil, errUnknownKey
		}
		validator.lastForcedRefresh = now
	}
	keys, err := validator.fetchKeys(ctx)
	if err != nil {
		return nil, err
	}
	validator.keys = keys
	validator.keysExpireAt = now.Add(validator.config.CacheTTL)
	if key := keys[keyID]; key != nil {
		return key, nil
	}
	return nil, errUnknownKey
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KeyID     string `json:"kid"`
	KeyType   string `json:"kty"`
	Use       string `json:"use"`
	Algorithm string `json:"alg"`
	Modulus   string `json:"n"`
	Exponent  string `json:"e"`
}

func (validator *Validator) fetchKeys(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, validator.config.JWKSURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build JWKS request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	response, err := validator.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch JWKS: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch JWKS: unexpected status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maximumJWKSResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read JWKS: %w", err)
	}
	if len(body) > maximumJWKSResponseBytes {
		return nil, errors.New("JWKS response exceeds size limit")
	}
	var set jwkSet
	if err := decodeJSON(body, &set); err != nil {
		return nil, fmt.Errorf("decode JWKS: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, value := range set.Keys {
		if value.KeyType != "RSA" || (value.Use != "" && value.Use != "sig") ||
			(value.Algorithm != "" && value.Algorithm != "RS256") || strings.TrimSpace(value.KeyID) == "" {
			continue
		}
		key, err := rsaKey(value.Modulus, value.Exponent)
		if err != nil {
			continue
		}
		keys[value.KeyID] = key
	}
	if len(keys) == 0 {
		return nil, errors.New("JWKS contains no usable signing keys")
	}
	return keys, nil
}

func rsaKey(modulusValue, exponentValue string) (*rsa.PublicKey, error) {
	modulusBytes, err := base64.RawURLEncoding.DecodeString(modulusValue)
	if err != nil || len(modulusBytes) < 256 {
		return nil, ErrInvalidAssertion
	}
	exponentBytes, err := base64.RawURLEncoding.DecodeString(exponentValue)
	if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
		return nil, ErrInvalidAssertion
	}
	exponent := new(big.Int).SetBytes(exponentBytes)
	if !exponent.IsInt64() || exponent.Int64() < 3 || exponent.Int64() > int64(^uint(0)>>1) {
		return nil, ErrInvalidAssertion
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(modulusBytes), E: int(exponent.Int64())}, nil
}

func decodeSegment(value string, target any) error {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) == 0 || len(decoded) > 16*1024 {
		return ErrInvalidAssertion
	}
	if err := decodeJSON(decoded, target); err != nil {
		return ErrInvalidAssertion
	}
	return nil
}

func decodeJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
