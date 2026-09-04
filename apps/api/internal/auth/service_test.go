package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

type fakeUsers struct {
	profile      users.Profile
	credentials  users.Credentials
	created      users.CreateParams
	passwordHash string
	deletedID    string
	deleteErr    error
}

func (f *fakeUsers) Create(_ context.Context, params users.CreateParams) (users.Profile, error) {
	f.created = params
	f.profile = users.Profile{
		ID:                "user-id",
		Email:             params.Email,
		VerificationLevel: "basic",
		Name:              params.Name,
		Timezone:          params.Timezone,
		HomeSchoolID:      params.HomeSchoolID,
	}
	f.credentials = users.Credentials{Profile: f.profile, PasswordHash: params.PasswordHash}
	return f.profile, nil
}

func (f *fakeUsers) FindByID(_ context.Context, _ string) (users.Profile, error) {
	return f.profile, nil
}

func (f *fakeUsers) FindByEmail(_ context.Context, _ string) (users.Profile, error) {
	return f.profile, nil
}

func (f *fakeUsers) UpdateProfile(_ context.Context, _ string, update users.ProfileUpdate) (users.Profile, error) {
	f.profile.Name = update.Name
	f.profile.Bio = update.Bio
	f.profile.Timezone = update.Timezone
	return f.profile, nil
}

func (f *fakeUsers) FindCredentialsByEmail(_ context.Context, _ string) (users.Credentials, error) {
	return f.credentials, nil
}

func (f *fakeUsers) MarkEmailVerified(_ context.Context, _ string) error {
	now := time.Now()
	f.profile.EmailVerifiedAt = &now
	f.credentials.Profile.EmailVerifiedAt = &now
	return nil
}

func (f *fakeUsers) UpdatePassword(_ context.Context, _ string, passwordHash string) error {
	f.passwordHash = passwordHash
	return nil
}

func (f *fakeUsers) ReplaceSocialLinks(_ context.Context, _ string, links []users.SocialLink) error {
	f.profile.SocialLinks = links
	return nil
}

func (f *fakeUsers) DeleteAccount(_ context.Context, id string) error {
	f.deletedID = id
	return f.deleteErr
}

type fakeSchools struct{}

func (fakeSchools) List(context.Context, schools.ListParams) ([]schools.School, error) {
	return nil, nil
}
func (fakeSchools) GetByID(context.Context, string) (schools.School, error) {
	return schools.School{}, nil
}
func (fakeSchools) GetBySlug(context.Context, string) (schools.School, error) {
	return schools.School{}, nil
}
func (fakeSchools) ExistsActive(context.Context, string) (bool, error) { return true, nil }

type fakeSessions struct {
	userID    string
	tokenHash []byte
	expiresAt time.Time
}

func (f *fakeSessions) CreateSession(_ context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	f.userID = userID
	f.tokenHash = tokenHash
	f.expiresAt = expiresAt
	return nil
}
func (f *fakeSessions) RevokeSession(context.Context, []byte) error { return nil }

type fakeTokens struct {
	verificationUserID string
	resetPasswordHash  string
}

func (f *fakeTokens) CreateEmailVerificationToken(context.Context, string, []byte, time.Time) error {
	return nil
}
func (f *fakeTokens) ConsumeEmailVerificationToken(context.Context, []byte, time.Time) (string, error) {
	return f.verificationUserID, nil
}
func (f *fakeTokens) CreatePasswordResetToken(context.Context, string, []byte, time.Time) error {
	return nil
}
func (f *fakeTokens) UsePasswordResetToken(_ context.Context, _ []byte, _ time.Time, passwordHash string) error {
	f.resetPasswordHash = passwordHash
	return nil
}

type fakeMailer struct {
	verificationToken string
	resetToken        string
	err               error
}

func (f *fakeMailer) SendVerification(_ context.Context, _ string, token string) error {
	f.verificationToken = token
	return f.err
}
func (f *fakeMailer) SendPasswordReset(_ context.Context, _ string, token string) error {
	f.resetToken = token
	return f.err
}

// A delivery failure must not fail the account change that already happened.
// Failing signup here would leave the address taken by a committed user row
// while telling the caller signup failed, so they could never retry.
func TestAccountServiceSignupSucceedsWhenVerificationEmailFails(t *testing.T) {
	userStore := &fakeUsers{}
	mailer := &fakeMailer{err: errors.New("resend unavailable")}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, mailer, time.Hour, time.Hour, time.Hour)

	profile, err := service.Signup(context.Background(), users.SignupInput{
		Email:        "player@example.com",
		Password:     "a-long-enough-password",
		Name:         "Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
		Timezone:     "UTC",
	})
	if err != nil {
		t.Fatalf("Signup() error = %v, want nil when only delivery failed", err)
	}
	if profile.Email != "player@example.com" {
		t.Fatalf("profile email = %q, want the created account", profile.Email)
	}
	if userStore.created.Email == "" {
		t.Fatal("signup did not persist the account")
	}
}

