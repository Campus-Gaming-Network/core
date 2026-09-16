package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/admincommand"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/db"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "cgn-admin:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return usageError()
	}
	if args[0] == "validate-access-config" {
		if len(args) != 1 {
			return usageError()
		}
		cfg, err := config.Load()
		if err != nil {
			return err
		}
		if !cfg.AdminEnabled {
			return errors.New("ADMIN_ENABLED must be true to validate the enabled Access configuration")
		}
		fmt.Fprintln(stdout, "Admin Console Access configuration is valid")
		return nil
	}
	switch args[0] {
	case "grant-site-admin", "revoke-site-admin", "list-site-admins", "revoke-sessions":
	default:
		return usageError()
	}

	databaseURL := strings.TrimSpace(os.Getenv("API_DATABASE_URL"))
	if databaseURL == "" {
		return errors.New("API_DATABASE_URL must be explicitly set")
	}
	pool, err := db.Open(ctx, databaseURL, 2)
	if err != nil {
		return errors.New("could not open the configured database")
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return errors.New("could not reach the configured database")
	}
	service := admincommand.NewService(pool)

	switch args[0] {
	case "grant-site-admin":
		flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
		flags.SetOutput(stderr)
		email := flags.String("email", "", "existing verified CGN account email")
		actorEmail := flags.String("actor-email", "", "active site administrator authorizing the grant")
		reason := flags.String("reason", "", "operator reason (required)")
		bootstrap := flags.Bool("bootstrap", false, "create the first site administrator only")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
			return usageError()
		}
		grant, err := service.GrantSiteAdmin(ctx, admincommand.GrantInput{
			TargetEmail: *email, ActorEmail: *actorEmail, Reason: *reason, Bootstrap: *bootstrap,
			OperatorIdentity: os.Getenv("CGN_ADMIN_OPERATOR_IDENTITY"),
		})
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "granted site_admin to %s (grant %s)\n", strings.ToLower(strings.TrimSpace(*email)), grant.ID)
		return nil

	case "revoke-site-admin":
		flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
		flags.SetOutput(stderr)
		email := flags.String("email", "", "site administrator account email")
		actorEmail := flags.String("actor-email", "", "active site administrator authorizing the revocation")
		reason := flags.String("reason", "", "operator reason (required)")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
			return usageError()
		}
		grant, err := service.RevokeSiteAdmin(ctx, admincommand.RevokeInput{
			TargetEmail: *email, ActorEmail: *actorEmail, Reason: *reason,
		})
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "revoked site_admin from %s (grant %s)\n", strings.ToLower(strings.TrimSpace(*email)), grant.ID)
		return nil

	case "list-site-admins":
		if len(args) != 1 {
			return usageError()
		}
		admins, err := service.ListSiteAdmins(ctx)
		if err != nil {
			return err
		}
		for _, admin := range admins {
			eligibility := "ineligible"
			if admin.Eligible {
				eligibility = "eligible"
			}
			fmt.Fprintf(
				stdout, "%s\t%s\t%s\t%s\t%s\n",
				admin.Email, admin.UserID, admin.GrantID, admin.AccountStatus, eligibility,
			)
		}
		return nil

	case "revoke-sessions":
		flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
		flags.SetOutput(stderr)
		email := flags.String("email", "", "account whose admin sessions will be revoked")
		actorEmail := flags.String("actor-email", "", "active site administrator authorizing the revocation")
		reason := flags.String("reason", "", "operator reason (required)")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
			return usageError()
		}
		count, err := service.RevokeSessions(ctx, admincommand.RevokeInput{
			TargetEmail: *email, ActorEmail: *actorEmail, Reason: *reason,
		})
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "revoked %d admin session(s) for %s\n", count, strings.ToLower(strings.TrimSpace(*email)))
		return nil

	default:
		return usageError()
	}
}

func usageError() error {
	return errors.New("usage: cgn-admin <grant-site-admin|revoke-site-admin|list-site-admins|revoke-sessions|validate-access-config> [options]")
}
