// Package adminaccess defines site-wide administrative roles and capabilities
// and persists the revocable grants used by the Admin Console.
package adminaccess

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maximumReasonLength            = 1000
	maximumBootstrapOperatorLength = 320
)

// Role identifies a site-wide administrative role. Version one intentionally
// supports only site administrators.
type Role string

const RoleSiteAdmin Role = "site_admin"

// Capability is a server-enforced permission. Callers must ask for the
// capability required by an operation rather than checking a role directly.
type Capability string

const (
	CapabilityAdminSessionRead   Capability = "admin.session.read"
	CapabilityReportsRead        Capability = "reports.read"
	CapabilityReportsManage      Capability = "reports.manage"
	CapabilitySupportRead        Capability = "support.read"
	CapabilitySupportManage      Capability = "support.manage"
	CapabilitySchoolsRead        Capability = "schools.read"
	CapabilitySchoolsManage      Capability = "schools.manage"
	CapabilitySchoolLogosManage  Capability = "school_logos.manage"
	CapabilityGamesManage        Capability = "games.manage"
	CapabilityUsersRead          Capability = "users.read"
	CapabilityUsersManageStatus  Capability = "users.manage_status"
	CapabilitySchoolGrantsManage Capability = "school_grants.manage"
	CapabilityTrustGrantsManage  Capability = "trust_grants.manage"
	CapabilitySiteGrantsManage   Capability = "site_grants.manage"
	CapabilityAuditRead          Capability = "audit.read"
)

var siteAdminCapabilities = []Capability{
	CapabilityAdminSessionRead,
	CapabilityReportsRead,
	CapabilityReportsManage,
	CapabilitySupportRead,
	CapabilitySupportManage,
	CapabilitySchoolsRead,
	CapabilitySchoolsManage,
	CapabilitySchoolLogosManage,
	CapabilityGamesManage,
	CapabilityUsersRead,
	CapabilityUsersManageStatus,
	CapabilitySchoolGrantsManage,
	CapabilityTrustGrantsManage,
	CapabilitySiteGrantsManage,
	CapabilityAuditRead,
}

var (
	ErrGrantNotFound = apperror.New(
		apperror.KindNotFound,
		"site_role_grant_not_found",
		"active site role grant not found",
	)
	ErrGrantAlreadyActive = apperror.New(
		apperror.KindConflict,
		"site_role_grant_already_active",
		"site role grant is already active",
	)
	ErrLastActiveSiteAdmin = apperror.New(
		apperror.KindConflict,
		"last_site_admin",
		"cannot revoke the last active site administrator",
	)
	ErrUserNotEligible = apperror.New(
		apperror.KindUnprocessable,
		"site_role_user_not_eligible",
		"site role user must be an active, verified account",
	)
	ErrSiteAdminRequired = apperror.New(
		apperror.KindAuthorization,
		"site_admin_required",
		"an active site administrator grant is required",
	)
	ErrBootstrapUnavailable = apperror.New(
		apperror.KindConflict,
		"site_admin_bootstrap_unavailable",
		"site administrator bootstrap is unavailable after the initial grant",
	)
)

// Allows reports whether role grants capability. Unknown roles and
// capabilities are denied by default.
func Allows(role Role, capability Capability) bool {
	if role != RoleSiteAdmin {
		return false
	}
	for _, allowed := range siteAdminCapabilities {
		if capability == allowed {
			return true
		}
	}
	return false
}

// CapabilitiesForRole returns a copy of the role's static capability set.
// Unknown roles receive no capabilities.
func CapabilitiesForRole(role Role) []Capability {
	if role != RoleSiteAdmin {
		return nil
	}
	capabilities := make([]Capability, len(siteAdminCapabilities))
	copy(capabilities, siteAdminCapabilities)
	return capabilities
}

