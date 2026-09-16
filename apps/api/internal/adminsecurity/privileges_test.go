package adminsecurity

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type fakePrivilegeQuerier struct {
	values []any
	err    error
}

func (querier fakePrivilegeQuerier) QueryRow(context.Context, string, ...any) pgx.Row {
	return fakePrivilegeRow{values: querier.values, err: querier.err}
}

type fakePrivilegeRow struct {
	values []any
	err    error
}

func (row fakePrivilegeRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	for index, destination := range destinations {
		switch value := destination.(type) {
		case *string:
			*value = row.values[index].(string)
		case *bool:
			*value = row.values[index].(bool)
		}
	}
	return nil
}

func TestVerifyRuntimePrivilegesAcceptsAppendOnlyRuntimeRole(t *testing.T) {
	values := []any{
		"cgn_runtime", "cgn_migrations", "cgn_migrations",
		true, true, false, false, false,
		true, true, false, false, false,
	}
	if err := VerifyRuntimePrivileges(context.Background(), fakePrivilegeQuerier{values: values}); err != nil {
		t.Fatalf("VerifyRuntimePrivileges() error = %v", err)
	}
}

func TestVerifyRuntimePrivilegesRejectsOwnersAndMutationGrants(t *testing.T) {
	tests := [][]any{
		{"cgn_runtime", "cgn_runtime", "cgn_migrations", true, true, false, false, false, true, true, false, false, false},
		{"cgn_runtime", "cgn_migrations", "cgn_migrations", true, true, true, false, false, true, true, false, false, false},
		{"cgn_runtime", "cgn_migrations", "cgn_migrations", true, true, false, false, false, true, false, false, false, false},
	}
	for _, values := range tests {
		if err := VerifyRuntimePrivileges(context.Background(), fakePrivilegeQuerier{values: values}); !errors.Is(err, ErrUnsafeRuntimePrivileges) {
			t.Fatalf("VerifyRuntimePrivileges(%#v) error = %v", values, err)
		}
	}
	if err := VerifyRuntimePrivileges(context.Background(), fakePrivilegeQuerier{err: errors.New("query failed")}); !errors.Is(err, ErrUnsafeRuntimePrivileges) {
		t.Fatalf("query failure error = %v", err)
	}
}
