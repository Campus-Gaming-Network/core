// Package adminsession manages the Admin Console's privileged sessions.
// Admin sessions are intentionally separate from public-site auth sessions.
package adminsession

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
)

const (
	// ProductionCookieName uses the browser-enforced host-only cookie prefix.
	// It must only be emitted with Secure=true, Path=/, and no Domain attribute.
	ProductionCookieName          = "__Host-cgn_admin_session"
	ProductionCSRFCookieName      = "__Host-cgn_admin_csrf"
	AuthMethodCloudflareAccess    = "cloudflare_access"
	maximumRevocationReasonLength = 500
)

var (
	ErrUnauthenticated = apperror.New(
		apperror.KindAuthentication,
		"admin_authentication_required",
		"active Admin Console authentication required",
	)
	ErrInvalidSessionInput = errors.New("invalid admin session input")
)

type Session struct {
	ID                string
	UserID            string
	GrantID           string
	AuthnMethod       string
	AccessIssuer      string
	AccessSubject     string
	AccessEmail       string
	CSRFTokenHash     []byte
	AuthenticatedAt   time.Time
	StepUpAt          *time.Time
	LastSeenAt        time.Time
	IdleExpiresAt     time.Time
	AbsoluteExpiresAt time.Time
}

type Principal struct {
	SessionID         string
	UserID            string
	GrantID           string
	AccessIssuer      string
	AccessSubject     string
	AccessEmail       string
	CSRFTokenHash     []byte
	AuthenticatedAt   time.Time
	StepUpAt          *time.Time
	AbsoluteExpiresAt time.Time
}

type StartInput struct {
	UserID        string
	GrantID       string
	AccessIssuer  string
	AccessSubject string
	AccessEmail   string
}

type Credential struct {
	Token     string
	CSRFToken string
	ExpiresAt time.Time
}

type CreateParams struct {
	UserID            string
	GrantID           string
	TokenHash         []byte
	CSRFTokenHash     []byte
	AuthnMethod       string
	AccessIssuer      string
	AccessSubject     string
	AccessEmail       string
	AuthenticatedAt   time.Time
	StepUpAt          *time.Time
	LastSeenAt        time.Time
	IdleExpiresAt     time.Time
	AbsoluteExpiresAt time.Time
}

type Repository interface {
	CreateSession(ctx context.Context, params CreateParams) error
	FindAndTouchSession(ctx context.Context, tokenHash []byte, now time.Time, idleExpiresAt time.Time) (Session, error)
	RevokeSession(ctx context.Context, tokenHash []byte, revokedAt time.Time, reason string) error
}

type Service struct {
	repository  Repository
	idleTTL     time.Duration
	absoluteTTL time.Duration
	now         func() time.Time
}

func NewService(repository Repository, idleTTL time.Duration, absoluteTTL time.Duration) (*Service, error) {
	if repository == nil || idleTTL <= 0 || absoluteTTL <= 0 || idleTTL > absoluteTTL {
		return nil, ErrInvalidSessionInput
	}
	return &Service{
		repository:  repository,
		idleTTL:     idleTTL,
		absoluteTTL: absoluteTTL,
		now:         time.Now,
	}, nil
}

func (s *Service) Start(ctx context.Context, input StartInput) (Credential, error) {
	accessEmail := strings.ToLower(strings.TrimSpace(input.AccessEmail))
	accessIssuer := strings.TrimSpace(input.AccessIssuer)
	accessSubject := strings.TrimSpace(input.AccessSubject)
	if s == nil || s.repository == nil || strings.TrimSpace(input.UserID) == "" ||
		strings.TrimSpace(input.GrantID) == "" || accessSubject == "" || accessIssuer == "" ||
		utf8.RuneCountInString(accessIssuer) > 500 || utf8.RuneCountInString(accessSubject) > 320 ||
		utf8.RuneCountInString(accessEmail) > 320 || !validEmail(accessEmail) {
		return Credential{}, ErrInvalidSessionInput
	}

	rawToken, tokenHash, err := newToken()
	if err != nil {
		return Credential{}, err
	}
	csrfToken, csrfTokenHash, err := newToken()
	if err != nil {
		return Credential{}, err
	}
	now := s.now().UTC()
	absoluteExpiresAt := now.Add(s.absoluteTTL)
	if err := s.repository.CreateSession(ctx, CreateParams{
		UserID: input.UserID, GrantID: input.GrantID, TokenHash: tokenHash,
		CSRFTokenHash: csrfTokenHash,
		AuthnMethod:   AuthMethodCloudflareAccess,
		AccessIssuer:  accessIssuer,
		AccessSubject: accessSubject,
		AccessEmail:   accessEmail, AuthenticatedAt: now,
		LastSeenAt: now, IdleExpiresAt: now.Add(s.idleTTL),
		AbsoluteExpiresAt: absoluteExpiresAt,
	}); err != nil {
		return Credential{}, err
	}
	return Credential{Token: rawToken, CSRFToken: csrfToken, ExpiresAt: absoluteExpiresAt}, nil
}

