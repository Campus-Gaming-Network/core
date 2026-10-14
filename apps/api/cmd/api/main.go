package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/db"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emaildelivery"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/errormonitor"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/httpapi"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/mailhttp"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/maintenance"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/redact"
)

func main() {
	slog.SetDefault(redact.NewLogger(os.Stderr))
	os.Exit(run())
}

// run returns the exit code so deferred cleanup (pool close, error flush)
// still runs before the process exits.
func run() int {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		return 1
	}

	if err := errormonitor.Init(errormonitor.Options{
		DSN:         cfg.SentryDSN,
		Environment: string(cfg.DeploymentEnvironment),
		Release:     cfg.SentryRelease,
	}); err != nil {
		slog.Error("start error monitoring", "error", err)
		return 1
	}
	defer errormonitor.Flush()
	if cfg.SentryDSN == "" && cfg.DeploymentEnvironment.Strict() {
		slog.Warn("error monitoring is disabled; set SENTRY_DSN to enable it")
	}

	database, err := db.Open(context.Background(), cfg.DatabaseURL, db.Options{
		MaxConns:         cfg.DBMaxConns,
		MaxConnLifetime:  cfg.DBMaxConnLifetime,
		MaxConnIdleTime:  cfg.DBMaxConnIdleTime,
		StatementTimeout: cfg.DBStatementTimeout,
	})
	if err != nil {
		slog.Error("open database", "error", err)
		return 1
	}
	defer database.Close()
	if cfg.AdminEnabled && cfg.DeploymentEnvironment.Strict() {
		privilegeContext, cancelPrivilegeCheck := context.WithTimeout(context.Background(), 5*time.Second)
		if err := adminsecurity.VerifyRuntimePrivileges(privilegeContext, database); err != nil {
			cancelPrivilegeCheck()
			slog.Error("unsafe Admin Console database privileges", "error", err)
			return 1
		}
		cancelPrivilegeCheck()
	}

	handler := httpapi.NewRouter(cfg, database)
	server := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: handler,
		// Without these a slow client or a slow query has no upper bound, and
		// stalled connections accumulate against a small pool.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		// Requests carry a session cookie, a few proxy headers, and for the
		// Admin Console an Access assertion; none comes near this. The default
		// is 1 MB.
		MaxHeaderBytes: 64 << 10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var workers sync.WaitGroup
	workers.Go(func() {
		maintenance.NewSweeper(database, slog.Default()).Start(ctx, maintenance.DefaultInterval)
	})

	mailClient := mailhttp.NewClient()
	emailWorker := emailoutbox.NewWorker(
		emailoutbox.NewPostgresStore(database),
		&emaildelivery.Dispatcher{
			Account: &auth.ResendMailer{
				APIKey: cfg.ResendAPIKey, From: cfg.AccountEmailFrom,
				Endpoint: cfg.ResendAPIURL, SiteURL: cfg.SiteURL,
				Client: mailClient, Logger: slog.Default(),
			},
			Events: &eventstore.ResendMailer{
				APIKey: cfg.ResendAPIKey, From: cfg.EventsEmailFrom,
				Endpoint: cfg.ResendAPIURL, SiteURL: cfg.SiteURL,
				Client: mailClient, Logger: slog.Default(),
			},
		},
		slog.Default(),
	)
	workers.Go(func() { emailWorker.Start(ctx) })

	listener, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		slog.Error("api listen failed", "error", err)
		stop()
		workers.Wait()
		return 1
	}
	slog.Info("api listening", "addr", listener.Addr().String())
	if err := serve(ctx, server, listener, &workers, cfg.ShutdownTimeout); err != nil {
		slog.Error("api stopped with error", "error", err)
		return 1
	}
	return 0
}
