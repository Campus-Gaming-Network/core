package seed

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var schoolHeaders = []string{
	"unitid", "name", "alias", "slug", "city", "state", "zip", "website_url",
	"latitude", "longitude", "is_main_campus", "num_branches",
}

// ImportSchools is intentionally a bootstrap operation. It refuses to run
// against a non-empty catalog so a later recurring sync cannot silently mutate
// the national seed from a changed CSV.
func ImportSchools(ctx context.Context, pool *pgxpool.Pool, input io.Reader) (int, error) {
	reader := csv.NewReader(input)
	reader.FieldsPerRecord = len(schoolHeaders)

	header, err := reader.Read()
	if err != nil {
		return 0, fmt.Errorf("read school CSV header: %w", err)
	}
	for index, expected := range schoolHeaders {
		if strings.TrimSpace(header[index]) != expected {
			return 0, fmt.Errorf("unexpected school CSV header at column %d: got %q, want %q", index+1, header[index], expected)
		}
	}

	rows := make([][]any, 0, 6243)
	for line := 2; ; line++ {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("read school CSV line %d: %w", line, err)
		}

		row, err := parseSchoolRecord(record, line)
		if err != nil {
			return 0, err
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("school CSV contains no data rows")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin school seed: %w", err)
	}
	defer tx.Rollback(ctx)

	var existing int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM schools`).Scan(&existing); err != nil {
		return 0, fmt.Errorf("check existing schools: %w", err)
	}
	if existing != 0 {
		if existing == len(rows) {
			return 0, nil
		}
		return 0, fmt.Errorf("refusing one-time school seed: schools table already contains %d rows", existing)
	}

	columns := []string{
		"unitid", "name", "alias", "slug", "city", "state", "zip", "website_url",
		"latitude", "longitude", "is_main_campus", "num_branches", "is_active",
	}
	copyRows := make([][]any, len(rows))
	for index, row := range rows {
		copyRows[index] = append(row, true)
	}

	copied, err := tx.CopyFrom(ctx, pgx.Identifier{"schools"}, columns, pgx.CopyFromRows(copyRows))
	if err != nil {
		return 0, fmt.Errorf("copy schools: %w", err)
	}
	if int(copied) != len(rows) {
		return 0, fmt.Errorf("copy schools inserted %d rows, want %d", copied, len(rows))
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit school seed: %w", err)
	}

	return len(rows), nil
}

func parseSchoolRecord(record []string, line int) ([]any, error) {
	unitID, err := strconv.ParseInt(strings.TrimSpace(record[0]), 10, 64)
	if err != nil || unitID <= 0 {
		return nil, fmt.Errorf("school CSV line %d: unitid must be a positive integer", line)
	}
	name := strings.TrimSpace(record[1])
	slug := strings.TrimSpace(record[3])
	if name == "" || slug == "" {
		return nil, fmt.Errorf("school CSV line %d: name and slug are required", line)
	}

	latitude, err := nullableFloat(record[8])
	if err != nil {
		return nil, fmt.Errorf("school CSV line %d: latitude: %w", line, err)
	}
	longitude, err := nullableFloat(record[9])
	if err != nil {
		return nil, fmt.Errorf("school CSV line %d: longitude: %w", line, err)
	}
	isMain, err := strconv.ParseBool(strings.TrimSpace(record[10]))
	if err != nil {
		return nil, fmt.Errorf("school CSV line %d: is_main_campus: %w", line, err)
	}
	numBranches, err := strconv.Atoi(strings.TrimSpace(record[11]))
	if err != nil || numBranches < 0 {
		return nil, fmt.Errorf("school CSV line %d: num_branches must be a non-negative integer", line)
	}

	return []any{
		unitID,
		name,
		nullableText(record[2]),
		slug,
		nullableText(record[4]),
		nullableText(record[5]),
		nullableText(record[6]),
		nullableText(record[7]),
		latitude,
		longitude,
		isMain,
		numBranches,
	}, nil
}

func nullableText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullableFloat(value string) (any, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	return parsed, err
}
