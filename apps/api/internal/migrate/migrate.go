// Package migrate applies versioned PostgreSQL migrations.
package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var migrationFilename = regexp.MustCompile(`^(\d+)_([a-zA-Z0-9_-]+)\.up\.sql$`)

type File struct {
	Version int64
	Name    string
	Path    string
}

// Run applies each unapplied *.up.sql file in version order. A migration is
// recorded in the same transaction as its SQL, so a failed migration is safe
// to fix and retry.
func Run(ctx context.Context, pool *pgxpool.Pool, directory string) error {
	files, err := LoadFiles(directory)
	if err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	rows, err := pool.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("load applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int64]struct{})
	for rows.Next() {
		var version int64
		if err := rows.Scan(&version); err != nil {
			return fmt.Errorf("scan applied migration: %w", err)
		}
		applied[version] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate applied migrations: %w", err)
	}

	for _, file := range files {
		if _, ok := applied[file.Version]; ok {
			continue
		}

		sql, err := os.ReadFile(file.Path)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", file.Path, err)
		}

		tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", file.Version, err)
		}

		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %d (%s): %w", file.Version, file.Name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, file.Version, file.Name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %d (%s): %w", file.Version, file.Name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %d (%s): %w", file.Version, file.Name, err)
		}
	}

	return nil
}

func LoadFiles(directory string) ([]File, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("read migration directory: %w", err)
	}

	files := make([]File, 0, len(entries))
	seen := make(map[int64]string)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		matches := migrationFilename.FindStringSubmatch(entry.Name())
		if matches == nil {
			continue
		}

		version, err := strconv.ParseInt(matches[1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse migration version %q: %w", entry.Name(), err)
		}
		if previous, ok := seen[version]; ok {
			return nil, fmt.Errorf("duplicate migration version %d: %s and %s", version, previous, entry.Name())
		}

		seen[version] = entry.Name()
		files = append(files, File{
			Version: version,
			Name:    strings.TrimSuffix(entry.Name(), ".up.sql"),
			Path:    filepath.Join(directory, entry.Name()),
		})
	}

	sort.Slice(files, func(i, j int) bool { return files[i].Version < files[j].Version })
	return files, nil
}
