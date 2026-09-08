// Package config loads API configuration from environment variables.
package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	localDatabaseURL   = "postgres://cgn:cgn@localhost:5432/cgn?sslmode=disable"
	composeDatabaseURL = "postgres://cgn:cgn@postgres:5432/cgn?sslmode=disable"
)

// DeploymentEnvironment controls whether local defaults are allowed.
type DeploymentEnvironment string

const (
	DeploymentLocal      DeploymentEnvironment = "local"
	DeploymentStaging    DeploymentEnvironment = "staging"
	DeploymentProduction DeploymentEnvironment = "production"
)

// Strict reports whether production-strength startup validation is enabled.
func (environment DeploymentEnvironment) Strict() bool {
	return environment == DeploymentStaging || environment == DeploymentProduction
}

type Config struct {
	DeploymentEnvironment DeploymentEnvironment
	HTTPAddr              string
	DatabaseURL           string
	DBHost                string
	DBPort                string
	DBConnectTimeout      time.Duration
	SessionCookie         string
	SessionTTL            time.Duration
	CookieSecure          bool
	VerificationTTL       time.Duration
	ResetTTL              time.Duration
	SiteURL               string
	ResendAPIKey          string
	AccountEmailFrom      string
	EventsEmailFrom       string
	AuthRateLimit         int
	AuthRateWindow        time.Duration
	DBMaxConns            int32
	CatalogRefresh        time.Duration
	MaintenanceToken      string
	ProxySharedSecret     string
}

