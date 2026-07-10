package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"strings"
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

	devUser, enabled, err := seed.EnsureDevUser(ctx, database, seed.DevUserInput{
		Email:          os.Getenv("API_DEV_SEED_USER_EMAIL"),
		Password:       os.Getenv("API_DEV_SEED_USER_PASSWORD"),
		Name:           os.Getenv("API_DEV_SEED_USER_NAME"),
		HomeSchoolSlug: os.Getenv("API_DEV_SEED_USER_SCHOOL_SLUG"),
		Timezone:       os.Getenv("API_DEV_SEED_USER_TIMEZONE"),
		FollowedSchoolSlugs: strings.Split(
			os.Getenv("API_DEV_SEED_USER_FOLLOWED_SCHOOL_SLUGS"),
			",",
		),
	})
	if err != nil {
		slog.Error("seed dev user", "error", err)
		os.Exit(1)
	}
	if enabled {
		slog.Info(
			"dev user seeded",
			"email", devUser.Email,
			"user_id", devUser.UserID,
			"followed_schools", devUser.FollowedCount,
		)
	}
}
