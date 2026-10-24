// Package adminaudit records append-only Admin Console domain history using
// closed, privacy-reviewed state and metadata schemas.
package adminaudit

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

// Action names the change an audit entry records, in "entity.verb" form.
type Action string

// Audit actions. Each is valid for exactly one EntityType.
const (
	ActionReportUpdated        Action = "report.updated"
	ActionSupportTicketUpdated Action = "support_ticket.updated"
	// ActionReportAssigneeDeleted and ActionSupportTicketAssigneeDeleted
	// record work unassigned because its assignee deleted their account. The
	// deleted account is the actor; no admin session is involved.
	ActionReportAssigneeDeleted        Action = "report.assignee_deleted"
	ActionSupportTicketAssigneeDeleted Action = "support_ticket.assignee_deleted"
	ActionSiteRoleGrantBootstrap       Action = "site_role_grant.bootstrapped"
	ActionSiteRoleGrantGranted         Action = "site_role_grant.granted"
	ActionSiteRoleGrantRevoked         Action = "site_role_grant.revoked"
	ActionSchoolCreated                Action = "school.created"
	ActionSchoolUpdated                Action = "school.updated"
	ActionSchoolDeactivated            Action = "school.deactivated"
	ActionSchoolReactivated            Action = "school.reactivated"
	ActionSchoolDeleted                Action = "school.deleted"
	ActionSchoolLogoUpdated            Action = "school.logo_updated"
	ActionSchoolLogoRemoved            Action = "school.logo_removed"
	ActionGameCreated                  Action = "game.created"
	ActionGameUpdated                  Action = "game.updated"
	ActionGameDeleted                  Action = "game.deleted"
	ActionGameImported                 Action = "game.imported"
	ActionGameRefreshed                Action = "game.refreshed"
	ActionUserSuspended                Action = "user.suspended"
	ActionUserReactivated              Action = "user.reactivated"
	ActionTrustChanged                 Action = "user.trust_changed"
	ActionSchoolGrantGranted           Action = "school_admin.granted"
	ActionSchoolGrantRevoked           Action = "school_admin.revoked"
	ActionClubCreated                  Action = "club.created"
	ActionClubUpdated                  Action = "club.updated"
	ActionClubLinksReplaced            Action = "club.links_replaced"
	ActionClubHidden                   Action = "club.hidden"
	ActionClubUnhidden                 Action = "club.unhidden"
	ActionClubChecked                  Action = "club.checked"
	// ActionClubMemberRemoved shares its name with the removal an officer
	// makes on the public site; a site admin's carries a reason.
	ActionClubMemberRemoved Action = "club.member_removed"
	ActionClubClaimApproved Action = "club_claim.approved"
	ActionClubClaimRejected Action = "club_claim.rejected"
)

// EntityType names the kind of record an audit entry is about.
type EntityType string

const (
	// Audit entity types, stored in audit_logs.entity_type.
	EntityReport        EntityType = "report"
	EntitySupportTicket EntityType = "support_ticket"
	EntitySiteRoleGrant EntityType = "site_role_grant"
	EntitySchool        EntityType = "school"
	EntityGame          EntityType = "game"
	EntityUser          EntityType = "user"
	EntitySchoolGrant   EntityType = "school_admin"
	EntityClub          EntityType = "club"
	EntityClubClaim     EntityType = "club_claim"
)

// Errors returned when validating and writing audit records.
var (
	ErrInvalidAudit = errors.New("invalid admin audit record")
	// ErrWriteFailed marks any failure to record an audit row, so the request
	// log can raise the "no audit, no mutation" alert without parsing messages.
	ErrWriteFailed        = errors.New("admin audit write failed")
	ErrSensitiveAuditData = errors.New("sensitive data is prohibited in admin audit records")
)

// Correlation ties an audit entry to the admin who made the change and the
// request that carried it.
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

// EmptyState is the Before state of a creation, when no prior record existed.
type EmptyState struct{}

func (EmptyState) auditState() {}

// QueueState is the audit state of a report or support ticket.
type QueueState struct {
	Status             string     `json:"status"`
	AssignedToUserID   *string    `json:"assigned_to_user_id"`
	RetentionStartedAt *time.Time `json:"retention_started_at"`
}

func (QueueState) auditState() {}

// SiteRoleGrantState is the audit state of a site role grant.
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
	// LogoURL is a public asset URL; games never set it.
	LogoURL string `json:"logo_url,omitempty"`
}

func (CatalogState) auditState() {}

