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
	"github.com/jackc/pgx/v5"
)

// The web suite addresses its fixtures by these ids. The Admin Console rejects
// ids that are not RFC 4122 UUIDs, so its variant uses version-4 ids.
var (
	primarySchoolID = "10000000-0000-0000-0000-000000000001"
	secondSchoolID  = "10000000-0000-0000-0000-000000000002"
	gameID          = "20000000-0000-0000-0000-000000000001"
)

const (
	// Admin Console fixtures, seeded only with the "admin" argument.
	operatorID    = "30000000-0000-4000-8000-000000000001"
	peerID        = "30000000-0000-4000-8000-000000000002"
	memberID      = "30000000-0000-4000-8000-000000000003"
	schoolAdminID = "30000000-0000-4000-8000-000000000004"
	formerAdminID = "30000000-0000-4000-8000-000000000005"
	// Site admins the security suite sacrifices one test each: reads to the
	// rate limit, logout, suspension, and grant revocation.
	limitedAdminID   = "30000000-0000-4000-8000-000000000006"
	loggedOutAdminID = "30000000-0000-4000-8000-000000000007"
	suspendedAdminID = "30000000-0000-4000-8000-000000000008"
	revokedAdminID   = "30000000-0000-4000-8000-000000000009"
	bystanderAdminID = "30000000-0000-4000-8000-000000000010"
	reportID         = "40000000-0000-4000-8000-000000000001"
	supportTicketID  = "40000000-0000-4000-8000-000000000002"
)

func main() {
	adminMode := len(os.Args) > 1 && os.Args[1] == "admin"
	if adminMode {
		primarySchoolID = "10000000-0000-4000-8000-000000000001"
		secondSchoolID = "10000000-0000-4000-8000-000000000002"
		gameID = "20000000-0000-4000-8000-000000000001"
	}
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
			schools, games, users, support_tickets, reports, audit_logs, email_outbox,
			admin_security_events, school_logo_objects
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
	if adminMode {
		if err := seedAdminConsole(ctx, tx); err != nil {
			slog.Error("seed Admin Console fixtures", "error", err)
			os.Exit(1)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		slog.Error("commit fixture seed", "error", err)
		os.Exit(1)
	}

	slog.Info("real-stack browser fixture seeded")
}

// seedAdminConsole adds the actors and moderation records the Admin Console
// real-stack suite drives. Site-admin grants are created afterwards through
// cgn-admin so the suite exercises the real bootstrap path.
func seedAdminConsole(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, name, home_school_id, age_confirmed_at, email_verified_at)
		VALUES
			($1::uuid, 'operator@admin-real.test', 'unused', 'Operator', $6::uuid, NOW(), NOW()),
			($2::uuid, 'peer@admin-real.test', 'unused', 'Peer Operator', $6::uuid, NOW(), NOW()),
			($3::uuid, 'member@admin-real.test', 'unused', 'Member', $6::uuid, NOW(), NOW()),
			($4::uuid, 'schooladmin@admin-real.test', 'unused', 'School Admin', $6::uuid, NOW(), NOW()),
			($5::uuid, 'former@admin-real.test', 'unused', 'Former Operator', $6::uuid, NOW(), NOW()),
			($7::uuid, 'limited@admin-real.test', 'unused', 'Limited Operator', $6::uuid, NOW(), NOW()),
			($8::uuid, 'loggedout@admin-real.test', 'unused', 'Logout Operator', $6::uuid, NOW(), NOW()),
			($9::uuid, 'suspended@admin-real.test', 'unused', 'Suspended Operator', $6::uuid, NOW(), NOW()),
			($10::uuid, 'revoked@admin-real.test', 'unused', 'Revoked Operator', $6::uuid, NOW(), NOW()),
			($11::uuid, 'bystander@admin-real.test', 'unused', 'Bystander Operator', $6::uuid, NOW(), NOW())
	`, operatorID, peerID, memberID, schoolAdminID, formerAdminID, primarySchoolID,
		limitedAdminID, loggedOutAdminID, suspendedAdminID, revokedAdminID, bystanderAdminID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO school_admins (school_id, user_id)
		VALUES ($1::uuid, $2::uuid)
	`, primarySchoolID, schoolAdminID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO reports (id, reporter_user_id, target_type, target_id, reason)
		VALUES ($1::uuid, $2::uuid, 'user', $3::uuid,
			'<img src=x onerror="document.body.dataset.xss=1"> abusive display name')
	`, reportID, memberID, peerID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO support_tickets (id, submitter_user_id, contact_email, name, subject, message)
		VALUES ($1::uuid, $2::uuid, 'member@admin-real.test', 'Member',
			'<script>document.body.dataset.xss="ticket"</script> locked out',
			'<svg onload="document.body.dataset.xss=2"> please help')
	`, supportTicketID, memberID)
	return err
}
