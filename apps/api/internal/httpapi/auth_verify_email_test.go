package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

const verificationTestUserID = "11111111-1111-1111-1111-111111111111"

type verificationUsers struct {
	*passV0ContractUsers
	verifiedCalls int
	verifiedID    string
}

func (u *verificationUsers) MarkEmailVerified(_ context.Context, userID string) error {
	u.verifiedCalls++
	u.verifiedID = userID
	return nil
}

type verificationTokens struct {
	validHash    []byte
	consumed     bool
	consumeCalls int
}

func (*verificationTokens) CreateEmailVerificationToken(context.Context, string, []byte, time.Time) error {
	return nil
}

func (t *verificationTokens) ConsumeEmailVerificationToken(_ context.Context, tokenHash []byte, _ time.Time) (string, error) {
	t.consumeCalls++
	if t.consumed || !bytes.Equal(tokenHash, t.validHash) {
		return "", pgx.ErrNoRows
	}

	t.consumed = true
	return verificationTestUserID, nil
}

func (*verificationTokens) CreatePasswordResetToken(context.Context, string, []byte, time.Time) error {
	return nil
}

func (*verificationTokens) UsePasswordResetToken(context.Context, []byte, time.Time, string) error {
	return nil
}

func TestVerifyEmailRequiresOneTimePost(t *testing.T) {
	router, userStore, tokenStore := newVerificationRouter("valid-token")
	handler := http.HandlerFunc(router.handleVerifyEmail)

	t.Run("GET cannot consume the token", func(t *testing.T) {
		response := serveContractRequest(
			handler,
			httptest.NewRequest(http.MethodGet, "/auth/verify-email?token=valid-token", nil),
		)

		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
		}
		if got := response.Header().Get("Allow"); got != http.MethodPost {
			t.Fatalf("Allow = %q, want %q", got, http.MethodPost)
		}
		if tokenStore.consumeCalls != 0 || userStore.verifiedCalls != 0 {
			t.Fatalf("GET mutated verification state: consume calls = %d, verified calls = %d", tokenStore.consumeCalls, userStore.verifiedCalls)
		}
	})

	t.Run("valid POST consumes and verifies exactly once", func(t *testing.T) {
		response := serveContractRequest(
			handler,
			httptest.NewRequest(http.MethodPost, "/auth/verify-email", strings.NewReader(`{"token":"valid-token"}`)),
		)

		payload := requireJSONContract(t, response, http.StatusOK, []string{"status"})
		requireStringContract(t, payload, "status", "verified")
		if tokenStore.consumeCalls != 1 || userStore.verifiedCalls != 1 {
			t.Fatalf("POST calls = consume %d, verified %d; want 1 each", tokenStore.consumeCalls, userStore.verifiedCalls)
		}
		if userStore.verifiedID != verificationTestUserID {
			t.Fatalf("verified user = %q, want %q", userStore.verifiedID, verificationTestUserID)
		}
	})

	t.Run("replayed POST is rejected", func(t *testing.T) {
		response := serveContractRequest(
			handler,
			httptest.NewRequest(http.MethodPost, "/auth/verify-email", strings.NewReader(`{"token":"valid-token"}`)),
		)

		payload := requireJSONContract(t, response, http.StatusBadRequest, []string{"error"})
		requireStringContract(t, payload, "error", "invalid_or_expired_token")
		if tokenStore.consumeCalls != 2 || userStore.verifiedCalls != 1 {
			t.Fatalf("replay calls = consume %d, verified %d; want 2 and 1", tokenStore.consumeCalls, userStore.verifiedCalls)
		}
	})
}

func TestVerifyEmailRejectsMissingAndAlteredTokens(t *testing.T) {
	for _, test := range []struct {
		name             string
		target           string
		body             string
		wantConsumeCalls int
	}{
		{
			name:             "missing body token",
			target:           "/auth/verify-email",
			body:             `{}`,
			wantConsumeCalls: 0,
		},
		{
			name:             "query token is ignored",
			target:           "/auth/verify-email?token=valid-token",
			body:             `{}`,
			wantConsumeCalls: 0,
		},
		{
			name:             "altered body token",
			target:           "/auth/verify-email",
			body:             `{"token":"altered-token"}`,
			wantConsumeCalls: 1,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			router, userStore, tokenStore := newVerificationRouter("valid-token")
			response := serveContractRequest(
				http.HandlerFunc(router.handleVerifyEmail),
				httptest.NewRequest(http.MethodPost, test.target, strings.NewReader(test.body)),
			)

			payload := requireJSONContract(t, response, http.StatusBadRequest, []string{"error"})
			requireStringContract(t, payload, "error", "invalid_or_expired_token")
			if tokenStore.consumeCalls != test.wantConsumeCalls {
				t.Fatalf("consume calls = %d, want %d", tokenStore.consumeCalls, test.wantConsumeCalls)
			}
			if userStore.verifiedCalls != 0 {
				t.Fatalf("verified calls = %d, want 0", userStore.verifiedCalls)
			}
		})
	}
}

func newVerificationRouter(rawToken string) (*Router, *verificationUsers, *verificationTokens) {
	userStore := &verificationUsers{passV0ContractUsers: &passV0ContractUsers{}}
	tokenStore := &verificationTokens{validHash: auth.HashToken(rawToken)}
	account := auth.NewAccountService(
		userStore,
		passV0ContractSchools{},
		passV0ContractSessions{},
		tokenStore,
		passV0ContractMailer{},
		time.Hour,
		time.Hour,
		time.Hour,
	)

	return &Router{account: account}, userStore, tokenStore
}

var _ users.AccountRepository = (*verificationUsers)(nil)
var _ auth.TokenStore = (*verificationTokens)(nil)
