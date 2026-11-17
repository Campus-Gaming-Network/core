package dbtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// This stable key spells "CGN_TMPL" in ASCII. It serializes building the
// template across package test processes that share a server.
const templateLockID int64 = 0x43474e5f544d504c

const templatePrefix = "cgn_template_"

var (
	templateOnce     sync.Once
	templateName     string
	templateErr      error
	databaseSequence atomic.Int64
)

// NewMigratedPool returns a pool on a database of its own with every
// migration applied, dropped when the test ends. Applying the migrations took
// most of each database test's setup, so they are applied once to a template
// database, named after the migration files and kept for later runs, and each
// test gets a copy of it. A private database also lets the caller run in
// parallel with other tests. It skips the test when API_DATABASE_URL is not
// set.
func NewMigratedPool(t *testing.T, prefix string) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}

	ctx := context.Background()
	templateOnce.Do(func() { templateName, templateErr = ensureTemplate(ctx, databaseURL) })
	if templateErr != nil {
		t.Fatalf("migrated template: %v", templateErr)
	}

	owner, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(owner.Close)
	name := fmt.Sprintf("%s_%d_%d", prefix, os.Getpid(), databaseSequence.Add(1))
	database := pgx.Identifier{name}.Sanitize()
	if _, err := owner.Exec(ctx, `CREATE DATABASE `+database+` TEMPLATE `+pgx.Identifier{templateName}.Sanitize()); err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		if _, err := owner.Exec(context.Background(), `DROP DATABASE `+database+` WITH (FORCE)`); err != nil {
			t.Errorf("drop database: %v", err)
		}
	})
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse database URL: %v", err)
	}
	config.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect to database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func ensureTemplate(ctx context.Context, databaseURL string) (string, error) {
	files, err := migrate.LoadFiles(migrationsDir)
	if err != nil {
		return "", err
	}
	digest := sha256.New()
	for _, file := range files {
		content, err := os.ReadFile(file.Path)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(digest, "%s\x00%d\x00", file.Name, len(content))
		digest.Write(content)
	}
	name := templatePrefix + hex.EncodeToString(digest.Sum(nil))[:16]

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	// Closing the connection releases the session-level lock.
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, templateLockID); err != nil {
		return "", fmt.Errorf("lock template: %w", err)
	}

	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists); err != nil {
		return "", fmt.Errorf("find template: %w", err)
	}
	if exists {
		return name, nil
	}
	if err := dropStaleTemplates(ctx, conn); err != nil {
		return "", err
	}

	// The template is migrated under another name and renamed only once every
	// migration has applied, so a run that stops partway leaves no template
	// that later runs would copy.
	building := fmt.Sprintf("%sbuilding_%d", templatePrefix, os.Getpid())
	if _, err := conn.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{building}.Sanitize()); err != nil {
		return "", fmt.Errorf("create template: %w", err)
	}
	if err := migrateDatabase(ctx, databaseURL, building); err != nil {
		if _, dropErr := conn.Exec(context.Background(), `DROP DATABASE `+pgx.Identifier{building}.Sanitize()+` WITH (FORCE)`); dropErr != nil {
			return "", errors.Join(err, fmt.Errorf("drop unfinished template: %w", dropErr))
		}
		return "", err
	}
	if _, err := conn.Exec(ctx, `ALTER DATABASE `+pgx.Identifier{building}.Sanitize()+` RENAME TO `+pgx.Identifier{name}.Sanitize()); err != nil {
		return "", fmt.Errorf("rename template: %w", err)
	}
	return name, nil
}

func migrateDatabase(ctx context.Context, databaseURL, name string) error {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse database URL: %w", err)
	}
	config.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("connect to template: %w", err)
	}
	// A database cannot be copied or renamed while anything is connected to it.
	defer pool.Close()
	return migrate.Run(ctx, pool, migrationsDir)
}

// dropStaleTemplates removes templates built from earlier migration files, so
// a local server does not keep one for every migration change. A template
// another test process is still copying is left for a later run.
func dropStaleTemplates(ctx context.Context, conn *pgx.Conn) error {
	rows, err := conn.Query(ctx, `SELECT datname FROM pg_database WHERE starts_with(datname, $1)`, templatePrefix)
	if err != nil {
		return fmt.Errorf("list templates: %w", err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("list templates: %w", err)
	}
	for _, stale := range names {
		if strings.HasPrefix(stale, templatePrefix+"building_") {
			continue
		}
		_, err := conn.Exec(ctx, `DROP DATABASE `+pgx.Identifier{stale}.Sanitize())
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "55006" {
			continue
		}
		if err != nil {
			return fmt.Errorf("drop stale template %s: %w", stale, err)
		}
	}
	return nil
}
