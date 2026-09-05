package config

import "testing"

func TestLoadUsesRailwayPortWhenHTTPAddressIsUnset(t *testing.T) {
	t.Setenv("API_HTTP_ADDR", "")
	t.Setenv("PORT", "4321")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != ":4321" {
		t.Fatalf("HTTPAddr = %q, want %q", cfg.HTTPAddr, ":4321")
	}
}

func TestLoadPrefersNamespacedResendAPIKey(t *testing.T) {
	t.Setenv("API_RESEND_API_KEY", "namespaced-key")
	t.Setenv("RESEND_API_KEY", "legacy-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ResendAPIKey != "namespaced-key" {
		t.Fatalf("ResendAPIKey = %q, want namespaced key", cfg.ResendAPIKey)
	}
}

func TestLoadAcceptsLegacyResendAPIKey(t *testing.T) {
	t.Setenv("API_RESEND_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "legacy-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ResendAPIKey != "legacy-key" {
		t.Fatalf("ResendAPIKey = %q, want legacy key", cfg.ResendAPIKey)
	}
}

func TestLoadReadsBFFProxySharedSecret(t *testing.T) {
	t.Setenv("API_PROXY_SHARED_SECRET", "test-shared-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ProxySharedSecret != "test-shared-secret" {
		t.Fatalf("ProxySharedSecret = %q, want configured secret", cfg.ProxySharedSecret)
	}
}