// Grant records the full lifecycle and provenance of a site-wide role grant.
type Grant struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	Role            Role       `json:"role"`
	GrantedByUserID *string    `json:"granted_by_user_id,omitempty"`
	GrantReason     string     `json:"grant_reason"`
	GrantedAt       time.Time  `json:"granted_at"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
	RevokedByUserID *string    `json:"revoked_by_user_id,omitempty"`
	RevokeReason    *string    `json:"revoke_reason,omitempty"`
}

type GrantInput struct {
	UserID      string
	Role        Role
	ActorUserID string
	Reason      string
}

type RevokeInput struct {
	UserID      string
	Role        Role
	ActorUserID string
	Reason      string
}

// BootstrapInput is deliberately separate from GrantInput: it is the only
// path that does not require an existing administrator, and it succeeds only
// while no active site administrator grant exists.
type BootstrapInput struct {
	UserID           string
	OperatorIdentity string
	Reason           string
}

// Repository is the persistence boundary for site-wide role grants.
type Repository interface {
	ActiveGrant(ctx context.Context, userID string, role Role) (Grant, error)
	BootstrapSiteAdmin(ctx context.Context, input BootstrapInput) (Grant, error)
	GrantRole(ctx context.Context, input GrantInput) (Grant, error)
	RevokeRole(ctx context.Context, input RevokeInput) (Grant, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func ValidateGrantInput(input GrantInput) error {
	if err := validateUserID(input.UserID, "site role user"); err != nil {
		return err
	}
	if err := validateRole(input.Role); err != nil {
		return err
	}
	if err := validateUserID(input.ActorUserID, "site role actor"); err != nil {
		return err
	}
	return validateReason(input.Reason)
}

func ValidateBootstrapInput(input BootstrapInput) error {
	if err := validateUserID(input.UserID, "site role user"); err != nil {
		return err
	}
	operatorIdentity := strings.TrimSpace(input.OperatorIdentity)
	if operatorIdentity == "" || utf8.RuneCountInString(operatorIdentity) > maximumBootstrapOperatorLength {
		return apperror.Validation("bootstrap operator identity is required and must be 320 characters or fewer")
	}
	return validateReason(input.Reason)
}

func ValidateRevokeInput(input RevokeInput) error {
	if err := validateUserID(input.UserID, "site role user"); err != nil {
		return err
	}
	if err := validateRole(input.Role); err != nil {
		return err
	}
	if err := validateUserID(input.ActorUserID, "site role actor"); err != nil {
		return err
	}
	return validateReason(input.Reason)
}

func (r *PostgresRepository) ActiveGrant(ctx context.Context, userID string, role Role) (Grant, error) {
	userID = strings.TrimSpace(userID)
	if err := validateUserID(userID, "site role user"); err != nil {
		return Grant{}, err
	}
	if err := validateRole(role); err != nil {
		return Grant{}, err
	}

	grant, err := scanGrant(r.pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, role, granted_by_user_id::text,
		       grant_reason, granted_at, revoked_at, revoked_by_user_id::text,
		       revoke_reason
		FROM site_role_grants
		WHERE user_id = $1::uuid AND role = $2 AND revoked_at IS NULL
	`, userID, role))
	if errors.Is(err, pgx.ErrNoRows) {
		return Grant{}, ErrGrantNotFound
	}
	if err != nil {
		return Grant{}, fmt.Errorf("get active site role grant: %w", err)
	}
	return grant, nil
}

