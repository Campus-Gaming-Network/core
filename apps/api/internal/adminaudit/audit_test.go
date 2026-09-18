package adminaudit

import (
	"errors"
	"testing"
)

const auditTestUUID = "00000000-0000-4000-8000-000000000001"

func TestWriteInputValidation(t *testing.T) {
	valid := WriteInput{
		Correlation: Correlation{
			ActorUserID:    auditTestUUID,
			AdminSessionID: auditTestUUID,
			RequestID:      "request-1",
		},
		Action:     ActionReportUpdated,
		EntityType: EntityReport,
		EntityID:   auditTestUUID,
		Before:     QueueState{Status: "open"},
		After:      QueueState{Status: "in_review"},
		Metadata:   Metadata{ResolutionNoteChanged: true},
	}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid audit error = %v", err)
	}

	tests := []struct {
		name  string
		input WriteInput
	}{
		{name: "unknown action", input: WriteInput{Action: "unknown", EntityType: EntityReport, EntityID: auditTestUUID, Before: QueueState{Status: "open"}, After: QueueState{Status: "closed"}}},
		{name: "action entity mismatch", input: WriteInput{Action: ActionReportUpdated, EntityType: EntitySupportTicket, EntityID: auditTestUUID, Before: QueueState{Status: "open"}, After: QueueState{Status: "closed"}}},
		{name: "missing after state", input: WriteInput{Action: ActionReportUpdated, EntityType: EntityReport, EntityID: auditTestUUID, Before: QueueState{Status: "open"}}},
		{name: "queue state for grant", input: WriteInput{Action: ActionSiteRoleGrantGranted, EntityType: EntitySiteRoleGrant, EntityID: auditTestUUID, Before: EmptyState{}, After: QueueState{Status: "open"}}},
		{name: "bootstrap metadata on update", input: WriteInput{Action: ActionReportUpdated, EntityType: EntityReport, EntityID: auditTestUUID, Before: QueueState{Status: "open"}, After: QueueState{Status: "closed"}, Metadata: Metadata{Bootstrap: true, OperatorIdentity: "operator@example.test"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.input.validate(); !errors.Is(err, ErrInvalidAudit) {
				t.Fatalf("validate() error = %v, want ErrInvalidAudit", err)
			}
		})
	}
}

func TestValidateSafeDocumentsRejectsSensitiveFieldsAtAnyDepth(t *testing.T) {
	if err := ValidateSafeDocuments(
		[]byte(`{"status":"open"}`),
		[]byte(`{"nested":[{"resolution_note":"private moderation text"}]}`),
	); !errors.Is(err, ErrSensitiveAuditData) {
		t.Fatalf("ValidateSafeDocuments() error = %v, want ErrSensitiveAuditData", err)
	}
	if err := ValidateSafeDocuments([]byte(`{"grant_reason":"approved by operator","request_id":"request-1"}`)); err != nil {
		t.Fatalf("ValidateSafeDocuments(safe) error = %v", err)
	}
}
