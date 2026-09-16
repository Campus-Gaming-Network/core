package adminsession

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeRepository struct {
	created       CreateParams
	session       Session
	findErr       error
	seenHash      []byte
	revokedHash   []byte
	revokedReason string
}

func (r *fakeRepository) CreateSession(_ context.Context, params CreateParams) error {
	r.created = params
	return nil
}

func (r *fakeRepository) FindAndTouchSession(_ context.Context, tokenHash []byte, _ time.Time, _ time.Time) (Session, error) {
	r.seenHash = tokenHash
	return r.session, r.findErr
}

func (r *fakeRepository) RevokeSession(_ context.Context, tokenHash []byte, _ time.Time, reason string) error {
	r.revokedHash = tokenHash
	r.revokedReason = reason
	return nil
}

func TestServiceStartsIsolatedCloudflareSession(t *testing.T) {
	repository := &fakeRepository{}
	service, err := NewService(repository, 30*time.Minute, 8*time.Hour)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	fixedNow := time.Date(2026, time.September, 15, 10, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }

	credential, err := service.Start(context.Background(), StartInput{
		UserID: "user-id", GrantID: "grant-id",
		AccessIssuer:  "https://cgn.cloudflareaccess.com",
		AccessSubject: "access-subject", AccessEmail: " ADMIN@Example.test ",
	})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if credential.Token == "" || credential.CSRFToken == "" || credential.Token == credential.CSRFToken ||
		credential.ExpiresAt != fixedNow.Add(8*time.Hour) {
		t.Fatalf("credential = %#v", credential)
	}
	if repository.created.AuthnMethod != AuthMethodCloudflareAccess ||
		repository.created.AccessIssuer != "https://cgn.cloudflareaccess.com" ||
		repository.created.AccessEmail != "admin@example.test" ||
		len(repository.created.CSRFTokenHash) == 0 ||
		repository.created.IdleExpiresAt != fixedNow.Add(30*time.Minute) ||
		string(repository.created.TokenHash) == credential.Token {
		t.Fatalf("created session = %#v", repository.created)
	}
}

func TestServiceRejectsInvalidConfigurationAndInput(t *testing.T) {
	if _, err := NewService(nil, 30*time.Minute, 8*time.Hour); !errors.Is(err, ErrInvalidSessionInput) {
		t.Fatalf("NewService(nil) error = %v", err)
	}
	if _, err := NewService(&fakeRepository{}, 9*time.Hour, 8*time.Hour); !errors.Is(err, ErrInvalidSessionInput) {
		t.Fatalf("NewService(invalid TTLs) error = %v", err)
	}
	service, _ := NewService(&fakeRepository{}, 30*time.Minute, 8*time.Hour)
	if _, err := service.Start(context.Background(), StartInput{}); !errors.Is(err, ErrInvalidSessionInput) {
		t.Fatalf("Start(empty) error = %v", err)
	}
}

func TestWithSessionAddsAdminPrincipalAndHashesCredential(t *testing.T) {
	now := time.Now()
	repository := &fakeRepository{session: Session{
		ID: "session-id", UserID: "user-id", GrantID: "grant-id",
		AuthnMethod:   AuthMethodCloudflareAccess,
		AccessIssuer:  "https://cgn.cloudflareaccess.com",
		AccessSubject: "subject", AccessEmail: "admin@example.test",
		CSRFTokenHash: HashToken("csrf-token"), AuthenticatedAt: now,
		IdleExpiresAt: now.Add(time.Hour), AbsoluteExpiresAt: now.Add(2 * time.Hour),
	}}
	service, _ := NewService(repository, 30*time.Minute, 8*time.Hour)
	service.now = func() time.Time { return now }

	var got Principal
	handler := WithSession(service, CookieConfig{Name: ProductionCookieName, Secure: true})(
		http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			got, _ = Require(req.Context())
			w.WriteHeader(http.StatusNoContent)
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: ProductionCookieName, Value: "raw-admin-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if got.UserID != "user-id" || got.GrantID != "grant-id" || got.SessionID != "session-id" {
		t.Fatalf("principal = %#v", got)
	}
	if string(repository.seenHash) == "raw-admin-token" {
		t.Fatal("middleware passed the raw admin token to the repository")
	}
}

