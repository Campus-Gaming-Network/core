// Package auth provides account authentication, sessions, tokens, and email flows.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"time"
)

var ErrUnauthenticated = errors.New("authentication required")

type contextKey string

const userIDContextKey contextKey = "cgn.user_id"

type Session struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
}

type SessionStore interface {
	FindSession(ctx context.Context, tokenHash []byte) (Session, error)
}

type SessionCookieConfig struct {
	Name   string
	Secure bool
	TTL    time.Duration
}

// NewToken creates the opaque value sent to the browser and its SHA-256 hash
// for storage. The raw value is never persisted in the database.
func NewToken() (string, []byte, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", nil, err
	}

	raw := base64.RawURLEncoding.EncodeToString(bytes)
	hash := sha256.Sum256([]byte(raw))
	return raw, hash[:], nil
}

// HashToken returns the SHA-256 digest used to look up a raw session token.
func HashToken(raw string) []byte {
	hash := sha256.Sum256([]byte(raw))
	return hash[:]
}

// WithSession adds the authenticated user to the request context when present.
func WithSession(store SessionStore, cookieConfig SessionCookieConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			cookie, err := req.Cookie(cookieConfig.Name)
			if err == nil && cookie.Value != "" {
				session, lookupErr := store.FindSession(req.Context(), HashToken(cookie.Value))
				if lookupErr == nil && session.ExpiresAt.After(time.Now()) {
					req = req.WithContext(context.WithValue(req.Context(), userIDContextKey, session.UserID))
				} else {
					ClearSessionCookie(w, cookieConfig)
				}
			}

			next.ServeHTTP(w, req)
		})
	}
}

// UserID returns the authenticated user ID stored in ctx.
func UserID(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(userIDContextKey).(string)
	return userID, ok && userID != ""
}

// RequireUser returns the authenticated user ID or ErrUnauthenticated.
func RequireUser(ctx context.Context) (string, error) {
	userID, ok := UserID(ctx)
	if !ok {
		return "", ErrUnauthenticated
	}
	return userID, nil
}

func SetSessionCookie(w http.ResponseWriter, config SessionCookieConfig, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     config.Name,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   maxAge(expiresAt),
		HttpOnly: true,
		Secure:   config.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func ClearSessionCookie(w http.ResponseWriter, config SessionCookieConfig) {
	http.SetCookie(w, &http.Cookie{
		Name:     config.Name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   config.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func maxAge(expiresAt time.Time) int {
	seconds := int(time.Until(expiresAt).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}
