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
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/seed"
)

func main() {
	path := flag.String("csv", "../../data/schools_seed.csv", "school seed CSV path")
	demo := flag.Bool("demo", false, "also fill a local database with demo users, events, teams, and moderation records")
	demoReset := flag.Bool("demo-reset", false, "delete existing demo data before seeding it again (requires -demo)")
	demoUsers := flag.Int("demo-users", 3000, "demo user count")
	demoEvents := flag.Int("demo-events", 4000, "demo event series count; recurring series add occurrences")
	demoTeams := flag.Int("demo-teams", 1200, "demo team count")
	demoSeed := flag.Uint64("demo-seed", 42, "random seed; equal seeds generate equal data")
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

	if *demo && cfg.DeploymentEnvironment != config.DeploymentLocal {
		slog.Error("demo data is only allowed when DEPLOYMENT_ENV is local", "deployment_env", cfg.DeploymentEnvironment)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	database, err := db.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
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
	if count == 0 {
		slog.Info("school seed skipped", "reason", "catalog already populated")
	} else {
		slog.Info("school seed imported", "rows", count)
	}

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

	// The starter games need IGDB. Without credentials, or when IGDB is down,
	// the catalog fills in as admins and users import games.
	if cfg.IGDBConfigured() {
		imports := games.NewIGDBService(games.NewPostgresRepository(database), igdb.NewClient(igdb.Config{
			ClientID: cfg.IGDBClientID, ClientSecret: cfg.IGDBClientSecret,
			APIURL: cfg.IGDBAPIURL, TokenURL: cfg.IGDBTokenURL, ImageURL: cfg.IGDBImageURL,
		}))
		added, err := imports.EnsureStarterGames(ctx)
		if err != nil {
			slog.Warn("starter games not fully imported", "imported", added, "error", err)
		} else {
			slog.Info("starter games imported", "imported", added)
		}
	}

	if !*demo {
		return
	}
	if *demoReset {
		if err := seed.ResetDemoData(ctx, database); err != nil {
			slog.Error("reset demo data", "error", err)
			os.Exit(1)
		}
		slog.Info("demo data reset")
	}
	password := os.Getenv("API_DEMO_SEED_PASSWORD")
	if password == "" {
		password = "Password12345!"
	}
	result, err := seed.EnsureDemoData(ctx, database, seed.DemoOptions{
		Password: password,
		Seed:     *demoSeed,
		Users:    *demoUsers,
		Events:   *demoEvents,
		Teams:    *demoTeams,
		Now:      time.Now(),
	})
	if err != nil {
		slog.Error("seed demo data", "error", err)
		os.Exit(1)
	}
	slog.Info(
		"demo data seeded",
		"users", result.Users,
		"events", result.Events,
		"rsvps", result.RSVPs,
		"teams", result.Teams,
		"reports", result.Reports,
		"support_tickets", result.SupportTickets,
		"notifications", result.Notifications,
		"email_domain", seed.DemoEmailDomain,
	)
}
