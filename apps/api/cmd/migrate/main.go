package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/db"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func main() {
	directory := flag.String("dir", "../../db/migrations", "directory containing versioned *.up.sql migrations")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	if err := database.Ping(ctx); err != nil {
		slog.Error("ping database", "error", err)
		os.Exit(1)
	}
	if err := migrate.Run(ctx, database, *directory); err != nil {
		slog.Error("run migrations", "error", err)
		os.Exit(1)
	}

	slog.Info("database migrations applied")
}
