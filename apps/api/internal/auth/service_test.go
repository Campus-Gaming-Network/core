package auth

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

type fakeUsers struct {
	profile                     users.Profile
	credentials                 users.Credentials
	created                     users.CreateParams
	verificationHash            []byte
	verificationToken           string
	verificationExpiry          time.Time
	createWithVerificationErr   error
	verifyEmailErr              error
	verifiedTokenHash           []byte
	verifiedAt                  time.Time
	verifyEmailCalls            int
	updateProfileWithLinksErr   error
	updateProfileWithLinksCalls int
	passwordHash                string
	deletedID                   string
	deleteErr                   error
	findEmail                   string
	findEmailErr                error
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

func (f *fakeUsers) FindByEmail(_ context.Context, email string) (users.Profile, error) {
	f.findEmail = email
	return f.profile, f.findEmailErr
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

func (f *fakeUsers) CreateWithVerificationToken(ctx context.Context, params users.CreateParams, rawToken string, tokenHash []byte, expiresAt time.Time) (users.Profile, error) {
	if f.createWithVerificationErr != nil {
		return users.Profile{}, f.createWithVerificationErr
	}
	profile, err := f.Create(ctx, params)
	if err != nil {
		return users.Profile{}, err
	}
	f.verificationHash = append([]byte(nil), tokenHash...)
	f.verificationToken = rawToken
	f.verificationExpiry = expiresAt
	return profile, nil
}

func (f *fakeUsers) VerifyEmailByToken(_ context.Context, tokenHash []byte, now time.Time) error {
	f.verifyEmailCalls++
	f.verifiedTokenHash = append([]byte(nil), tokenHash...)
	f.verifiedAt = now
	if f.verifyEmailErr != nil {
		return f.verifyEmailErr
	}
	return f.MarkEmailVerified(context.Background(), f.profile.ID)
}

func (f *fakeUsers) UpdateProfileWithSocialLinks(ctx context.Context, id string, update users.ProfileUpdate, links []users.SocialLink) (users.Profile, error) {
	f.updateProfileWithLinksCalls++
	if f.updateProfileWithLinksErr != nil {
		return users.Profile{}, f.updateProfileWithLinksErr
	}
	_, err := f.UpdateProfile(ctx, id, update)
	if err != nil {
		return users.Profile{}, err
	}
	if err := f.ReplaceSocialLinks(ctx, id, links); err != nil {
		return users.Profile{}, err
	}
	return f.profile, nil
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
	verificationUserID    string
	verificationRecipient string
	verificationToken     string
	verificationHash      []byte
	verificationExpiry    time.Time
	resetPasswordHash     string
	resetRecipient        string
	resetToken            string
}

func (f *fakeTokens) CreateEmailVerificationToken(_ context.Context, userID string, recipient string, rawToken string, tokenHash []byte, expiresAt time.Time) error {
	f.verificationUserID = userID
	f.verificationRecipient = recipient
	f.verificationToken = rawToken
	f.verificationHash = tokenHash
	f.verificationExpiry = expiresAt
	return nil
}
func (f *fakeTokens) ConsumeEmailVerificationToken(context.Context, []byte, time.Time) (string, error) {
	return f.verificationUserID, nil
}
func (f *fakeTokens) CreatePasswordResetToken(_ context.Context, _ string, recipient string, rawToken string, _ []byte, _ time.Time) error {
	f.resetRecipient = recipient
	f.resetToken = rawToken
	return nil
}
func (f *fakeTokens) UsePasswordResetToken(_ context.Context, _ []byte, _ time.Time, passwordHash string) error {
	f.resetPasswordHash = passwordHash
	return nil
}

// The account service persists the token and outbox intent as one repository
// operation and never invokes the provider on the request path.
func TestAccountServiceSignupPersistsDeliveryIntentWithoutCallingProvider(t *testing.T) {
	userStore := &fakeUsers{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)

	profile, err := service.Signup(context.Background(), users.SignupInput{
		Email:        "player@example.com",
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
		t.Fatalf("profile email = %q, want the created account", profile.Email)
	}
	if userStore.created.Email == "" {
		t.Fatal("signup did not persist the account")
	}
	if userStore.verificationToken == "" {
		t.Fatal("signup did not persist delivery intent")
	}
}

func TestAccountServiceSignupDatabaseFailureDoesNotExposePartialAccount(t *testing.T) {
	databaseErr := errors.New("database unavailable")
	userStore := &fakeUsers{createWithVerificationErr: databaseErr}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)

	_, err := service.Signup(context.Background(), users.SignupInput{
		Email:        "player@example.com",
		Password:     "a-long-enough-password",
		Name:         "Player",
		HomeSchoolID: "school-id",
		AgeConfirmed: true,
		Timezone:     "UTC",
	})
	if !errors.Is(err, databaseErr) {
		t.Fatalf("Signup() error = %v, want %v", err, databaseErr)
	}
	if userStore.created.Email != "" {
		t.Fatal("failed atomic signup exposed a partially created user")
	}
}

func TestAccountServicePasswordResetPersistsDeliveryIntentWithoutCallingProvider(t *testing.T) {
	userStore := &fakeUsers{}
	now := time.Now()
	userStore.profile.ID = "user-id"
	userStore.profile.Email = "player@example.com"
	userStore.profile.EmailVerifiedAt = &now
	tokens := &fakeTokens{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, tokens, time.Hour, time.Hour, time.Hour)

	if err := service.RequestPasswordReset(context.Background(), "player@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset() error = %v", err)
	}
	if tokens.resetToken == "" || tokens.resetRecipient != "player@example.com" {
		t.Fatal("reset delivery intent was not persisted")
	}
}

func TestAccountServiceSignupAndLogin(t *testing.T) {
	userStore := &fakeUsers{}
	sessions := &fakeSessions{}
	service := NewAccountService(userStore, fakeSchools{}, sessions, &fakeTokens{}, time.Hour, time.Hour, time.Hour)

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
	if userStore.verificationToken == "" {
		t.Fatal("signup did not persist a verification token delivery intent")
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

func TestAccountServiceResendVerificationIssuesAndSendsFreshToken(t *testing.T) {
	userStore := &fakeUsers{profile: users.Profile{
		ID:    "user-id",
		Email: "player@example.com",
	}}
	tokens := &fakeTokens{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, tokens, time.Hour, 24*time.Hour, time.Hour)
	now := time.Date(2026, time.September, 4, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	if err := service.ResendVerification(context.Background(), " Player@Example.com "); err != nil {
		t.Fatalf("ResendVerification() error = %v", err)
	}
	if userStore.findEmail != "player@example.com" {
		t.Fatalf("FindByEmail() email = %q, want normalized email", userStore.findEmail)
	}
	if tokens.verificationUserID != "user-id" {
		t.Fatalf("verification token user = %q, want user-id", tokens.verificationUserID)
	}
	if !tokens.verificationExpiry.Equal(now.Add(24 * time.Hour)) {
		t.Fatalf("verification token expiry = %v, want %v", tokens.verificationExpiry, now.Add(24*time.Hour))
	}
	if tokens.verificationRecipient != "player@example.com" || tokens.verificationToken == "" {
		t.Fatalf("verification intent = (%q, %q), want recipient and token", tokens.verificationRecipient, tokens.verificationToken)
	}
	if string(tokens.verificationHash) != string(HashToken(tokens.verificationToken)) {
		t.Fatal("stored verification-token hash does not match the delivered token")
	}
}

func TestAccountServiceVerifyEmailUsesAtomicRepositoryTransition(t *testing.T) {
	userStore := &fakeUsers{profile: users.Profile{ID: "user-id"}}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	if err := service.VerifyEmail(context.Background(), "verification-token"); err != nil {
		t.Fatalf("VerifyEmail() error = %v", err)
	}
	if userStore.verifyEmailCalls != 1 {
		t.Fatalf("VerifyEmailByToken() calls = %d, want 1", userStore.verifyEmailCalls)
	}
	if !bytes.Equal(userStore.verifiedTokenHash, HashToken("verification-token")) {
		t.Fatal("VerifyEmail() did not pass the token hash to the atomic repository transition")
	}
	if !userStore.verifiedAt.Equal(now) {
		t.Fatalf("verification time = %v, want %v", userStore.verifiedAt, now)
	}
}

func TestAccountServiceVerifyEmailMapsMissingReplayAndDeletedUser(t *testing.T) {
	for _, scenario := range []string{"missing token", "replayed token", "deleted user"} {
		t.Run(scenario, func(t *testing.T) {
			userStore := &fakeUsers{verifyEmailErr: pgx.ErrNoRows}
			service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)

			if err := service.VerifyEmail(context.Background(), "verification-token"); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyEmail() error = %v, want ErrInvalidToken", err)
			}
		})
	}
}

func TestAccountServiceUpdateProfileUsesAtomicRepositoryTransition(t *testing.T) {
	userStore := &fakeUsers{profile: users.Profile{ID: "user-id", Name: "Old Name", Timezone: "UTC"}}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)
	update := users.ProfileUpdate{Name: "New Name", Bio: "New bio", Timezone: "America/Los_Angeles"}
	links := []users.SocialLink{{Label: "Discord", URL: "https://discord.com/users/player"}}

	profile, err := service.UpdateProfile(context.Background(), "user-id", update, links)
	if err != nil {
		t.Fatalf("UpdateProfile() error = %v", err)
	}
	if userStore.updateProfileWithLinksCalls != 1 {
		t.Fatalf("UpdateProfileWithSocialLinks() calls = %d, want 1", userStore.updateProfileWithLinksCalls)
	}
	if profile.Name != update.Name || profile.Bio != update.Bio || profile.Timezone != update.Timezone {
		t.Fatalf("updated profile = %#v, want fields from %#v", profile, update)
	}
	if len(profile.SocialLinks) != 1 || profile.SocialLinks[0].Label != "Discord" {
		t.Fatalf("updated social links = %#v, want submitted links", profile.SocialLinks)
	}
}

func TestAccountServiceSignupPersistsHomeSchoolAndAgeConfirmation(t *testing.T) {
	userStore := &fakeUsers{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)
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
	if userStore.verificationExpiry != confirmedAt.Add(time.Hour) || len(userStore.verificationHash) == 0 {
		t.Fatalf("atomic signup token = (%x, %v), want a hash expiring at %v", userStore.verificationHash, userStore.verificationExpiry, confirmedAt.Add(time.Hour))
	}
}

func TestAccountServiceResetPasswordStoresHash(t *testing.T) {
	userStore := &fakeUsers{}
	tokens := &fakeTokens{}
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, tokens, time.Hour, time.Hour, time.Hour)

	if err := service.ResetPassword(context.Background(), "reset-token", "12345678"); err != nil {
		t.Fatalf("ResetPassword() error = %v", err)
	}
	if tokens.resetPasswordHash == "12345678" || !ComparePassword(tokens.resetPasswordHash, "12345678") {
		t.Fatal("reset did not pass a password hash to the token store")
	}
}

func TestAccountServiceResetPasswordRejectsShortPassword(t *testing.T) {
	tokens := &fakeTokens{}
	service := NewAccountService(&fakeUsers{}, fakeSchools{}, &fakeSessions{}, tokens, time.Hour, time.Hour, time.Hour)

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
	service := NewAccountService(userStore, fakeSchools{}, &fakeSessions{}, &fakeTokens{}, time.Hour, time.Hour, time.Hour)

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
