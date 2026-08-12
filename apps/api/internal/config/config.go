// Package config loads API configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr         string
	DatabaseURL      string
	DBHost           string
	DBPort           string
	DBConnectTimeout time.Duration
	SessionCookie    string
	SessionTTL       time.Duration
	CookieSecure     bool
	VerificationTTL  time.Duration
	ResetTTL         time.Duration
	SiteURL          string
	ResendAPIKey     string
	AccountEmailFrom string
	EventsEmailFrom  string
	AuthRateLimit    int
	AuthRateWindow   time.Duration
	DBMaxConns       int32
	CatalogRefresh   time.Duration
	MaintenanceToken string
}

// Load reads and validates API configuration from the environment.
func Load() (Config, error) {
	timeout, err := time.ParseDuration(getenv("API_DB_CONNECT_TIMEOUT", "2s"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_DB_CONNECT_TIMEOUT: %w", err)
	}

	port := getenv("API_DB_PORT", "5432")
	if _, err := strconv.Atoi(port); err != nil {
		return Config{}, fmt.Errorf("parse API_DB_PORT: %w", err)
	}

	cookieSecure, err := strconv.ParseBool(getenv("API_COOKIE_SECURE", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_COOKIE_SECURE: %w", err)
	}

	sessionTTL, err := time.ParseDuration(getenv("API_SESSION_TTL", "720h"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_SESSION_TTL: %w", err)
	}

	verificationTTL, err := time.ParseDuration(getenv("API_VERIFICATION_TTL", "24h"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_VERIFICATION_TTL: %w", err)
	}

	resetTTL, err := time.ParseDuration(getenv("API_RESET_TTL", "1h"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_RESET_TTL: %w", err)
	}

	authRateLimit, err := strconv.Atoi(getenv("API_AUTH_RATE_LIMIT", "5"))
	if err != nil || authRateLimit < 1 {
		return Config{}, fmt.Errorf("parse API_AUTH_RATE_LIMIT: must be a positive integer")
	}

	authRateWindow, err := time.ParseDuration(getenv("API_AUTH_RATE_WINDOW", "15m"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_AUTH_RATE_WINDOW: %w", err)
	}

	catalogRefresh, err := time.ParseDuration(getenv("API_CATALOG_REFRESH_INTERVAL", "24h"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_CATALOG_REFRESH_INTERVAL: %w", err)
	}

	// 0 means "unset"; db.Open applies its own default rather than config
	// depending on the db package.
	dbMaxConns, err := strconv.Atoi(getenv("API_DB_MAX_CONNS", "0"))
	if err != nil || dbMaxConns < 0 {
		return Config{}, fmt.Errorf("parse API_DB_MAX_CONNS: must be a non-negative integer")
	}

	return Config{
		HTTPAddr:         httpAddr(),
		DatabaseURL:      getenv("API_DATABASE_URL", "postgres://cgn:cgn@localhost:5432/cgn?sslmode=disable"),
		DBHost:           getenv("API_DB_HOST", "localhost"),
		DBPort:           port,
		DBConnectTimeout: timeout,
		SessionCookie:    getenv("API_SESSION_COOKIE", "cgn_session"),
		SessionTTL:       sessionTTL,
		CookieSecure:     cookieSecure,
		VerificationTTL:  verificationTTL,
		ResetTTL:         resetTTL,
		SiteURL:          getenv("API_SITE_URL", "http://localhost:3000"),
		ResendAPIKey:     firstNonEmptyEnv("API_RESEND_API_KEY", "RESEND_API_KEY"),
		AccountEmailFrom: getenv("API_ACCOUNT_EMAIL_FROM", "account@campusgamingnetwork.com"),
		EventsEmailFrom:  getenv("API_EVENTS_EMAIL_FROM", "events@campusgamingnetwork.com"),
		AuthRateLimit:    authRateLimit,
		AuthRateWindow:   authRateWindow,
		DBMaxConns:       int32(dbMaxConns),
		CatalogRefresh:   catalogRefresh,
		MaintenanceToken: os.Getenv("API_MAINTENANCE_TOKEN"),
	}, nil
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
		if value := os.Getenv(key); value != "" {
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
