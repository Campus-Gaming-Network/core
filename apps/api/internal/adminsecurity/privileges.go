package adminsecurity

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var ErrUnsafeRuntimePrivileges = errors.New("Admin Console runtime database role has unsafe audit/security-event privileges")

type privilegeQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// VerifyRuntimePrivileges fails when the connected API role owns or can mutate
// append-oriented audit/security tables. Migrations and retention jobs must use
// a distinct owner/maintenance role.
func VerifyRuntimePrivileges(ctx context.Context, database privilegeQuerier) error {
	if database == nil {
		return ErrUnsafeRuntimePrivileges
	}
	var runtimeRole, auditOwner, securityOwner string
	var auditSelect, auditInsert, auditUpdate, auditDelete, auditTruncate bool
	var securitySelect, securityInsert, securityUpdate, securityDelete, securityTruncate bool
	err := database.QueryRow(ctx, `
		SELECT current_user,
		       pg_get_userbyid(audit.relowner),
		       pg_get_userbyid(security.relowner),
		       has_table_privilege(current_user, 'audit_logs', 'SELECT'),
		       has_table_privilege(current_user, 'audit_logs', 'INSERT'),
		       has_table_privilege(current_user, 'audit_logs', 'UPDATE'),
		       has_table_privilege(current_user, 'audit_logs', 'DELETE'),
		       has_table_privilege(current_user, 'audit_logs', 'TRUNCATE'),
		       has_table_privilege(current_user, 'admin_security_events', 'SELECT'),
		       has_table_privilege(current_user, 'admin_security_events', 'INSERT'),
		       has_table_privilege(current_user, 'admin_security_events', 'UPDATE'),
		       has_table_privilege(current_user, 'admin_security_events', 'DELETE'),
		       has_table_privilege(current_user, 'admin_security_events', 'TRUNCATE')
		FROM pg_class AS audit, pg_class AS security
		WHERE audit.oid = 'audit_logs'::regclass
		  AND security.oid = 'admin_security_events'::regclass
	`).Scan(
		&runtimeRole, &auditOwner, &securityOwner,
		&auditSelect, &auditInsert, &auditUpdate, &auditDelete, &auditTruncate,
		&securitySelect, &securityInsert, &securityUpdate, &securityDelete, &securityTruncate,
	)
	if err != nil {
		return ErrUnsafeRuntimePrivileges
	}
	if runtimeRole == auditOwner || runtimeRole == securityOwner ||
		!auditSelect || !auditInsert || auditUpdate || auditDelete || auditTruncate ||
		!securitySelect || !securityInsert || securityUpdate || securityDelete || securityTruncate {
		return ErrUnsafeRuntimePrivileges
	}
	return nil
}