// BootstrapSiteAdmin creates the first site-administrator grant. Production
// callers should expose this only through an explicit operator-controlled CLI
// or recovery command, never through an HTTP route.
func (r *PostgresRepository) BootstrapSiteAdmin(ctx context.Context, input BootstrapInput) (Grant, error) {
	input = normalizeBootstrapInput(input)
	if err := ValidateBootstrapInput(input); err != nil {
		return Grant{}, err
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Grant{}, fmt.Errorf("begin site administrator bootstrap: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `LOCK TABLE site_role_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return Grant{}, fmt.Errorf("lock site role grants: %w", err)
	}
	if eligible, err := eligibleAdminUserExists(ctx, tx, input.UserID); err != nil {
		return Grant{}, err
	} else if !eligible {
		return Grant{}, ErrUserNotEligible
	}

	var activeAdmins int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM site_role_grants
		WHERE role = $1 AND revoked_at IS NULL
	`, RoleSiteAdmin).Scan(&activeAdmins); err != nil {
		return Grant{}, fmt.Errorf("count active site administrators for bootstrap: %w", err)
	}
	if activeAdmins != 0 {
		return Grant{}, ErrBootstrapUnavailable
	}

	grant, err := scanGrant(tx.QueryRow(ctx, `
		INSERT INTO site_role_grants (
			user_id, role, granted_by_user_id, grant_reason
		)
		VALUES ($1::uuid, $2, NULL, $3)
		RETURNING id::text, user_id::text, role, granted_by_user_id::text,
		          grant_reason, granted_at, revoked_at, revoked_by_user_id::text,
		          revoke_reason
	`, input.UserID, RoleSiteAdmin, input.Reason))
	if err != nil {
		return Grant{}, fmt.Errorf("insert bootstrap site administrator: %w", err)
	}
	if err := insertGrantAudit(ctx, tx, "", "site_role_grant.bootstrapped", Grant{}, grant, grantAuditMetadata{
		Bootstrap:        true,
		OperatorIdentity: input.OperatorIdentity,
	}); err != nil {
		return Grant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Grant{}, fmt.Errorf("commit site administrator bootstrap: %w", err)
	}
	return grant, nil
}

func (r *PostgresRepository) GrantRole(ctx context.Context, input GrantInput) (Grant, error) {
	input = normalizeGrantInput(input)
	if err := ValidateGrantInput(input); err != nil {
		return Grant{}, err
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Grant{}, fmt.Errorf("begin site role grant: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Role mutations are rare. Serializing them at the table boundary avoids a
	// race between concurrent grants and last-administrator revocations.
	if _, err := tx.Exec(ctx, `LOCK TABLE site_role_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return Grant{}, fmt.Errorf("lock site role grants: %w", err)
	}
	if err := requireSiteGrantManager(ctx, tx, input.ActorUserID); err != nil {
		return Grant{}, err
	}
	if eligible, err := eligibleAdminUserExists(ctx, tx, input.UserID); err != nil {
		return Grant{}, err
	} else if !eligible {
		return Grant{}, ErrUserNotEligible
	}

	var alreadyActive bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM site_role_grants
			WHERE user_id = $1::uuid AND role = $2 AND revoked_at IS NULL
		)
	`, input.UserID, input.Role).Scan(&alreadyActive); err != nil {
		return Grant{}, fmt.Errorf("check active site role grant: %w", err)
	}
	if alreadyActive {
		return Grant{}, ErrGrantAlreadyActive
	}

	grant, err := scanGrant(tx.QueryRow(ctx, `
		INSERT INTO site_role_grants (
			user_id, role, granted_by_user_id, grant_reason
		)
		VALUES ($1::uuid, $2, $3::uuid, $4)
		RETURNING id::text, user_id::text, role, granted_by_user_id::text,
		          grant_reason, granted_at, revoked_at, revoked_by_user_id::text,
		          revoke_reason
	`, input.UserID, input.Role, input.ActorUserID, input.Reason))
	if err != nil {
		if isActiveGrantUniqueViolation(err) {
			return Grant{}, ErrGrantAlreadyActive
		}
		return Grant{}, fmt.Errorf("insert site role grant: %w", err)
	}
	if err := insertGrantAudit(ctx, tx, input.ActorUserID, "site_role_grant.granted", Grant{}, grant, grantAuditMetadata{}); err != nil {
		return Grant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Grant{}, fmt.Errorf("commit site role grant: %w", err)
	}
	return grant, nil
}

func (r *PostgresRepository) RevokeRole(ctx context.Context, input RevokeInput) (Grant, error) {
	input = normalizeRevokeInput(input)
	if err := ValidateRevokeInput(input); err != nil {
		return Grant{}, err
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Grant{}, fmt.Errorf("begin site role revocation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `LOCK TABLE site_role_grants IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return Grant{}, fmt.Errorf("lock site role grants: %w", err)
	}
	if err := requireSiteGrantManager(ctx, tx, input.ActorUserID); err != nil {
		return Grant{}, err
	}

	current, err := scanGrant(tx.QueryRow(ctx, `
		SELECT id::text, user_id::text, role, granted_by_user_id::text,
		       grant_reason, granted_at, revoked_at, revoked_by_user_id::text,
		       revoke_reason
		FROM site_role_grants
		WHERE user_id = $1::uuid AND role = $2 AND revoked_at IS NULL
		FOR UPDATE
	`, input.UserID, input.Role))
	if errors.Is(err, pgx.ErrNoRows) {
		return Grant{}, ErrGrantNotFound
	}
	if err != nil {
		return Grant{}, fmt.Errorf("get site role grant for revocation: %w", err)
	}

	if input.Role == RoleSiteAdmin {
		var activeAdmins int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM site_role_grants
			WHERE role = $1 AND revoked_at IS NULL
		`, RoleSiteAdmin).Scan(&activeAdmins); err != nil {
			return Grant{}, fmt.Errorf("count active site administrators: %w", err)
		}
		if activeAdmins <= 1 {
			return Grant{}, ErrLastActiveSiteAdmin
		}
	}

	revoked, err := scanGrant(tx.QueryRow(ctx, `
		UPDATE site_role_grants
		SET revoked_at = NOW(),
		    revoked_by_user_id = $2::uuid,
		    revoke_reason = $3
		WHERE id = $1::uuid AND revoked_at IS NULL
		RETURNING id::text, user_id::text, role, granted_by_user_id::text,
		          grant_reason, granted_at, revoked_at, revoked_by_user_id::text,
		          revoke_reason
	`, current.ID, input.ActorUserID, input.Reason))
	if errors.Is(err, pgx.ErrNoRows) {
		return Grant{}, ErrGrantNotFound
	}
	if err != nil {
		return Grant{}, fmt.Errorf("revoke site role grant: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE admin_sessions
		SET revoked_at = $2,
		    revocation_reason = 'site role grant revoked'
		WHERE grant_id = $1::uuid AND revoked_at IS NULL
	`, revoked.ID, revoked.RevokedAt); err != nil {
		return Grant{}, fmt.Errorf("revoke site role grant sessions: %w", err)
	}
	if err := insertGrantAudit(ctx, tx, input.ActorUserID, "site_role_grant.revoked", current, revoked, grantAuditMetadata{}); err != nil {
		return Grant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Grant{}, fmt.Errorf("commit site role revocation: %w", err)
	}
	return revoked, nil
}