func TestAuthenticateFailsAtIdleAndAbsoluteBoundaries(t *testing.T) {
	now := time.Date(2026, time.September, 15, 12, 0, 0, 0, time.UTC)
	valid := Session{
		ID: "session-id", UserID: "user-id", GrantID: "grant-id",
		AuthnMethod:   AuthMethodCloudflareAccess,
		IdleExpiresAt: now.Add(time.Minute), AbsoluteExpiresAt: now.Add(time.Hour),
	}
	for _, test := range []struct {
		name   string
		mutate func(*Session)
	}{
		{name: "idle boundary", mutate: func(session *Session) { session.IdleExpiresAt = now }},
		{name: "absolute boundary", mutate: func(session *Session) { session.AbsoluteExpiresAt = now }},
		{name: "wrong auth method", mutate: func(session *Session) { session.AuthnMethod = "password" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := valid
			test.mutate(&session)
			service, _ := NewService(&fakeRepository{session: session}, 30*time.Minute, 8*time.Hour)
			service.now = func() time.Time { return now }
			if _, err := service.Authenticate(context.Background(), "raw-token"); !errors.Is(err, ErrUnauthenticated) {
				t.Fatalf("Authenticate() error = %v, want ErrUnauthenticated", err)
			}
		})
	}
}

func TestAuthenticatePreservesRepositoryFailure(t *testing.T) {
	want := errors.New("database unavailable")
	service, _ := NewService(&fakeRepository{findErr: want}, 30*time.Minute, 8*time.Hour)
	if _, err := service.Authenticate(context.Background(), "raw-token"); !errors.Is(err, want) {
		t.Fatalf("Authenticate() error = %v, want repository failure", err)
	}
}

func TestWithSessionClearsRejectedCredential(t *testing.T) {
	repository := &fakeRepository{findErr: ErrUnauthenticated}
	service, _ := NewService(repository, 30*time.Minute, 8*time.Hour)
	handler := WithSession(service, CookieConfig{Name: ProductionCookieName, Secure: true})(
		http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if _, err := Require(req.Context()); !errors.Is(err, ErrUnauthenticated) {
				t.Fatalf("Require() error = %v", err)
			}
			w.WriteHeader(http.StatusNoContent)
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: ProductionCookieName, Value: "expired"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	cookies := response.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != ProductionCookieName ||
		cookies[0].MaxAge != -1 || !cookies[0].Secure || !cookies[0].HttpOnly ||
		cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Domain != "" ||
		cookies[1].Name != ProductionCSRFCookieName || cookies[1].MaxAge != -1 {
		t.Fatalf("cleared cookie = %#v", cookies)
	}
}

func TestSetCookieUsesStrictHostOnlyPolicy(t *testing.T) {
	response := httptest.NewRecorder()
	SetCookie(response, CookieConfig{Name: ProductionCookieName, Secure: true}, Credential{
		Token: "secret", ExpiresAt: time.Now().Add(time.Hour),
	})
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != ProductionCookieName ||
		!cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/" ||
		cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Domain != "" {
		t.Fatalf("session cookie = %#v", cookies)
	}
}

func TestProductionCookieConfigFailsClosed(t *testing.T) {
	if err := ValidateProductionCookieConfig(CookieConfig{Secure: true}); err != nil {
		t.Fatalf("ValidateProductionCookieConfig(valid) error = %v", err)
	}
	for _, config := range []CookieConfig{
		{Secure: false},
		{Name: "cgn_admin_session", Secure: true},
		{CSRFName: "cgn_admin_csrf", Secure: true},
	} {
		if !errors.Is(ValidateProductionCookieConfig(config), ErrInvalidSessionInput) {
			t.Errorf("ValidateProductionCookieConfig(%#v) did not reject unsafe production config", config)
		}
	}
}

func TestCSRFCookieAndVerification(t *testing.T) {
	credential := Credential{
		Token: "session-secret", CSRFToken: "csrf-secret", ExpiresAt: time.Now().Add(time.Hour),
	}
	response := httptest.NewRecorder()
	SetCSRFCookie(response, CookieConfig{Secure: true}, credential)
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != ProductionCSRFCookieName ||
		cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode ||
		cookies[0].Domain != "" {
		t.Fatalf("CSRF cookie = %#v", cookies)
	}
	principal := Principal{CSRFTokenHash: HashToken(credential.CSRFToken)}
	if !VerifyCSRF(principal, credential.CSRFToken) || VerifyCSRF(principal, "wrong") ||
		VerifyCSRF(Principal{}, credential.CSRFToken) {
		t.Fatal("VerifyCSRF() did not enforce the stored hash")
	}
}

func TestServiceRevokesHashedCredential(t *testing.T) {
	repository := &fakeRepository{}
	service, _ := NewService(repository, 30*time.Minute, 8*time.Hour)
	if err := service.Revoke(context.Background(), "raw-token", "operator logout"); err != nil {
		t.Fatalf("Revoke() error = %v", err)
	}
	if string(repository.revokedHash) == "raw-token" || repository.revokedReason != "operator logout" {
		t.Fatalf("revoke = hash %q reason %q", repository.revokedHash, repository.revokedReason)
	}
}
