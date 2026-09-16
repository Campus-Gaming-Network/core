// Package admincommand implements the non-networked operator workflows for
// bootstrapping, granting, revoking, and recovering Admin Console access.
package admincommand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidCommand     = errors.New("invalid administrator command")
	ErrAccountNotEligible = errors.New("active verified account required")
	ErrAccountNotFound    = errors.New("account not found")
)

type SiteAdmin struct {
	GrantID       string
	UserID        string
	Email         string
	AccountStatus string
	Eligible      bool
	GrantedAt     time.Time
}

type Service struct {
	pool   *pgxpool.Pool
	grants *adminaccess.PostgresRepository
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, grants: adminaccess.NewPostgresRepository(pool)}
}

type GrantInput struct {
	TargetEmail      string
	ActorEmail       string
	Reason           string
	Bootstrap        bool
	OperatorIdentity string
}

func (service *Service) GrantSiteAdmin(ctx context.Context, input GrantInput) (adminaccess.Grant, error) {
	if service == nil || service.pool == nil {
		return adminaccess.Grant{}, ErrInvalidCommand
	}
	input.TargetEmail = normalizeEmail(input.TargetEmail)
	input.ActorEmail = normalizeEmail(input.ActorEmail)
	input.Reason = strings.TrimSpace(input.Reason)
	input.OperatorIdentity = strings.TrimSpace(input.OperatorIdentity)
	if !validEmail(input.TargetEmail) || !validReason(input.Reason, 1000) {
		return adminaccess.Grant{}, ErrInvalidCommand
	}
	target, err := service.eligibleAccount(ctx, input.TargetEmail)
	if err != nil {
		return adminaccess.Grant{}, err
	}
	if input.Bootstrap {
		if input.ActorEmail != "" || input.OperatorIdentity == "" || utf8.RuneCountInString(input.OperatorIdentity) > 320 {
			return adminaccess.Grant{}, ErrInvalidCommand
		}
		return service.grants.BootstrapSiteAdmin(ctx, adminaccess.BootstrapInput{
			UserID: target.ID, OperatorIdentity: input.OperatorIdentity, Reason: input.Reason,
		})
	}
	if !validEmail(input.ActorEmail) {
		return adminaccess.Grant{}, ErrInvalidCommand
	}
	actor, err := service.eligibleAccount(ctx, input.ActorEmail)
	if err != nil {
		return adminaccess.Grant{}, err
	}
	return service.grants.GrantRole(ctx, adminaccess.GrantInput{
		UserID: target.ID, Role: adminaccess.RoleSiteAdmin,
		ActorUserID: actor.ID, Reason: input.Reason,
	})
}

type RevokeInput struct {
	TargetEmail string
	ActorEmail  string
	Reason      string
}

func (service *Service) RevokeSiteAdmin(ctx context.Context, input RevokeInput) (adminaccess.Grant, error) {
	if service == nil || service.pool == nil {
		return adminaccess.Grant{}, ErrInvalidCommand
	}
	input.TargetEmail = normalizeEmail(input.TargetEmail)
	input.ActorEmail = normalizeEmail(input.ActorEmail)
	input.Reason = strings.TrimSpace(input.Reason)
	if !validEmail(input.TargetEmail) || !validEmail(input.ActorEmail) || !validReason(input.Reason, 1000) {
		return adminaccess.Grant{}, ErrInvalidCommand
	}
	target, err := service.accountByEmail(ctx, input.TargetEmail, false)
	if err != nil {
		return adminaccess.Grant{}, err
	}
	actor, err := service.eligibleAccount(ctx, input.ActorEmail)
	if err != nil {
		return adminaccess.Grant{}, err
	}
	return service.grants.RevokeRole(ctx, adminaccess.RevokeInput{
		UserID: target.ID, Role: adminaccess.RoleSiteAdmin,
		ActorUserID: actor.ID, Reason: input.Reason,
	})
}