func normalizeGrantInput(input GrantInput) GrantInput {
	input.UserID = strings.TrimSpace(input.UserID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.Reason = strings.TrimSpace(input.Reason)
	return input
}

func normalizeBootstrapInput(input BootstrapInput) BootstrapInput {
	input.UserID = strings.TrimSpace(input.UserID)
	input.OperatorIdentity = strings.TrimSpace(input.OperatorIdentity)
	input.Reason = strings.TrimSpace(input.Reason)
	return input
}

func normalizeRevokeInput(input RevokeInput) RevokeInput {
	input.UserID = strings.TrimSpace(input.UserID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.Reason = strings.TrimSpace(input.Reason)
	return input
}

func validateUserID(id string, field string) error {
	var parsed pgtype.UUID
	if err := parsed.Scan(strings.TrimSpace(id)); err != nil || !parsed.Valid {
		return apperror.Validation(field + " must be a valid UUID")
	}
	return nil
}

func validateRole(role Role) error {
	if role != RoleSiteAdmin {
		return apperror.Validation("site role must be site_admin")
	}
	return nil
}

func validateReason(reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > maximumReasonLength {
		return apperror.Validation("site role reason is required and must be 1,000 characters or fewer")
	}
	return nil
}

func eligibleAdminUserExists(ctx context.Context, tx pgx.Tx, userID string) (bool, error) {
	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM users
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
			  AND account_status = 'active'
			  AND email_verified_at IS NOT NULL
		)
	`, userID).Scan(&exists); err != nil {
		return false, fmt.Errorf("check active site role user: %w", err)
	}
	return exists, nil
}

func requireSiteGrantManager(ctx context.Context, tx pgx.Tx, actorUserID string) error {
	if !Allows(RoleSiteAdmin, CapabilitySiteGrantsManage) {
		return ErrSiteAdminRequired
	}
	var authorized bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM site_role_grants g
			JOIN users u ON u.id = g.user_id
			WHERE g.user_id = $1::uuid
			  AND g.role = $2
			  AND g.revoked_at IS NULL
			  AND u.deleted_at IS NULL
			  AND u.account_status = 'active'
			  AND u.email_verified_at IS NOT NULL
		)
	`, actorUserID, RoleSiteAdmin).Scan(&authorized); err != nil {
		return fmt.Errorf("authorize site role grant actor: %w", err)
	}
	if !authorized {
		return ErrSiteAdminRequired
	}
	return nil
}

type grantAuditMetadata struct {
	Bootstrap        bool   `json:"bootstrap,omitempty"`
	OperatorIdentity string `json:"operator_identity,omitempty"`
}

func insertGrantAudit(
	ctx context.Context,
	tx pgx.Tx,
	actorUserID string,
	action string,
	before Grant,
	after Grant,
	metadata grantAuditMetadata,
) error {
	beforeJSON := []byte(`{}`)
	var err error
	if before.ID != "" {
		beforeJSON, err = json.Marshal(before)
		if err != nil {
			return fmt.Errorf("marshal site role grant audit before state: %w", err)
		}
	}
	afterJSON, err := json.Marshal(after)
	if err != nil {
		return fmt.Errorf("marshal site role grant audit after state: %w", err)
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal site role grant audit metadata: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (
			actor_user_id, action, entity_type, entity_id,
			before_json, after_json, metadata
		)
		VALUES (
			NULLIF($1, '')::uuid, $2, 'site_role_grant', $3::uuid,
			$4::jsonb, $5::jsonb, $6::jsonb
		)
	`, actorUserID, action, after.ID, beforeJSON, afterJSON, metadataJSON); err != nil {
		return fmt.Errorf("write site role grant audit: %w", err)
	}
	return nil
}

func scanGrant(row pgx.Row) (Grant, error) {
	var grant Grant
	err := row.Scan(
		&grant.ID,
		&grant.UserID,
		&grant.Role,
		&grant.GrantedByUserID,
		&grant.GrantReason,
		&grant.GrantedAt,
		&grant.RevokedAt,
		&grant.RevokedByUserID,
		&grant.RevokeReason,
	)
	return grant, err
}

func isActiveGrantUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" &&
		pgErr.ConstraintName == "site_role_grants_one_active_idx"
}
