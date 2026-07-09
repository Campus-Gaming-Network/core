package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr         string
	DBHost           string
	DBPort           string
	DBConnectTimeout time.Duration
	SentryDSN        string
}

func Load() (Config, error) {
	timeout, err := time.ParseDuration(getenv("API_DB_CONNECT_TIMEOUT", "2s"))
	if err != nil {
		return Config{}, fmt.Errorf("parse API_DB_CONNECT_TIMEOUT: %w", err)
	}

	port := getenv("API_DB_PORT", "5432")
	if _, err := strconv.Atoi(port); err != nil {
		return Config{}, fmt.Errorf("parse API_DB_PORT: %w", err)
	}

	return Config{
		HTTPAddr:         getenv("API_HTTP_ADDR", ":8080"),
		DBHost:           getenv("API_DB_HOST", "localhost"),
		DBPort:           port,
		DBConnectTimeout: timeout,
		SentryDSN:        os.Getenv("SENTRY_DSN"),
	}, nil
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}
