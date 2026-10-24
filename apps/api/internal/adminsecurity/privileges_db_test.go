package adminsecurity

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// A runtime role granted what the API needs can append audit history and
// security events but never change or remove them, and the startup check
// accepts only that role: not the tables' owner, and not a role that can
// update them.
func TestAuditHistoryIsAppendOnlyForTheRuntimeRole(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "privileges")
	var schema string
	if err := pool.QueryRow(ctx, `SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	// Roles are cluster-wide, so the role is named after the schema, which is
	// unique to this test run.
	role := pgx.Identifier{"runtime_" + schema}.Sanitize()
	for _, statement := range []string{
		`CREATE ROLE ` + role + ` NOLOGIN`,
		`GRANT USAGE ON SCHEMA ` + pgx.Identifier{schema}.Sanitize() + ` TO ` + role,
		`GRANT SELECT, INSERT ON audit_logs, admin_security_events TO ` + role,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	t.Cleanup(func() {
		for _, statement := range []string{`DROP OWNED BY ` + role, `DROP ROLE ` + role} {
			if _, err := pool.Exec(context.Background(), statement); err != nil {
				t.Errorf("%s: %v", statement, err)
			}
		}
	})

	ownerCheck := VerifyRuntimePrivileges(ctx, pool)

	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SET ROLE `+role); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := conn.Exec(context.Background(), `RESET ROLE`); err != nil {
			t.Errorf("reset role: %v", err)
		}
	}()
	runtimeCheck := VerifyRuntimePrivileges(ctx, conn)

	outcome := func(sql string) string {
		_, err := conn.Exec(ctx, sql)
		var pgErr *pgconn.PgError
		switch {
		case err == nil:
			return "allowed"
		case errors.As(err, &pgErr) && pgErr.Code == "42501":
			return "denied"
		default:
			return err.Error()
		}
	}
	got := map[string]any{
		"owner check":   ownerCheck,
		"runtime check": runtimeCheck,
		"insert audit": outcome(`INSERT INTO audit_logs (action, entity_type, entity_id)
			VALUES ('test.appended', 'test', gen_random_uuid())`),
		"read audit":     outcome(`SELECT COUNT(*) FROM audit_logs`),
		"update audit":   outcome(`UPDATE audit_logs SET action = 'test.rewritten'`),
		"delete audit":   outcome(`DELETE FROM audit_logs`),
		"truncate audit": outcome(`TRUNCATE audit_logs`),
		"insert event": outcome(`INSERT INTO admin_security_events (event_type, outcome)
			VALUES ('admin.test.appended', 'succeeded')`),
		"update event":   outcome(`UPDATE admin_security_events SET outcome = 'denied'`),
		"delete event":   outcome(`DELETE FROM admin_security_events`),
		"truncate event": outcome(`TRUNCATE admin_security_events`),
	}
	// A role that can also rewrite history fails the startup check.
	if _, err := pool.Exec(ctx, `GRANT UPDATE ON audit_logs TO `+role); err != nil {
		t.Fatal(err)
	}
	got["runtime check with update"] = VerifyRuntimePrivileges(ctx, conn)
	want := map[string]any{
		"runtime check with update": ErrUnsafeRuntimePrivileges,
		"owner check":               ErrUnsafeRuntimePrivileges,
		"runtime check":             nil,
		"insert audit":              "allowed", "read audit": "allowed",
		"update audit": "denied", "delete audit": "denied", "truncate audit": "denied",
		"insert event": "allowed",
		"update event": "denied", "delete event": "denied", "truncate event": "denied",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("privileges = %v, want %v", got, want)
	}
}
