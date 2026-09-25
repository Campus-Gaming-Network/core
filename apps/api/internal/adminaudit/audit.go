// Package adminaudit records append-only Admin Console domain history using
// closed, privacy-reviewed state and metadata schemas.
package adminaudit

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

type Action string

const (
	ActionReportUpdated          Action = "report.updated"
	ActionSupportTicketUpdated   Action = "support_ticket.updated"
	ActionSiteRoleGrantBootstrap Action = "site_role_grant.bootstrapped"
	ActionSiteRoleGrantGranted   Action = "site_role_grant.granted"
	ActionSiteRoleGrantRevoked   Action = "site_role_grant.revoked"
	ActionSchoolCreated          Action = "school.created"
	ActionSchoolUpdated          Action = "school.updated"
	ActionSchoolDeactivated      Action = "school.deactivated"
	ActionSchoolReactivated      Action = "school.reactivated"
	ActionSchoolDeleted          Action = "school.deleted"
	ActionGameCreated            Action = "game.created"
	ActionGameUpdated            Action = "game.updated"
	ActionGameDeleted            Action = "game.deleted"
	ActionUserSuspended          Action = "user.suspended"
	ActionUserReactivated        Action = "user.reactivated"
	ActionTrustChanged           Action = "user.trust_changed"
	ActionSchoolGrantGranted     Action = "school_admin.granted"
	ActionSchoolGrantRevoked     Action = "school_admin.revoked"
)

type EntityType string

const (
	EntityReport        EntityType = "report"
	EntitySupportTicket EntityType = "support_ticket"
	EntitySiteRoleGrant EntityType = "site_role_grant"
	EntitySchool        EntityType = "school"
	EntityGame          EntityType = "game"
	EntityUser          EntityType = "user"
	EntitySchoolGrant   EntityType = "school_admin"
)

var (
	ErrInvalidAudit       = errors.New("invalid admin audit record")
	ErrSensitiveAuditData = errors.New("sensitive data is prohibited in admin audit records")
)

type Correlation struct {
	ActorUserID    string
	AdminSessionID string
	RequestID      string
}

// State is implemented only by the closed audit-state schemas in this
// package. Raw request bodies and arbitrary maps cannot be passed to Writer.
type State interface {
	auditState()
}

type EmptyState struct{}

func (EmptyState) auditState() {}

type QueueState struct {
	Status             string     `json:"status"`
	AssignedToUserID   *string    `json:"assigned_to_user_id"`
	RetentionStartedAt *time.Time `json:"retention_started_at"`
}

func (QueueState) auditState() {}

type SiteRoleGrantState struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	Role            string     `json:"role"`
	GrantedByUserID *string    `json:"granted_by_user_id,omitempty"`
	GrantReason     string     `json:"grant_reason"`
	GrantedAt       time.Time  `json:"granted_at"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
	RevokedByUserID *string    `json:"revoked_by_user_id,omitempty"`
	RevokeReason    *string    `json:"revoke_reason,omitempty"`
}

func (SiteRoleGrantState) auditState() {}

// CatalogState contains public catalog identity and lifecycle state only.
// The version records other field edits without duplicating arbitrary text.
type CatalogState struct {
	Slug      string     `json:"slug"`
	Active    bool       `json:"is_active"`
	DeletedAt *time.Time `json:"deleted_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (CatalogState) auditState() {}

type AccountState struct {
	Status            string `json:"account_status"`
	VerificationLevel string `json:"verification_level"`
}

func (AccountState) auditState() {}

