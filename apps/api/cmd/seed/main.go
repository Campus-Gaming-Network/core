package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/db"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/seed"
)

func main() {
	path := flag.String("csv", "../../data/schools_seed.csv", "school seed CSV path")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	input, err := os.Open(*path)
	if err != nil {
		slog.Error("open school seed", "error", err)
		os.Exit(1)
	}
	defer input.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
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

	count, err := seed.ImportSchools(ctx, database, input)
	if err != nil {
		slog.Error("import schools", "error", err)
		os.Exit(1)
	}
	slog.Info("school seed imported", "rows", count)
}
