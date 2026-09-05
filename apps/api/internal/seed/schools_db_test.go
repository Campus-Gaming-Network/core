package seed

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const testSchoolCSV = `unitid,name,alias,slug,city,state,zip,website_url,latitude,longitude,is_main_campus,num_branches
999001,Seed Guard University,,seed-guard-university,Irvine,CA,92697,https://example.test,33.6,-117.8,true,0
`

// Runs only when API_DATABASE_URL points at a migrated database. The guard being
// tested reads the catalog inside the seed transaction, so a fake pool would
// assert nothing about it.
//
// Re-running the seed against a populated catalog must succeed as a no-op. It
// previously errored unless the catalog held exactly as many rows as the CSV,
// which made `docker compose up` fail on any database whose catalog had drifted
// by even one row. The import path itself needs an empty catalog and so is
// covered by a fresh-database run rather than here.
func TestImportSchoolsSkipsPopulatedCatalog(t *testing.T) {
	url := os.Getenv("API_DATABASE_URL")
	if url == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	// Guarantees a populated catalog whose row count does not match the CSV,
	// which is the case that used to fail.
	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Seed Guard School', 'seed-guard-school')
		RETURNING id::text`).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})

	var before int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM schools`).Scan(&before); err != nil {
		t.Fatalf("count schools: %v", err)
	}

	count, err := ImportSchools(ctx, pool, strings.NewReader(testSchoolCSV))
	if err != nil {
		t.Fatalf("ImportSchools() error = %v, want nil", err)
	}
	if count != 0 {
		t.Fatalf("ImportSchools() = %d rows, want 0 for a populated catalog", count)
	}

	var after int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM schools`).Scan(&after); err != nil {
		t.Fatalf("count schools: %v", err)
	}
	if after != before {
		t.Fatalf("catalog changed from %d to %d rows, want no writes", before, after)
	}
	var seeded int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM schools WHERE slug = 'seed-guard-university'`).Scan(&seeded); err != nil {
		t.Fatalf("count seeded school: %v", err)
	}
	if seeded != 0 {
		t.Fatal("CSV row was written into a populated catalog")
	}
}
