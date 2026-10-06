package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/policies"
)

type fakePolicyRepository struct {
	current         policies.Current
	acceptances     []policies.Acceptance
	acceptancesUser string
}

func (repository *fakePolicyRepository) Current(context.Context, time.Time) (policies.Current, error) {
	return repository.current, nil
}

func (repository *fakePolicyRepository) ListAcceptances(_ context.Context, userID string) ([]policies.Acceptance, error) {
	repository.acceptancesUser = userID
	return repository.acceptances, nil
}

func TestCurrentPoliciesReturnsThePublishedVersionsWithoutInternalIDs(t *testing.T) {
	effectiveAt := time.Date(2026, time.October, 6, 0, 0, 0, 0, time.UTC)
	router := &Router{policies: &fakePolicyRepository{current: policies.Current{
		Terms:   policies.Document{ID: "terms-id", Type: policies.TypeTerms, Version: "terms-v1", EffectiveAt: effectiveAt, ContentSHA256: "aa"},
		Privacy: policies.Document{ID: "privacy-id", Type: policies.TypePrivacy, Version: "privacy-v1", EffectiveAt: effectiveAt, ContentSHA256: "bb"},
	}}}
	response := httptest.NewRecorder()

	router.handleCurrentPolicies(response, httptest.NewRequest(http.MethodGet, "/policies/current", nil))

	var payload map[string]map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v; body = %s", err, response.Body.String())
	}
	want := map[string]map[string]any{
		"terms":   {"version": "terms-v1", "effective_at": "2026-10-06T00:00:00Z", "content_sha256": "aa"},
		"privacy": {"version": "privacy-v1", "effective_at": "2026-10-06T00:00:00Z", "content_sha256": "bb"},
	}
	if response.Code != http.StatusOK || !reflect.DeepEqual(payload, want) {
		t.Fatalf("response = %d %v, want 200 %v", response.Code, payload, want)
	}
}

func TestMyPolicyAcceptancesAreReadForTheSessionUserOnly(t *testing.T) {
	acceptedAt := time.Date(2026, time.October, 6, 12, 0, 0, 0, time.UTC)
	repository := &fakePolicyRepository{acceptances: []policies.Acceptance{
		{DocumentType: policies.TypeTerms, Version: "terms-v1", AcceptedAt: acceptedAt, Source: policies.SourceSignup},
	}}
	router := &Router{
		cfg:      config.Config{SessionCookie: "session", SessionTTL: time.Hour},
		policies: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID: "session-id", UserID: testUserID, ExpiresAt: time.Now().Add(time.Hour),
	}}
	handler := auth.WithSession(store, auth.SessionCookieConfig{Name: "session", TTL: time.Hour})(
		http.HandlerFunc(router.handleMyPolicyAcceptances),
	)

	anonymous := httptest.NewRecorder()
	router.handleMyPolicyAcceptances(anonymous, httptest.NewRequest(http.MethodGet, "/me/policy-acceptances", nil))
	if anonymous.Code != http.StatusUnauthorized || repository.acceptancesUser != "" {
		t.Fatalf("anonymous response = %d, read for %q; want 401 and no read", anonymous.Code, repository.acceptancesUser)
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authenticatedEventRequest(http.MethodGet, "/me/policy-acceptances", ""))

	var payload struct {
		Acceptances []policies.Acceptance `json:"acceptances"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v; body = %s", err, response.Body.String())
	}
	if response.Code != http.StatusOK || repository.acceptancesUser != testUserID ||
		!reflect.DeepEqual(payload.Acceptances, repository.acceptances) ||
		response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("response = %d %#v for %q, cache %q", response.Code, payload.Acceptances, repository.acceptancesUser, response.Header().Get("Cache-Control"))
	}
}
