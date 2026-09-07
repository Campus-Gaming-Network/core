package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

var (
	ErrHomeSchoolNotFound = errors.New("home school not found")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailUnverified    = errors.New("email is not verified")
	ErrInvalidToken       = errors.New("invalid or expired token")
)

type SessionManager interface {
	CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	RevokeSession(ctx context.Context, tokenHash []byte) error
}

type AccountService struct {
	Users   users.AccountRepository
	Schools interface {
		ExistsActive(context.Context, string) (bool, error)
	}
	Sessions        SessionManager
	Tokens          TokenStore
	SessionTTL      time.Duration
	VerificationTTL time.Duration
	ResetTTL        time.Duration
	now             func() time.Time
}

type LoginResult struct {
	Profile   users.Profile
	Token     string
	ExpiresAt time.Time
}

func NewAccountService(userStore users.AccountRepository, schoolStore schools.Repository, sessions SessionManager, tokens TokenStore, sessionTTL, verificationTTL, resetTTL time.Duration) *AccountService {
	return &AccountService{
		Users:           userStore,
		Schools:         schoolStore,
		Sessions:        sessions,
		Tokens:          tokens,
		SessionTTL:      sessionTTL,
		VerificationTTL: verificationTTL,
		ResetTTL:        resetTTL,
		now:             time.Now,
	}
}

func (s *AccountService) Signup(ctx context.Context, input users.SignupInput) (users.Profile, error) {
	if err := users.ValidateSignup(input); err != nil {
		return users.Profile{}, err
	}
	exists, err := s.Schools.ExistsActive(ctx, input.HomeSchoolID)
	if err != nil {
		return users.Profile{}, err
	}
	if !exists {
		return users.Profile{}, ErrHomeSchoolNotFound
	}

	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return users.Profile{}, err
	}
	token, tokenHash, err := NewToken()
	if err != nil {
		return users.Profile{}, err
	}
	now := s.now()
	profile, err := s.Users.CreateWithVerificationToken(ctx, users.CreateParams{
		Email:          users.NormalizeEmail(input.Email),
		PasswordHash:   passwordHash,
		Name:           strings.TrimSpace(input.Name),
		HomeSchoolID:   input.HomeSchoolID,
		AgeConfirmedAt: now,
		Timezone:       input.Timezone,
	}, token, tokenHash, now.Add(s.VerificationTTL))
	if err != nil {
		return users.Profile{}, err
	}

	return profile, nil
}

func (s *AccountService) Login(ctx context.Context, email string, password string) (LoginResult, error) {
	credentials, err := s.Users.FindCredentialsByEmail(ctx, users.NormalizeEmail(email))
	if err != nil || !ComparePassword(credentials.PasswordHash, password) {
		return LoginResult{}, ErrInvalidCredentials
	}
	if credentials.Profile.EmailVerifiedAt == nil {
		return LoginResult{}, ErrEmailUnverified
	}

	token, tokenHash, err := NewToken()
	if err != nil {
		return LoginResult{}, err
	}
	expiresAt := s.now().Add(s.SessionTTL)
	if err := s.Sessions.CreateSession(ctx, credentials.Profile.ID, tokenHash, expiresAt); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Profile: credentials.Profile, Token: token, ExpiresAt: expiresAt}, nil
}

func (s *AccountService) Logout(ctx context.Context, rawToken string) error {
	if strings.TrimSpace(rawToken) == "" {
		return nil
	}
	return s.Sessions.RevokeSession(ctx, HashToken(rawToken))
}

func (s *AccountService) VerifyEmail(ctx context.Context, rawToken string) error {
	if strings.TrimSpace(rawToken) == "" {
		return ErrInvalidToken
	}
	err := s.Users.VerifyEmailByToken(ctx, HashToken(rawToken), s.now())
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidToken
	}
	if err != nil {
		return err
	}
	return nil
}

func (s *AccountService) ResendVerification(ctx context.Context, email string) error {
	profile, err := s.Users.FindByEmail(ctx, users.NormalizeEmail(email))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if profile.EmailVerifiedAt != nil {
		return nil
	}
	return s.sendVerification(ctx, profile)
}

func (s *AccountService) RequestPasswordReset(ctx context.Context, email string) error {
	profile, err := s.Users.FindByEmail(ctx, users.NormalizeEmail(email))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	token, tokenHash, err := NewToken()
	if err != nil {
		return err
	}
	if err := s.Tokens.CreatePasswordResetToken(ctx, profile.ID, profile.Email, token, tokenHash, s.now().Add(s.ResetTTL)); err != nil {
		return err
	}
	return nil
}

func (s *AccountService) ResetPassword(ctx context.Context, rawToken string, password string) error {
	if err := validatePassword(password); err != nil {
		return err
	}
	passwordHash, err := HashPassword(password)
	if err != nil {
		return err
	}
	if err := s.Tokens.UsePasswordResetToken(ctx, HashToken(rawToken), s.now(), passwordHash); errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidToken
	} else if err != nil {
		return err
	}
	return nil
}

// DeleteAccount anonymizes the account and invalidates its credentials. See
// users.PostgresRepository.DeleteAccount for what is scrubbed, transferred, and
// deliberately kept.
func (s *AccountService) DeleteAccount(ctx context.Context, userID string) error {
	return s.Users.DeleteAccount(ctx, userID)
}

func (s *AccountService) GetProfile(ctx context.Context, userID string) (users.Profile, error) {
	return s.Users.FindByID(ctx, userID)
}

func (s *AccountService) GetPublicProfile(ctx context.Context, userID string) (users.PublicProfile, error) {
	profile, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		return users.PublicProfile{}, err
	}
	return profile.Public(), nil
}

func (s *AccountService) UpdateProfile(ctx context.Context, userID string, update users.ProfileUpdate, links []users.SocialLink) (users.Profile, error) {
	if err := users.ValidateProfileUpdate(update, links); err != nil {
		return users.Profile{}, err
	}
	return s.Users.UpdateProfileWithSocialLinks(ctx, userID, update, links)
}

// sendVerification issues a verification token and emails it.
//
// Token creation failures are returned, because nothing usable was persisted.
// Token creation and durable delivery intent are committed together.
func (s *AccountService) sendVerification(ctx context.Context, profile users.Profile) error {
	token, tokenHash, err := NewToken()
	if err != nil {
		return err
	}
	if err := s.Tokens.CreateEmailVerificationToken(ctx, profile.ID, profile.Email, token, tokenHash, s.now().Add(s.VerificationTTL)); err != nil {
		return err
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < users.MinPasswordLength {
		return errors.New("password must be at least 8 characters")
	}
	return nil
}
