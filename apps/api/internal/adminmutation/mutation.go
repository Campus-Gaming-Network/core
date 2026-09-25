// Package adminmutation holds the shared version and audit contract for named
// administrative domain commands. Authorization remains at the Go HTTP boundary.
package adminmutation

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrNotFound     = apperror.New(apperror.KindNotFound, "admin_record_not_found", "record not found")
	ErrConflict     = apperror.New(apperror.KindConflict, "admin_record_conflict", "record changed; reload before retrying")
	ErrDependencies = apperror.New(apperror.KindConflict, "catalog_dependencies_exist", "catalog record has dependencies")
	ErrTransition   = apperror.New(apperror.KindConflict, "invalid_admin_transition", "transition is not allowed")
	ErrIneligible   = apperror.New(apperror.KindUnprocessable, "grant_user_not_eligible", "grant requires an active verified user")
)

type Command struct {
	Correlation       adminaudit.Correlation `json:"-"`
	ExpectedUpdatedAt time.Time              `json:"expected_updated_at"`
	Reason            string                 `json:"reason"`
}

func (command Command) Validate(versionRequired bool) error {
	if command.Correlation.Validate() != nil || command.Correlation.ActorUserID == "" ||
		command.Correlation.AdminSessionID == "" || command.Correlation.RequestID == "" {
		return apperror.Validation("admin audit correlation is required")
	}
	if versionRequired && command.ExpectedUpdatedAt.IsZero() {
		return apperror.Validation("expected_updated_at is required")
	}
	if !Text(command.Reason, 1000, true) {
		return apperror.Validation("operator reason is required and must be at most 1000 characters")
	}
	return nil
}

func (command Command) Audit(ctx context.Context, tx pgx.Tx, action adminaudit.Action, entity adminaudit.EntityType, id string, before, after adminaudit.State) error {
	_, err := adminaudit.NewPostgresStoreForTransaction(tx).Insert(ctx, adminaudit.WriteInput{
		Correlation: command.Correlation, Action: action, EntityType: entity, EntityID: id,
		Before: before, After: after, Metadata: adminaudit.Metadata{OperatorReason: strings.TrimSpace(command.Reason)},
	})
	return err
}

type Filter struct {
	Query  string
	State  string
	Limit  int
	After  *pagecursor.Cursor
	Before *pagecursor.Cursor
}

func (filter Filter) Validate() error {
	if !Text(filter.Query, 100, false) || filter.Limit < 1 || filter.Limit > 101 || (filter.After != nil && filter.Before != nil) {
		return apperror.Validation("invalid admin list filter")
	}
	switch filter.State {
	case "", "active", "inactive", "deleted", "suspended", "revoked":
		return nil
	default:
		return apperror.Validation("invalid admin state filter")
	}
}

func (filter Filter) Cursor() (any, any, bool) {
	if filter.Before != nil {
		return filter.Before.Timestamp, filter.Before.ID, true
	}
	if filter.After != nil {
		return filter.After.Timestamp, filter.After.ID, false
	}
	return nil, nil, false
}

// Prefix treats user-supplied SQL wildcard characters literally.
func Prefix(query string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.ToLower(strings.TrimSpace(query))) + "%"
}

func UUID(id string) bool {
	var value pgtype.UUID
	return len(id) == 36 && value.Scan(id) == nil && value.Valid
}

func Text(value string, maximum int, required bool) bool {
	return utf8.ValidString(value) && !strings.ContainsRune(value, 0) && utf8.RuneCountInString(value) <= maximum && (!required || strings.TrimSpace(value) != "")
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func Slug(value string) bool { return len(value) <= 120 && slugPattern.MatchString(value) }

func URL(value string) bool {
	if value == "" {
		return true
	}
	u, err := url.Parse(value)
	return err == nil && len(value) <= 2048 && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil
}

func Error(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		return apperror.New(apperror.KindConflict, "admin_record_already_exists", "record already exists")
	}
	return err
}

// RevokeSessions ends both public and privileged sessions within the domain
// transaction, and records the security event in that same transaction.
func RevokeSessions(ctx context.Context, tx pgx.Tx, userID string, command Command, reasonCode string) error {
	if _, err := tx.Exec(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
	 WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE admin_sessions SET revoked_at=clock_timestamp(),revocation_reason=$2
	 WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID, reasonCode)
	if err != nil {
		return err
	}
	count := int(tag.RowsAffected())
	_, err = adminsecurity.NewPostgresStoreForTransaction(tx).Insert(ctx, adminsecurity.WriteInput{
		Type: adminsecurity.EventSessionRevoked, Outcome: adminsecurity.OutcomeSucceeded,
		ActorUserID: command.Correlation.ActorUserID, AdminSessionID: command.Correlation.AdminSessionID, RequestID: command.Correlation.RequestID,
		Metadata: adminsecurity.Metadata{TargetUserID: userID, ReasonCode: reasonCode, RevokedSessionCount: &count},
	})
	return err
}