func TestAccountServicePasswordResetSucceedsWhenEmailFails(t *testing.T) {
	userStore := &fakeUsers{}
	now := time.Now()
	userStore.credentials.Profile.ID = "user-id"
	userStore.credentials.Profile.Email = "player@example.com"
	userStore.credentials.Profile.EmailVerifiedAt = &now
	mailer := &fakeMailer{err: errors.New("resend unavailable")}
	tokens := &fakeTokens{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, tokens, mailer, time.Hour, time.Hour, time.Hour)

	if err := service.RequestPasswordReset(context.Background(), "player@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset() error = %v, want nil when only delivery failed", err)
	}
	if mailer.resetToken == "" {
		t.Fatal("reset token was never issued")
	}
}

func TestAccountServiceSignupAndLogin(t *testing.T) {
	userStore := &fakeUsers{}
	sessions := &fakeSessions{}
	mailer := &fakeMailer{}
	service := NewAccountService(userStore, fakeSchools{}, sessions, &fakeTokens{}, mailer, time.Hour, time.Hour, time.Hour)

	profile, err := service.Signup(context.Background(), users.SignupInput{
		Email:        "Player@Example.com",
		Password:     "a-long-enough-password",
		Name:         "Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
		Timezone:     "UTC",
	})
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}
	if profile.Email != "player@example.com" {
		t.Fatalf("profile email = %q, want normalized email", profile.Email)
	}
	if userStore.created.PasswordHash == "a-long-enough-password" || !ComparePassword(userStore.created.PasswordHash, "a-long-enough-password") {
		t.Fatal("signup did not store a verifiable password hash")
	}
	if mailer.verificationToken == "" {
		t.Fatal("signup did not send a verification token")
	}

	if _, err := service.Login(context.Background(), profile.Email, "a-long-enough-password"); err != ErrEmailUnverified {
		t.Fatalf("Login() error = %v, want ErrEmailUnverified", err)
	}
	now := time.Now()
	userStore.credentials.Profile.EmailVerifiedAt = &now
	result, err := service.Login(context.Background(), profile.Email, "a-long-enough-password")
	if err != nil {
		t.Fatalf("verified Login() error = %v", err)
	}
	if result.Token == "" || sessions.userID != "user-id" || !sessions.expiresAt.After(time.Now()) {
		t.Fatal("verified login did not create a live session")
	}
}

func TestAccountServiceSignupPersistsHomeSchoolAndAgeConfirmation(t *testing.T) {
	userStore := &fakeUsers{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, &fakeMailer{}, time.Hour, time.Hour, time.Hour)
	confirmedAt := time.Date(2026, time.September, 3, 19, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return confirmedAt }

	_, err := service.Signup(context.Background(), users.SignupInput{
		Email:        "player@example.com",
		Password:     "a-long-enough-password",
		Name:         "Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
		Timezone:     "America/Los_Angeles",
	})
	if err != nil {
		t.Fatalf("Signup() error = %v", err)
	}
	if userStore.created.HomeSchoolID != "school-id" {
		t.Fatalf("Create() HomeSchoolID = %q, want school-id", userStore.created.HomeSchoolID)
	}
	if !userStore.created.AgeConfirmedAt.Equal(confirmedAt) {
		t.Fatalf("Create() AgeConfirmedAt = %v, want %v", userStore.created.AgeConfirmedAt, confirmedAt)
	}
}

func TestAccountServiceResetPasswordStoresHash(t *testing.T) {
	userStore := &fakeUsers{}
	tokens := &fakeTokens{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, tokens, &fakeMailer{}, time.Hour, time.Hour, time.Hour)

	if err := service.ResetPassword(context.Background(), "reset-token", "12345678"); err != nil {
		t.Fatalf("ResetPassword() error = %v", err)
	}
	if tokens.resetPasswordHash == "12345678" || !ComparePassword(tokens.resetPasswordHash, "12345678") {
		t.Fatal("reset did not pass a password hash to the token store")
	}
}

func TestAccountServiceResetPasswordRejectsShortPassword(t *testing.T) {
	tokens := &fakeTokens{}
	service := NewAccountService(&fakeUsers{}, fakeSchools{}, &fakeSessions{}, tokens, &fakeMailer{}, time.Hour, time.Hour, time.Hour)

	if err := service.ResetPassword(context.Background(), "reset-token", "1234567"); err == nil {
		t.Fatal("ResetPassword() error = nil, want short password validation")
	}
	if tokens.resetPasswordHash != "" {
		t.Fatal("short password should not be passed to the token store")
	}
}

func TestAccountServiceGetPublicProfileIncludesHomeSchoolSummary(t *testing.T) {
	userStore := &fakeUsers{
		profile: users.Profile{
			ID:                "user-id",
			Name:              "Player",
			VerificationLevel: "basic",
			HomeSchoolID:      "school-id",
			HomeSchool: &users.HomeSchool{
				ID:    "school-id",
				Name:  "Example University",
				Slug:  "example-university",
				City:  "Irvine",
				State: "CA",
			},
		},
	}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, &fakeMailer{}, time.Hour, time.Hour, time.Hour)

	profile, err := service.GetPublicProfile(context.Background(), "user-id")
	if err != nil {
		t.Fatalf("GetPublicProfile() error = %v", err)
	}
	if profile.HomeSchool == nil {
		t.Fatal("GetPublicProfile() HomeSchool = nil, want summary")
	}
	if profile.HomeSchool.Name != "Example University" || profile.HomeSchool.Slug != "example-university" {
		t.Fatalf("GetPublicProfile() HomeSchool = %#v, want display-ready school summary", profile.HomeSchool)
	}
}
