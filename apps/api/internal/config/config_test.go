package config

import (
	"strings"
	"testing"
)

var configurationEnvironmentKeys = []string{
	"DEPLOYMENT_ENV",
	"API_HTTP_ADDR",
	"PORT",
	"API_DATABASE_URL",
	"API_DB_HOST",
	"API_DB_PORT",
	"API_DB_CONNECT_TIMEOUT",
	"API_DB_MAX_CONNS",
	"API_SESSION_COOKIE",
	"API_SESSION_TTL",
	"API_COOKIE_SECURE",
	"API_VERIFICATION_TTL",
	"API_RESET_TTL",
	"API_SITE_URL",
	"API_RESEND_API_KEY",
	"RESEND_API_KEY",
	"API_ACCOUNT_EMAIL_FROM",
	"API_EVENTS_EMAIL_FROM",
	"API_AUTH_RATE_LIMIT",
	"API_AUTH_RATE_WINDOW",
	"API_CATALOG_REFRESH_INTERVAL",
	"API_MAINTENANCE_TOKEN",
	"API_PROXY_SHARED_SECRET",
}

func TestLoadAllowsDeliberateLocalDefaults(t *testing.T) {
	clearConfigurationEnvironment(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DeploymentEnvironment != DeploymentLocal {
		t.Fatalf("DeploymentEnvironment = %q, want %q", cfg.DeploymentEnvironment, DeploymentLocal)
	}
	if cfg.ResendAPIKey != "" {
		t.Fatalf("ResendAPIKey = %q, want empty local default", cfg.ResendAPIKey)
	}
	if cfg.CookieSecure {
		t.Fatal("CookieSecure = true, want false local default")
	}
}

func TestLoadEnablesStrictValidationForStagingAndProduction(t *testing.T) {
	for _, environment := range []string{"staging", "production"} {
		t.Run(environment, func(t *testing.T) {
			clearConfigurationEnvironment(t)
			setConfigurationEnvironment(t, validStrictEnvironment(environment))

			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if !cfg.DeploymentEnvironment.Strict() {
				t.Fatalf("DeploymentEnvironment.Strict() = false for %q", cfg.DeploymentEnvironment)
			}
		})
	}
}

func TestLoadRejectsUnsafeProductionSettings(t *testing.T) {
	tests := []struct {
		name    string
		values  map[string]string
		wantErr string
	}{
		{name: "unknown deployment environment", values: map[string]string{"DEPLOYMENT_ENV": "preview"}, wantErr: "DEPLOYMENT_ENV"},
		{name: "missing database URL", values: map[string]string{"API_DATABASE_URL": ""}, wantErr: "API_DATABASE_URL must be set"},
		{name: "malformed database URL", values: map[string]string{"API_DATABASE_URL": "://hidden-database-value"}, wantErr: "API_DATABASE_URL must be a postgres URL"},
		{name: "local database URL", values: map[string]string{"API_DATABASE_URL": localDatabaseURL}, wantErr: "API_DATABASE_URL must not target a local or default database"},
		{name: "Compose default database URL", values: map[string]string{"API_DATABASE_URL": composeDatabaseURL}, wantErr: "API_DATABASE_URL must not target a local or default database"},
		{name: "missing site URL", values: map[string]string{"API_SITE_URL": ""}, wantErr: "API_SITE_URL must be set"},
		{name: "malformed site URL", values: map[string]string{"API_SITE_URL": "campusgamingnetwork.com"}, wantErr: "API_SITE_URL must be an absolute HTTP(S) origin"},
		{name: "site URL with path", values: map[string]string{"API_SITE_URL": "https://campusgamingnetwork.com/app"}, wantErr: "API_SITE_URL must be an absolute HTTP(S) origin"},
		{name: "insecure site URL", values: map[string]string{"API_SITE_URL": "http://campusgamingnetwork.com"}, wantErr: "API_SITE_URL must use HTTPS"},
		{name: "local site URL", values: map[string]string{"API_SITE_URL": "https://localhost"}, wantErr: "API_SITE_URL must not use a local hostname"},
		{name: "missing session cookie name", values: map[string]string{"API_SESSION_COOKIE": ""}, wantErr: "API_SESSION_COOKIE must be set"},
		{name: "invalid session cookie name", values: map[string]string{"API_SESSION_COOKIE": "bad cookie"}, wantErr: "API_SESSION_COOKIE must be a valid cookie name"},
		{name: "insecure session cookie", values: map[string]string{"API_COOKIE_SECURE": "false"}, wantErr: "API_COOKIE_SECURE must be true"},
		{name: "missing resend key", values: map[string]string{"API_RESEND_API_KEY": "", "RESEND_API_KEY": ""}, wantErr: "API_RESEND_API_KEY"},
		{name: "missing account sender", values: map[string]string{"API_ACCOUNT_EMAIL_FROM": ""}, wantErr: "API_ACCOUNT_EMAIL_FROM must be set"},
		{name: "invalid account sender", values: map[string]string{"API_ACCOUNT_EMAIL_FROM": "not-an-address"}, wantErr: "API_ACCOUNT_EMAIL_FROM must be one valid sender address"},
		{name: "missing events sender", values: map[string]string{"API_EVENTS_EMAIL_FROM": ""}, wantErr: "API_EVENTS_EMAIL_FROM must be set"},
		{name: "invalid events sender", values: map[string]string{"API_EVENTS_EMAIL_FROM": "not-an-address"}, wantErr: "API_EVENTS_EMAIL_FROM must be one valid sender address"},
		{name: "short proxy secret", values: map[string]string{"API_PROXY_SHARED_SECRET": "short-secret"}, wantErr: "API_PROXY_SHARED_SECRET must contain at least 32 characters"},
		{name: "invalid database port", values: map[string]string{"API_DB_PORT": "0"}, wantErr: "API_DB_PORT"},
		{name: "non-positive database timeout", values: map[string]string{"API_DB_CONNECT_TIMEOUT": "0s"}, wantErr: "API_DB_CONNECT_TIMEOUT"},
		{name: "non-positive session TTL", values: map[string]string{"API_SESSION_TTL": "0s"}, wantErr: "API_SESSION_TTL"},
		{name: "non-positive verification TTL", values: map[string]string{"API_VERIFICATION_TTL": "0s"}, wantErr: "API_VERIFICATION_TTL"},
		{name: "non-positive reset TTL", values: map[string]string{"API_RESET_TTL": "0s"}, wantErr: "API_RESET_TTL"},
		{name: "non-positive auth rate limit", values: map[string]string{"API_AUTH_RATE_LIMIT": "0"}, wantErr: "API_AUTH_RATE_LIMIT"},
		{name: "non-positive auth rate window", values: map[string]string{"API_AUTH_RATE_WINDOW": "0s"}, wantErr: "API_AUTH_RATE_WINDOW"},
		{name: "negative database connections", values: map[string]string{"API_DB_MAX_CONNS": "-1"}, wantErr: "API_DB_MAX_CONNS"},
		{name: "non-positive catalog refresh", values: map[string]string{"API_CATALOG_REFRESH_INTERVAL": "0s"}, wantErr: "API_CATALOG_REFRESH_INTERVAL"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearConfigurationEnvironment(t)
			setConfigurationEnvironment(t, validStrictEnvironment("production"))
			setConfigurationEnvironment(t, tt.values)

			_, err := Load()
			if err == nil {
				t.Fatal("Load() error = nil, want unsafe configuration error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("Load() error = %q, want it to contain %q", err, tt.wantErr)
			}
		})
	}
}

func TestLoadDoesNotExposeSecretsInValidationErrors(t *testing.T) {
	clearConfigurationEnvironment(t)
	setConfigurationEnvironment(t, validStrictEnvironment("production"))
	secret := "do-not-log-this-secret"
	t.Setenv("API_PROXY_SHARED_SECRET", secret)

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want short-secret validation error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("Load() error exposed a secret: %q", err)
	}
}

