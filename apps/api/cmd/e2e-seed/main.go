// Command e2e-seed resets and seeds the dedicated real-stack browser-test database.
package main

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/db"
)

const (
	primarySchoolID = "10000000-0000-0000-0000-000000000001"
	secondSchoolID  = "10000000-0000-0000-0000-000000000002"
	gameID          = "20000000-0000-0000-0000-000000000001"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	databaseName := strings.ToLower(database.Config().ConnConfig.Database)
	if !strings.Contains(databaseName, "e2e") {
		slog.Error("refusing to reset non-e2e database")
		os.Exit(1)
	}

	tx, err := database.Begin(ctx)
	if err != nil {
		slog.Error("begin fixture reset", "error", err)
		os.Exit(1)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		TRUNCATE TABLE
			schools, games, users, support_tickets, reports, audit_logs, email_outbox
		RESTART IDENTITY CASCADE
	`); err != nil {
		slog.Error("reset fixture tables", "error", err)
		os.Exit(1)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO schools (id, unitid, name, slug, city, state, is_main_campus, num_branches)
		VALUES
			($1::uuid, 90000001, 'Real Stack University', 'real-stack-university', 'Irvine', 'CA', TRUE, 0),
			($2::uuid, 90000002, 'Browser Fixture College', 'browser-fixture-college', 'Long Beach', 'CA', TRUE, 0)
	`, primarySchoolID, secondSchoolID); err != nil {
		slog.Error("seed fixture schools", "error", err)
		os.Exit(1)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO games (id, igdb_id, name, slug)
		VALUES ($1::uuid, 90000001, 'Strategy Arena', 'strategy-arena')
	`, gameID); err != nil {
		slog.Error("seed fixture game", "error", err)
		os.Exit(1)
	}
	if err := tx.Commit(ctx); err != nil {
		slog.Error("commit fixture seed", "error", err)
		os.Exit(1)
	}

	slog.Info("real-stack browser fixture seeded")
}