// AccountState is the audit state of a user's account status and verification
// level.
type AccountState struct {
	Status            string `json:"account_status"`
	VerificationLevel string `json:"verification_level"`
}

func (AccountState) auditState() {}

// SchoolGrantState is the audit state of a school administrator grant.
type SchoolGrantState struct {
	SchoolID  string     `json:"school_id"`
	UserID    string     `json:"user_id"`
	RevokedAt *time.Time `json:"revoked_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (SchoolGrantState) auditState() {}

// ClubMemberState is one person's role in a club; an empty role means they
// are no longer in it.
type ClubMemberState struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

func (ClubMemberState) auditState() {}

// ClubClaimState is a claim's review state. The evidence, the applicant, and
// the review note stay out of the audit; the note is the operator reason.
type ClubClaimState struct {
	Status string `json:"status"`
	// ClubID is the claimed club, or the club an approved request created.
	ClubID    *string   `json:"club_id"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ClubClaimState) auditState() {}

// Metadata is closed so queue text, request bodies, and arbitrary values
// cannot be copied into durable audit history.
type Metadata struct {
	ResolutionNoteChanged bool   `json:"resolution_note_changed,omitempty"`
	Bootstrap             bool   `json:"bootstrap,omitempty"`
	OperatorIdentity      string `json:"operator_identity,omitempty"`
	OperatorReason        string `json:"operator_reason,omitempty"`
	// EditedFields names the form fields a school or game update changed. It
	// holds field names only, never their values.
	EditedFields []string `json:"edited_fields,omitempty"`
}

// WriteInput is one audit row to record. Before and After must be the state
// schema that matches EntityType.
type WriteInput struct {
	Correlation Correlation
	Action      Action
	EntityType  EntityType
	EntityID    string
	Before      State
	After       State
	Metadata    Metadata
}