func TestLoadUsesRailwayPortWhenHTTPAddressIsUnset(t *testing.T) {
	clearConfigurationEnvironment(t)
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
	clearConfigurationEnvironment(t)
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
	clearConfigurationEnvironment(t)
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
	clearConfigurationEnvironment(t)
	t.Setenv("API_PROXY_SHARED_SECRET", "test-shared-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ProxySharedSecret != "test-shared-secret" {
		t.Fatalf("ProxySharedSecret = %q, want configured secret", cfg.ProxySharedSecret)
	}
}

func validStrictEnvironment(environment string) map[string]string {
	return map[string]string{
		"DEPLOYMENT_ENV":          environment,
		"API_DATABASE_URL":        "postgres://cgn:password@postgres.internal:5432/cgn?sslmode=require",
		"API_SITE_URL":            "https://campusgamingnetwork.com",
		"API_SESSION_COOKIE":      "cgn_session",
		"API_COOKIE_SECURE":       "true",
		"API_RESEND_API_KEY":      "re_test_value",
		"API_ACCOUNT_EMAIL_FROM":  "CGN Accounts <account@campusgamingnetwork.com>",
		"API_EVENTS_EMAIL_FROM":   "CGN Events <events@campusgamingnetwork.com>",
		"API_PROXY_SHARED_SECRET": "01234567890123456789012345678901",
	}
}

func clearConfigurationEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range configurationEnvironmentKeys {
		t.Setenv(key, "")
	}
}

func setConfigurationEnvironment(t *testing.T, environment map[string]string) {
	t.Helper()
	for key, value := range environment {
		t.Setenv(key, value)
	}
}
