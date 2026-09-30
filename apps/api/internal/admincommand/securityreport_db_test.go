package admincommand

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSecurityReportFiresAtThresholdWithinItsWindowOnly(t *testing.T) {
	databaseURL := os.Getenv("API_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	// A reason code unique to this run keeps the counts independent of any
	// other test's events in the shared database.
	reason := fmt.Sprintf("report_test_%d", time.Now().UnixNano())
	now := time.Now().UTC().Truncate(time.Second)
	insert := func(eventType string, reasonCode string, age time.Duration) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO admin_security_events (event_type, outcome, metadata, occurred_at)
			VALUES ($1, 'denied', JSONB_BUILD_OBJECT('reason_code', $2::text), $3)
		`, eventType, reasonCode, now.Add(-age)); err != nil {
			t.Fatalf("insert event: %v", err)
		}
	}
	// Two inside the window, one just outside it, one of another type, and one
	// with another reason.
	insert("admin.authentication.exchange_denied", reason, time.Minute)
	insert("admin.authentication.exchange_denied", reason, 14*time.Minute)
	insert("admin.authentication.exchange_denied", reason, 16*time.Minute)
	insert("admin.authorization.denied", reason, time.Minute)
	insert("admin.authentication.exchange_denied", reason+"_other", time.Minute)

	rules := []AlertRule{
		{Name: "typed and reasoned", EventType: "admin.authentication.exchange_denied", ReasonCode: reason, Threshold: 2, Window: 15 * time.Minute},
		{Name: "just below", EventType: "admin.authentication.exchange_denied", ReasonCode: reason, Threshold: 3, Window: 15 * time.Minute},
		{Name: "any type", ReasonCode: reason, Threshold: 3, Window: 15 * time.Minute},
		{Name: "wider window", EventType: "admin.authentication.exchange_denied", ReasonCode: reason, Threshold: 3, Window: 20 * time.Minute},
	}
	findings, err := NewService(pool).SecurityReport(ctx, rules, now)
	if err != nil {
		t.Fatal(err)
	}

	got := make([][3]any, 0, len(findings))
	for _, finding := range findings {
		got = append(got, [3]any{finding.Rule.Name, finding.Count, finding.Firing})
	}
	want := [][3]any{
		{"typed and reasoned", 2, true},
		{"just below", 2, false},
		{"any type", 3, true},
		{"wider window", 3, true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("findings = %v, want %v", got, want)
	}
}