// Entry is a stored audit row. The state and metadata columns stay as raw
// JSON, already validated when written.
type Entry struct {
	ID             string          `json:"id"`
	ActorUserID    *string         `json:"actor_user_id,omitempty"`
	ActorName      *string         `json:"actor_name,omitempty"`
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

// ListParams selects a page of the audit history for one record. After and
// Before are mutually exclusive cursors; a zero Limit uses the default.
type ListParams struct {
	EntityType EntityType
	EntityID   string
	Limit      int
	After      *pagecursor.Cursor
	Before     *pagecursor.Cursor
}

// LogEntry is one row of the console-wide audit log. The target is the record
// page an operator opens to see the change in context: a grant points at its
// user or school, every other entity points at itself.
type LogEntry struct {
	Entry
	TargetType EntityType `json:"target_type"`
	// TargetID is nil when the granted record no longer exists.
	TargetID *string `json:"target_id,omitempty"`
	// TargetName is nil for reports and support tickets, which have no name.
	TargetName *string `json:"target_name,omitempty"`
}

// LogParams selects a page of the console-wide audit log. An empty EntityType
// lists every entity.
type LogParams struct {
	EntityType EntityType
	Limit      int
	After      *pagecursor.Cursor
	Before     *pagecursor.Cursor
}

// Writer is the append-only domain-audit surface. Implementations
// intentionally expose no update or deletion method.
type Writer interface {
	Insert(context.Context, WriteInput) (Entry, error)
}

// Validate reports ErrInvalidAudit when the IDs are not UUIDs, the request ID
// is blank or longer than 128 characters, or an admin session and request ID
// are not supplied together.
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
	if input.Action == ActionReportAssigneeDeleted || input.Action == ActionSupportTicketAssigneeDeleted {
		before, _ := input.Before.(QueueState)
		after, _ := input.After.(QueueState)
		if input.Correlation.ActorUserID == "" || input.Correlation.AdminSessionID != "" ||
			before.AssignedToUserID == nil || *before.AssignedToUserID != input.Correlation.ActorUserID ||
			after.AssignedToUserID != nil {
			return ErrInvalidAudit
		}
	}
	if input.Action == ActionSiteRoleGrantGranted || input.Action == ActionSiteRoleGrantRevoked {
		if input.Correlation.ActorUserID == "" {
			return ErrInvalidAudit
		}
	}
	if input.EntityType == EntitySchool || input.EntityType == EntityGame || input.EntityType == EntityUser || input.EntityType == EntitySchoolGrant ||
		input.EntityType == EntityClub || input.EntityType == EntityClubClaim {
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
	if len(input.Metadata.EditedFields) > 0 && input.Action != ActionSchoolUpdated && input.Action != ActionGameUpdated &&
		input.Action != ActionClubUpdated {
		return ErrInvalidAudit
	}
	if len(input.Metadata.EditedFields) > maximumEditedFields {
		return ErrInvalidAudit
	}
	for _, name := range input.Metadata.EditedFields {
		if !fieldNamePattern.MatchString(name) {
			return ErrInvalidAudit
		}
	}
	return nil
}

// maximumEditedFields bounds Metadata.EditedFields above the largest edit
// form, the school form's 13 fields.
const maximumEditedFields = 32

var fieldNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func (params ListParams) validate() error {
	if !validEntityType(params.EntityType) || !validUUID(params.EntityID) || params.Limit < 0 || params.Limit > 201 {
		return ErrInvalidAudit
	}
	if params.After != nil && params.Before != nil {
		return ErrInvalidAudit
	}
	return nil
}

func (params LogParams) validate() error {
	if (params.EntityType != "" && !validEntityType(params.EntityType)) || params.Limit < 0 || params.Limit > 201 {
		return ErrInvalidAudit
	}
	if params.After != nil && params.Before != nil {
		return ErrInvalidAudit
	}
	return nil
}

// ValidEntityType reports whether entityType is one the audit log records.
func ValidEntityType(entityType EntityType) bool {
	return validEntityType(entityType)
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
	case ActionReportUpdated, ActionReportAssigneeDeleted:
		return entityType == EntityReport
	case ActionSupportTicketUpdated, ActionSupportTicketAssigneeDeleted:
		return entityType == EntitySupportTicket
	case ActionSiteRoleGrantBootstrap, ActionSiteRoleGrantGranted, ActionSiteRoleGrantRevoked:
		return entityType == EntitySiteRoleGrant
	case ActionSchoolCreated, ActionSchoolUpdated, ActionSchoolDeactivated, ActionSchoolReactivated, ActionSchoolDeleted,
		ActionSchoolLogoUpdated, ActionSchoolLogoRemoved:
		return entityType == EntitySchool
	case ActionGameCreated, ActionGameUpdated, ActionGameDeleted, ActionGameImported, ActionGameRefreshed:
		return entityType == EntityGame
	case ActionUserSuspended, ActionUserReactivated, ActionTrustChanged:
		return entityType == EntityUser
	case ActionSchoolGrantGranted, ActionSchoolGrantRevoked:
		return entityType == EntitySchoolGrant
	case ActionClubCreated, ActionClubUpdated, ActionClubLinksReplaced, ActionClubHidden, ActionClubUnhidden, ActionClubChecked,
		ActionClubMemberRemoved:
		return entityType == EntityClub
	case ActionClubClaimApproved, ActionClubClaimRejected:
		return entityType == EntityClubClaim
	default:
		return false
	}
}

func validEntityType(entityType EntityType) bool {
	return entityType == EntityReport || entityType == EntitySupportTicket || entityType == EntitySiteRoleGrant ||
		entityType == EntitySchool || entityType == EntityGame || entityType == EntityUser || entityType == EntitySchoolGrant ||
		entityType == EntityClub || entityType == EntityClubClaim
}

func validState(entityType EntityType, state State, allowEmpty bool) bool {
	switch typed := state.(type) {
	case nil:
		return false
	case EmptyState:
		return allowEmpty
	case CatalogState:
		return (entityType == EntitySchool || entityType == EntityGame || entityType == EntityClub) && typed.Slug != "" && !typed.UpdatedAt.IsZero()
	case AccountState:
		return entityType == EntityUser && (typed.Status == "active" || typed.Status == "suspended" || typed.Status == "deleted") &&
			(typed.VerificationLevel == "basic" || typed.VerificationLevel == "verified" || typed.VerificationLevel == "staff_faculty")
	case SchoolGrantState:
		return entityType == EntitySchoolGrant && validUUID(typed.SchoolID) && validUUID(typed.UserID) && !typed.UpdatedAt.IsZero()
	case ClubMemberState:
		return entityType == EntityClub && validUUID(typed.UserID) &&
			(typed.Role == "" || typed.Role == "owner" || typed.Role == "editor" || typed.Role == "member")
	case ClubClaimState:
		return entityType == EntityClubClaim && (typed.Status == "pending" || typed.Status == "approved" || typed.Status == "rejected") &&
			validOptionalUUIDPointer(typed.ClubID) && !typed.UpdatedAt.IsZero()
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
