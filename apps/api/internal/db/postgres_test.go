package db

import (
	"context"
	"testing"
	"time"
)

func TestOpenAppliesOptions(t *testing.T) {
	pool, err := Open(context.Background(), "postgres://u:p@localhost:5432/d", Options{
		MaxConns:         7,
		MaxConnLifetime:  30 * time.Minute,
		MaxConnIdleTime:  5 * time.Minute,
		StatementTimeout: 15 * time.Second,
	})
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer pool.Close()

	got := pool.Config()
	if got.MaxConns != 7 || got.MaxConnLifetime != 30*time.Minute || got.MaxConnIdleTime != 5*time.Minute {
		t.Fatalf("pool = max %d lifetime %s idle %s", got.MaxConns, got.MaxConnLifetime, got.MaxConnIdleTime)
	}
	if got := got.ConnConfig.RuntimeParams["statement_timeout"]; got != "15000" {
		t.Fatalf("statement_timeout = %q, want 15000", got)
	}
}

func TestOpenDefaultsMaxConnsAndSkipsStatementTimeout(t *testing.T) {
	pool, err := Open(context.Background(), "postgres://u:p@localhost:5432/d", Options{})
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer pool.Close()

	got := pool.Config()
	if got.MaxConns != DefaultMaxConns {
		t.Fatalf("MaxConns = %d, want %d", got.MaxConns, DefaultMaxConns)
	}
	if _, set := got.ConnConfig.RuntimeParams["statement_timeout"]; set {
		t.Fatal("statement_timeout set without StatementTimeout")
	}
}