// Load reads and validates API configuration from the environment.
func Load() (Config, error) {
	deploymentEnvironment, err := parseDeploymentEnvironment(
		getenv("DEPLOYMENT_ENV", string(DeploymentLocal)),
	)
	if err != nil {
		return Config{}, err
	}

	timeout, err := parsePositiveDuration("API_DB_CONNECT_TIMEOUT", "2s")
	if err != nil {
		return Config{}, err
	}

	port := getenv("API_DB_PORT", "5432")
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return Config{}, fmt.Errorf("parse API_DB_PORT: must be an integer from 1 to 65535")
	}

	cookieSecure, err := strconv.ParseBool(getenv("API_COOKIE_SECURE", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_COOKIE_SECURE: must be true or false")
	}

	sessionTTL, err := parsePositiveDuration("API_SESSION_TTL", "720h")
	if err != nil {
		return Config{}, err
	}

	verificationTTL, err := parsePositiveDuration("API_VERIFICATION_TTL", "24h")
	if err != nil {
		return Config{}, err
	}

	resetTTL, err := parsePositiveDuration("API_RESET_TTL", "1h")
	if err != nil {
		return Config{}, err
	}

	authRateLimit, err := strconv.Atoi(getenv("API_AUTH_RATE_LIMIT", "5"))
	if err != nil || authRateLimit < 1 {
		return Config{}, fmt.Errorf("parse API_AUTH_RATE_LIMIT: must be a positive integer")
	}

	authRateWindow, err := parsePositiveDuration("API_AUTH_RATE_WINDOW", "15m")
	if err != nil {
		return Config{}, err
	}

	catalogRefresh, err := parsePositiveDuration("API_CATALOG_REFRESH_INTERVAL", "24h")
	if err != nil {
		return Config{}, err
	}

	// 0 means "unset"; db.Open applies its own default rather than config
	// depending on the db package.
	dbMaxConns, err := strconv.Atoi(getenv("API_DB_MAX_CONNS", "0"))
	if err != nil || dbMaxConns < 0 {
		return Config{}, fmt.Errorf("parse API_DB_MAX_CONNS: must be a non-negative integer")
	}

	cfg := Config{
		DeploymentEnvironment: deploymentEnvironment,
		HTTPAddr:              httpAddr(),
		DatabaseURL:           getenv("API_DATABASE_URL", localDatabaseURL),
		DBHost:                getenv("API_DB_HOST", "localhost"),
		DBPort:                port,
		DBConnectTimeout:      timeout,
		SessionCookie:         getenv("API_SESSION_COOKIE", "cgn_session"),
		SessionTTL:            sessionTTL,
		CookieSecure:          cookieSecure,
		VerificationTTL:       verificationTTL,
		ResetTTL:              resetTTL,
		SiteURL:               getenv("API_SITE_URL", "http://localhost:3000"),
		ResendAPIKey:          firstNonEmptyEnv("API_RESEND_API_KEY", "RESEND_API_KEY"),
		AccountEmailFrom:      getenv("API_ACCOUNT_EMAIL_FROM", "account@campusgamingnetwork.com"),
		EventsEmailFrom:       getenv("API_EVENTS_EMAIL_FROM", "events@campusgamingnetwork.com"),
		AuthRateLimit:         authRateLimit,
		AuthRateWindow:        authRateWindow,
		DBMaxConns:            int32(dbMaxConns),
		CatalogRefresh:        catalogRefresh,
		MaintenanceToken:      os.Getenv("API_MAINTENANCE_TOKEN"),
		ProxySharedSecret:     os.Getenv("API_PROXY_SHARED_SECRET"),
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func parseDeploymentEnvironment(raw string) (DeploymentEnvironment, error) {
	environment := DeploymentEnvironment(strings.ToLower(strings.TrimSpace(raw)))
	switch environment {
	case DeploymentLocal, DeploymentStaging, DeploymentProduction:
		return environment, nil
	default:
		return "", fmt.Errorf("parse DEPLOYMENT_ENV: must be local, staging, or production")
	}
}

func parsePositiveDuration(key, fallback string) (time.Duration, error) {
	value, err := time.ParseDuration(getenv(key, fallback))
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("parse %s: must be a positive duration", key)
	}
	return value, nil
}

func (cfg Config) validate() error {
	issues := make([]string, 0)

	siteURL, siteURLValid := parseSiteURL(cfg.SiteURL)
	if !siteURLValid {
		issues = append(issues, "API_SITE_URL must be an absolute HTTP(S) origin")
	}

	databaseURL, databaseURLValid := parseDatabaseURL(cfg.DatabaseURL)
	if !databaseURLValid {
		issues = append(issues, "API_DATABASE_URL must be a postgres URL with a host and database name")
	}

	if !validCookieName(cfg.SessionCookie) {
		issues = append(issues, "API_SESSION_COOKIE must be a valid cookie name")
	}
	if !validSenderAddress(cfg.AccountEmailFrom) {
		issues = append(issues, "API_ACCOUNT_EMAIL_FROM must be one valid sender address")
	}
	if !validSenderAddress(cfg.EventsEmailFrom) {
		issues = append(issues, "API_EVENTS_EMAIL_FROM must be one valid sender address")
	}

	if cfg.DeploymentEnvironment.Strict() {
		if !configured("API_DATABASE_URL") {
			issues = append(issues, "API_DATABASE_URL must be set")
		} else if databaseURLValid && (isLocalHostname(databaseURL.Hostname()) || isDefaultDatabaseURL(cfg.DatabaseURL)) {
			issues = append(issues, "API_DATABASE_URL must not target a local or default database")
		}

		if !configured("API_SITE_URL") {
			issues = append(issues, "API_SITE_URL must be set")
		} else if siteURLValid {
			if !strings.EqualFold(siteURL.Scheme, "https") {
				issues = append(issues, "API_SITE_URL must use HTTPS")
			}
			if isLocalHostname(siteURL.Hostname()) {
				issues = append(issues, "API_SITE_URL must not use a local hostname")
			}
		}

		if !configured("API_SESSION_COOKIE") {
			issues = append(issues, "API_SESSION_COOKIE must be set")
		}
		if !cfg.CookieSecure {
			issues = append(issues, "API_COOKIE_SECURE must be true")
		}
		if strings.TrimSpace(cfg.ResendAPIKey) == "" {
			issues = append(issues, "API_RESEND_API_KEY (or RESEND_API_KEY) must be set")
		}
		if !configured("API_ACCOUNT_EMAIL_FROM") {
			issues = append(issues, "API_ACCOUNT_EMAIL_FROM must be set")
		}
		if !configured("API_EVENTS_EMAIL_FROM") {
			issues = append(issues, "API_EVENTS_EMAIL_FROM must be set")
		}
		if len(strings.TrimSpace(cfg.ProxySharedSecret)) < 32 {
			issues = append(issues, "API_PROXY_SHARED_SECRET must contain at least 32 characters")
		}
	}

	if len(issues) == 0 {
		return nil
	}

	return fmt.Errorf(
		"unsafe %s configuration: %s",
		cfg.DeploymentEnvironment,
		strings.Join(issues, "; "),
	)
}

func parseSiteURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return nil, false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, false
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, false
	}
	return parsed, true
}

func parseDatabaseURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || parsed.Fragment != "" {
		return nil, false
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return nil, false
	}
	if strings.Trim(parsed.Path, "/") == "" {
		return nil, false
	}
	return parsed, true
}

func validCookieName(value string) bool {
	if value == "" {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character < 0x21 || character > 0x7e || strings.ContainsRune("()<>@,;:\\\"/[]?={} \t", rune(character)) {
			return false
		}
	}
	return true
}

func validSenderAddress(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address != ""
}

func isLocalHostname(hostname string) bool {
	hostname = strings.ToLower(strings.TrimSuffix(hostname, "."))
	return hostname == "localhost" ||
		strings.HasSuffix(hostname, ".localhost") ||
		hostname == "::1" ||
		hostname == "::" ||
		hostname == "0.0.0.0" ||
		strings.HasPrefix(hostname, "127.")
}

func isDefaultDatabaseURL(value string) bool {
	return value == localDatabaseURL || value == composeDatabaseURL
}

func configured(key string) bool {
	return strings.TrimSpace(os.Getenv(key)) != ""
}

func httpAddr() string {
	if value := os.Getenv("API_HTTP_ADDR"); value != "" {
		return value
	}
	if port := os.Getenv("PORT"); port != "" {
		return ":" + port
	}
	return ":8080"
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := os.Getenv(key); strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}