func (s *Service) Authenticate(ctx context.Context, rawToken string) (Principal, error) {
	if s == nil || s.repository == nil || strings.TrimSpace(rawToken) == "" {
		return Principal{}, ErrUnauthenticated
	}
	now := s.now().UTC()
	session, err := s.repository.FindAndTouchSession(ctx, HashToken(rawToken), now, now.Add(s.idleTTL))
	if err != nil {
		if errors.Is(err, ErrUnauthenticated) {
			return Principal{}, ErrUnauthenticated
		}
		return Principal{}, err
	}
	if session.AuthnMethod != AuthMethodCloudflareAccess ||
		!session.IdleExpiresAt.After(now) || !session.AbsoluteExpiresAt.After(now) {
		return Principal{}, ErrUnauthenticated
	}
	return Principal{
		SessionID: session.ID, UserID: session.UserID, GrantID: session.GrantID,
		AccessIssuer: session.AccessIssuer, AccessSubject: session.AccessSubject,
		AccessEmail:     session.AccessEmail,
		CSRFTokenHash:   append([]byte(nil), session.CSRFTokenHash...),
		AuthenticatedAt: session.AuthenticatedAt, StepUpAt: session.StepUpAt,
		AbsoluteExpiresAt: session.AbsoluteExpiresAt,
	}, nil
}

// VerifyCSRF compares a submitted double-submit token with the hash bound to
// the authenticated admin session. The raw value is never persisted.
func VerifyCSRF(principal Principal, rawToken string) bool {
	if len(principal.CSRFTokenHash) == 0 || strings.TrimSpace(rawToken) == "" {
		return false
	}
	return constantTimeEqual(principal.CSRFTokenHash, HashToken(rawToken))
}

func (s *Service) Revoke(ctx context.Context, rawToken string, reason string) error {
	reason = strings.TrimSpace(reason)
	if s == nil || s.repository == nil || strings.TrimSpace(rawToken) == "" || reason == "" ||
		utf8.RuneCountInString(reason) > maximumRevocationReasonLength {
		return ErrInvalidSessionInput
	}
	return s.repository.RevokeSession(ctx, HashToken(rawToken), s.now().UTC(), reason)
}

func HashToken(raw string) []byte {
	hash := sha256.Sum256([]byte(raw))
	return hash[:]
}

func newToken() (string, []byte, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", nil, err
	}
	raw := base64.RawURLEncoding.EncodeToString(value)
	return raw, HashToken(raw), nil
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

func constantTimeEqual(left []byte, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare(left, right) == 1
}

type CookieConfig struct {
	Name     string
	CSRFName string
	Secure   bool
}

func ValidateProductionCookieConfig(config CookieConfig) error {
	if !config.Secure || sessionCookieName(config) != ProductionCookieName ||
		csrfCookieName(config) != ProductionCSRFCookieName {
		return ErrInvalidSessionInput
	}
	return nil
}

func SetCookie(w http.ResponseWriter, config CookieConfig, credential Credential) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName(config), Value: credential.Token, Path: "/",
		Expires: credential.ExpiresAt, MaxAge: maxAge(credential.ExpiresAt),
		HttpOnly: true, Secure: config.Secure, SameSite: http.SameSiteStrictMode,
	})
}

func SetCSRFCookie(w http.ResponseWriter, config CookieConfig, credential Credential) {
	http.SetCookie(w, &http.Cookie{
		Name: csrfCookieName(config), Value: credential.CSRFToken, Path: "/",
		Expires: credential.ExpiresAt, MaxAge: maxAge(credential.ExpiresAt),
		HttpOnly: false, Secure: config.Secure, SameSite: http.SameSiteStrictMode,
	})
}

func ClearCookie(w http.ResponseWriter, config CookieConfig) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName(config), Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: config.Secure, SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name: csrfCookieName(config), Value: "", Path: "/", MaxAge: -1,
		HttpOnly: false, Secure: config.Secure, SameSite: http.SameSiteStrictMode,
	})
}

func sessionCookieName(config CookieConfig) string {
	if strings.TrimSpace(config.Name) != "" {
		return strings.TrimSpace(config.Name)
	}
	return ProductionCookieName
}

func csrfCookieName(config CookieConfig) string {
	if strings.TrimSpace(config.CSRFName) != "" {
		return strings.TrimSpace(config.CSRFName)
	}
	return ProductionCSRFCookieName
}

func maxAge(expiresAt time.Time) int {
	seconds := int(time.Until(expiresAt).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}