func (service *Service) ListSiteAdmins(ctx context.Context) ([]SiteAdmin, error) {
	if service == nil || service.pool == nil {
		return nil, ErrInvalidCommand
	}
	rows, err := service.pool.Query(ctx, `
		SELECT role_grant.id::text, account.id::text, account.email::text,
		       account.account_status,
		       account.deleted_at IS NULL
		           AND account.account_status = 'active'
		           AND account.email_verified_at IS NOT NULL AS eligible,
		       role_grant.granted_at
		FROM site_role_grants AS role_grant
		JOIN users AS account ON account.id = role_grant.user_id
		WHERE role_grant.role = 'site_admin'
		  AND role_grant.revoked_at IS NULL
		ORDER BY account.email, role_grant.id
	`)
	if err != nil {
		return nil, fmt.Errorf("list site administrators: %w", err)
	}
	defer rows.Close()
	admins := make([]SiteAdmin, 0)
	for rows.Next() {
		var admin SiteAdmin
		if err := rows.Scan(
			&admin.GrantID, &admin.UserID, &admin.Email, &admin.AccountStatus,
			&admin.Eligible, &admin.GrantedAt,
		); err != nil {
			return nil, fmt.Errorf("scan site administrator: %w", err)
		}
		admins = append(admins, admin)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate site administrators: %w", err)
	}
	return admins, nil
}

func (service *Service) RevokeSessions(ctx context.Context, input RevokeInput) (int64, error) {
	if service == nil || service.pool == nil {
		return 0, ErrInvalidCommand
	}
	input.TargetEmail = normalizeEmail(input.TargetEmail)
	input.ActorEmail = normalizeEmail(input.ActorEmail)
	input.Reason = strings.TrimSpace(input.Reason)
	if !validEmail(input.TargetEmail) || !validEmail(input.ActorEmail) || !validReason(input.Reason, 500) {
		return 0, ErrInvalidCommand
	}
	target, err := service.accountByEmail(ctx, input.TargetEmail, false)
	if err != nil {
		return 0, err
	}
	actor, err := service.eligibleAccount(ctx, input.ActorEmail)
	if err != nil {
		return 0, err
	}
	if _, err := service.grants.ActiveGrant(ctx, actor.ID, adminaccess.RoleSiteAdmin); err != nil {
		return 0, err
	}

	tx, err := service.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("begin administrator session revocation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	commandTag, err := tx.Exec(ctx, `
		UPDATE admin_sessions
		SET revoked_at = NOW(), revocation_reason = $2
		WHERE user_id = $1::uuid AND revoked_at IS NULL
	`, target.ID, input.Reason)
	if err != nil {
		return 0, fmt.Errorf("revoke administrator sessions: %w", err)
	}
	count := commandTag.RowsAffected()
	metadata, err := json.Marshal(struct {
		TargetUserID        string `json:"target_user_id"`
		RevokedSessionCount int64  `json:"revoked_session_count"`
		Operation           string `json:"operation"`
	}{TargetUserID: target.ID, RevokedSessionCount: count, Operation: "cli_revoke_sessions"})
	if err != nil {
		return 0, fmt.Errorf("marshal administrator session revocation event: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO admin_security_events (event_type, outcome, actor_user_id, metadata)
		VALUES ('admin.session.revoked', 'succeeded', $1::uuid, $2::jsonb)
	`, actor.ID, metadata); err != nil {
		return 0, fmt.Errorf("write administrator session revocation event: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit administrator session revocation: %w", err)
	}
	return count, nil
}

type account struct {
	ID string
}

func (service *Service) eligibleAccount(ctx context.Context, email string) (account, error) {
	return service.accountByEmail(ctx, email, true)
}

func (service *Service) accountByEmail(ctx context.Context, email string, requireEligible bool) (account, error) {
	var value account
	err := service.pool.QueryRow(ctx, `
		SELECT id::text
		FROM users
		WHERE email = $1
		  AND (
		      NOT $2
		      OR (
		          deleted_at IS NULL
		          AND account_status = 'active'
		          AND email_verified_at IS NOT NULL
		      )
		  )
	`, email, requireEligible).Scan(&value.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		if !requireEligible {
			return account{}, ErrAccountNotFound
		}
		return account{}, ErrAccountNotEligible
	}
	if err != nil {
		return account{}, fmt.Errorf("resolve eligible administrator account: %w", err)
	}
	return value, nil
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

func validReason(value string, maximum int) bool {
	value = strings.TrimSpace(value)
	return value != "" && utf8.RuneCountInString(value) <= maximum
}