type SchoolGrantState struct {
	SchoolID  string     `json:"school_id"`
	UserID    string     `json:"user_id"`
	RevokedAt *time.Time `json:"revoked_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (SchoolGrantState) auditState() {}

// Metadata is closed so queue text, request bodies, and arbitrary values
// cannot be copied into durable audit history.
type Metadata struct {
	ResolutionNoteChanged bool   `json:"resolution_note_changed,omitempty"`
	Bootstrap             bool   `json:"bootstrap,omitempty"`
	OperatorIdentity      string `json:"operator_identity,omitempty"`
	OperatorReason        string `json:"operator_reason,omitempty"`
}

type WriteInput struct {
	Correlation Correlation
	Action      Action
	EntityType  EntityType
	EntityID    string
	Before      State
	After       State
	Metadata    Metadata
}

type Entry struct {
	ID             string          `json:"id"`
	ActorUserID    *string         `json:"actor_user_id,omitempty"`
	AdminSessionID *string         `json:"admin_session_id,omitempty"`
	RequestID      *string         `json:"request_id,omitempty"`
	Action         Action          `json:"action"`
	EntityType     EntityType      `json:"entity_type"`
	EntityID       string          `json:"entity_id"`
	Before         json.RawMessage `json:"before"`
	After          json.RawMessage `json:"after"`
	Metadata       json.RawMessage `json:"metadata"`
	CreatedAt      time.Time       `json:"created_at"`
}

type ListParams struct {
	EntityType EntityType
	EntityID   string
	Limit      int
	After      *pagecursor.Cursor
	Before     *pagecursor.Cursor
}

// Writer is the append-only domain-audit surface. Implementations
// intentionally expose no update or deletion method.
type Writer interface {
	Insert(context.Context, WriteInput) (Entry, error)
}

func (correlation Correlation) Validate() error {
	if !validOptionalUUID(correlation.ActorUserID) || !validOptionalUUID(correlation.AdminSessionID) {
		return ErrInvalidAudit
	}
	requestID := strings.TrimSpace(correlation.RequestID)
	if (correlation.RequestID != "" && requestID == "") || utf8.RuneCountInString(requestID) > 128 {
		return ErrInvalidAudit
	}
	if (correlation.AdminSessionID == "") != (requestID == "") {
		return ErrInvalidAudit
	}
	return nil
}

func (input WriteInput) validate() error {
	if err := input.Correlation.Validate(); err != nil || !validUUID(input.EntityID) {
		return ErrInvalidAudit
	}
	if !validActionEntity(input.Action, input.EntityType) || input.After == nil ||
		!validState(input.EntityType, input.Before, true) || !validState(input.EntityType, input.After, false) {
		return ErrInvalidAudit
	}
	if input.Action == ActionReportUpdated || input.Action == ActionSupportTicketUpdated {
		if input.Correlation.ActorUserID == "" || input.Correlation.AdminSessionID == "" || input.Correlation.RequestID == "" {
			return ErrInvalidAudit
		}
	}
	if input.Action == ActionSiteRoleGrantGranted || input.Action == ActionSiteRoleGrantRevoked {
		if input.Correlation.ActorUserID == "" {
			return ErrInvalidAudit
		}
	}
	if input.EntityType == EntitySchool || input.EntityType == EntityGame || input.EntityType == EntityUser || input.EntityType == EntitySchoolGrant {
		if input.Correlation.ActorUserID == "" || input.Correlation.AdminSessionID == "" || input.Correlation.RequestID == "" || strings.TrimSpace(input.Metadata.OperatorReason) == "" {
			return ErrInvalidAudit
		}
	}
	if utf8.RuneCountInString(input.Metadata.OperatorReason) > 1000 {
		return ErrInvalidAudit
	}
	if utf8.RuneCountInString(strings.TrimSpace(input.Metadata.OperatorIdentity)) > 320 ||
		(input.Metadata.OperatorIdentity != "" && strings.TrimSpace(input.Metadata.OperatorIdentity) == "") {
		return ErrInvalidAudit
	}
	if input.Action == ActionSiteRoleGrantBootstrap {
		if !input.Metadata.Bootstrap || input.Metadata.OperatorIdentity == "" ||
			input.Correlation != (Correlation{}) {
			return ErrInvalidAudit
		}
	} else if input.Metadata.Bootstrap || input.Metadata.OperatorIdentity != "" {
		return ErrInvalidAudit
	}
	if input.EntityType == EntitySiteRoleGrant && input.Metadata.ResolutionNoteChanged {
		return ErrInvalidAudit
	}
	return nil
}

func (params ListParams) validate() error {
	if !validEntityType(params.EntityType) || !validUUID(params.EntityID) || params.Limit < 0 || params.Limit > 201 {
		return ErrInvalidAudit
	}
	if params.After != nil && params.Before != nil {
		return ErrInvalidAudit
	}
	return nil
}

// ValidateSafeDocuments scans encoded audit/security fixtures for field names
// that must never enter durable administrative history.
func ValidateSafeDocuments(documents ...[]byte) error {
	prohibited := map[string]struct{}{
		"access_assertion":    {},
		"access_email":        {},
		"access_subject":      {},
		"access_token":        {},
		"authorization":       {},
		"body":                {},
		"contact_email":       {},
		"cookie":              {},
		"csrf_token":          {},
		"csrf_token_hash":     {},
		"email":               {},
		"ip_address":          {},
		"message":             {},
		"name":                {},
		"password":            {},
		"password_hash":       {},
		"proxy_shared_secret": {},
		"raw_request":         {},
		"reason":              {},
		"refresh_token":       {},
		"report_reason":       {},
		"request_body":        {},
		"resolution_note":     {},
		"session_token":       {},
		"set_cookie":          {},
		"subject":             {},
		"token":               {},
		"token_hash":          {},
	}
	for _, document := range documents {
		var value any
		if err := json.Unmarshal(document, &value); err != nil {
			return ErrInvalidAudit
		}
		stack := []any{value}
		for len(stack) > 0 {
			current := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			switch typed := current.(type) {
			case map[string]any:
				for key, child := range typed {
					if _, found := prohibited[strings.ToLower(strings.TrimSpace(key))]; found {
						return ErrSensitiveAuditData
					}
					stack = append(stack, child)
				}
			case []any:
				stack = append(stack, typed...)
			}
		}
	}
	return nil
}

func validActionEntity(action Action, entityType EntityType) bool {
	switch action {
	case ActionReportUpdated:
		return entityType == EntityReport
	case ActionSupportTicketUpdated:
		return entityType == EntitySupportTicket
	case ActionSiteRoleGrantBootstrap, ActionSiteRoleGrantGranted, ActionSiteRoleGrantRevoked:
		return entityType == EntitySiteRoleGrant
	case ActionSchoolCreated, ActionSchoolUpdated, ActionSchoolDeactivated, ActionSchoolReactivated, ActionSchoolDeleted:
		return entityType == EntitySchool
	case ActionGameCreated, ActionGameUpdated, ActionGameDeleted:
		return entityType == EntityGame
	case ActionUserSuspended, ActionUserReactivated, ActionTrustChanged:
		return entityType == EntityUser
	case ActionSchoolGrantGranted, ActionSchoolGrantRevoked:
		return entityType == EntitySchoolGrant
	default:
		return false
	}
}

func validEntityType(entityType EntityType) bool {
	return entityType == EntityReport || entityType == EntitySupportTicket || entityType == EntitySiteRoleGrant ||
		entityType == EntitySchool || entityType == EntityGame || entityType == EntityUser || entityType == EntitySchoolGrant
}

func validState(entityType EntityType, state State, allowEmpty bool) bool {
	switch typed := state.(type) {
	case nil:
		return false
	case EmptyState:
		return allowEmpty
	case CatalogState:
		return (entityType == EntitySchool || entityType == EntityGame) && typed.Slug != "" && !typed.UpdatedAt.IsZero()
	case AccountState:
		return entityType == EntityUser && (typed.Status == "active" || typed.Status == "suspended" || typed.Status == "deleted") &&
			(typed.VerificationLevel == "basic" || typed.VerificationLevel == "verified" || typed.VerificationLevel == "staff_faculty")
	case SchoolGrantState:
		return entityType == EntitySchoolGrant && validUUID(typed.SchoolID) && validUUID(typed.UserID) && !typed.UpdatedAt.IsZero()
	case QueueState:
		return (entityType == EntityReport || entityType == EntitySupportTicket) &&
			validQueueStatus(typed.Status) && validOptionalUUIDPointer(typed.AssignedToUserID)
	case SiteRoleGrantState:
		return entityType == EntitySiteRoleGrant && validUUID(typed.ID) && validUUID(typed.UserID) &&
			typed.Role == "site_admin" && validOptionalUUIDPointer(typed.GrantedByUserID) &&
			validOptionalUUIDPointer(typed.RevokedByUserID) &&
			strings.TrimSpace(typed.GrantReason) != "" && utf8.RuneCountInString(typed.GrantReason) <= 1000 &&
			(typed.RevokeReason == nil || utf8.RuneCountInString(strings.TrimSpace(*typed.RevokeReason)) <= 1000)
	default:
		return false
	}
}

func validQueueStatus(status string) bool {
	return status == "open" || status == "in_review" || status == "resolved" || status == "closed"
}

func validOptionalUUIDPointer(value *string) bool {
	return value == nil || validUUID(*value)
}

func validOptionalUUID(value string) bool {
	return value == "" || validUUID(value)
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}
