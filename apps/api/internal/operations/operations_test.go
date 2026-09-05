package operations

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateQueueFilter(t *testing.T) {
	for _, status := range []QueueStatus{
		"",
		QueueStatusOpen,
		QueueStatusInReview,
		QueueStatusResolved,
		QueueStatusClosed,
	} {
		if err := ValidateQueueFilter(QueueFilter{Status: status}); err != nil {
			t.Fatalf("ValidateQueueFilter(%q) error = %v", status, err)
		}
	}
	if err := ValidateQueueFilter(QueueFilter{Status: "pending"}); err == nil {
		t.Fatal("ValidateQueueFilter() error = nil, want invalid status error")
	}
	if err := ValidateQueueFilter(QueueFilter{Limit: -1}); err == nil {
		t.Fatal("ValidateQueueFilter() error = nil, want negative limit error")
	}
}

func TestValidateQueuePatch(t *testing.T) {
	status := QueueStatusInReview
	valid := QueuePatch{ActorUserID: "operator-id", Status: &status}
	if err := ValidateQueuePatch(valid); err != nil {
		t.Fatalf("ValidateQueuePatch() error = %v", err)
	}

	if err := ValidateQueuePatch(QueuePatch{Status: &status}); err == nil {
		t.Fatal("ValidateQueuePatch() error = nil, want missing actor error")
	}
	if err := ValidateQueuePatch(QueuePatch{ActorUserID: "operator-id"}); !errors.Is(err, ErrNoChanges) {
		t.Fatalf("ValidateQueuePatch() error = %v, want ErrNoChanges", err)
	}
	invalidStatus := QueueStatus("pending")
	if err := ValidateQueuePatch(QueuePatch{ActorUserID: "operator-id", Status: &invalidStatus}); err == nil {
		t.Fatal("ValidateQueuePatch() error = nil, want invalid status error")
	}
	longNote := strings.Repeat("x", 5001)
	if err := ValidateQueuePatch(QueuePatch{ActorUserID: "operator-id", ResolutionNote: &longNote}); err == nil {
		t.Fatal("ValidateQueuePatch() error = nil, want note length error")
	}
}

func TestValidateNotification(t *testing.T) {
	valid := NotificationInput{
		UserID:     "user-id",
		Type:       "report.resolved",
		Title:      "Report reviewed",
		Body:       "Thanks for helping keep the community safe.",
		EntityType: "report",
		EntityID:   "report-id",
		Payload:    json.RawMessage(`{"status":"resolved"}`),
	}
	if err := ValidateNotification(valid); err != nil {
		t.Fatalf("ValidateNotification() error = %v", err)
	}

	missingTargetID := valid
	missingTargetID.EntityID = ""
	if err := ValidateNotification(missingTargetID); err == nil {
		t.Fatal("ValidateNotification() error = nil, want incomplete entity error")
	}

	invalidJSON := valid
	invalidJSON.Payload = json.RawMessage(`{"status"`)
	if err := ValidateNotification(invalidJSON); err == nil {
		t.Fatal("ValidateNotification() error = nil, want invalid JSON error")
	}
}

func TestApplyQueuePatchSupportsPartialUpdatesAndClears(t *testing.T) {
	assignee := "operator-one"
	nextAssignee := " operator-two "
	patch := normalizeQueuePatch(QueuePatch{
		ActorUserID:      " operator ",
		AssignedToUserID: &nextAssignee,
	})

	status, gotAssignee, note := applyQueuePatch(QueueStatusOpen, &assignee, "existing", patch)
	if status != QueueStatusOpen || gotAssignee == nil || *gotAssignee != "operator-two" || note != "existing" {
		t.Fatalf("applyQueuePatch() = (%q, %v, %q), want partial assignee update", status, gotAssignee, note)
	}

	clear := ""
	_, gotAssignee, _ = applyQueuePatch(status, gotAssignee, note, QueuePatch{AssignedToUserID: &clear})
	if gotAssignee != nil {
		t.Fatalf("applyQueuePatch() assignee = %q, want nil after clear", *gotAssignee)
	}
}

func TestRetentionStartedAtForTransition(t *testing.T) {
	firstTerminalAt := time.Date(2026, time.September, 4, 10, 0, 0, 0, time.UTC)
	existingStartedAt := firstTerminalAt.Add(-time.Hour)

	tests := []struct {
		name          string
		currentStatus QueueStatus
		nextStatus    QueueStatus
		current       *time.Time
		want          *time.Time
	}{
		{
			name:          "entering resolved starts clock",
			currentStatus: QueueStatusOpen,
			nextStatus:    QueueStatusResolved,
			want:          &firstTerminalAt,
		},
		{
			name:          "entering closed starts clock",
			currentStatus: QueueStatusInReview,
			nextStatus:    QueueStatusClosed,
			want:          &firstTerminalAt,
		},
		{
			name:          "terminal transition preserves clock",
			currentStatus: QueueStatusResolved,
			nextStatus:    QueueStatusClosed,
			current:       &existingStartedAt,
			want:          &existingStartedAt,
		},
		{
			name:          "terminal update preserves clock",
			currentStatus: QueueStatusClosed,
			nextStatus:    QueueStatusClosed,
			current:       &existingStartedAt,
			want:          &existingStartedAt,
		},
		{
			name:          "reopening clears clock",
			currentStatus: QueueStatusResolved,
			nextStatus:    QueueStatusOpen,
			current:       &existingStartedAt,
		},
		{
			name:          "returning to review clears clock",
			currentStatus: QueueStatusClosed,
			nextStatus:    QueueStatusInReview,
			current:       &existingStartedAt,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := retentionStartedAtForTransition(
				tt.currentStatus,
				tt.nextStatus,
				tt.current,
				firstTerminalAt,
			)
			if !optionalTimeEqual(got, tt.want) {
				t.Fatalf("retentionStartedAtForTransition() = %v, want %v", got, tt.want)
			}
		})
	}

	reopened := retentionStartedAtForTransition(
		QueueStatusResolved,
		QueueStatusOpen,
		&existingStartedAt,
		firstTerminalAt,
	)
	restartedAt := firstTerminalAt.Add(time.Hour)
	restarted := retentionStartedAtForTransition(
		QueueStatusOpen,
		QueueStatusClosed,
		reopened,
		restartedAt,
	)
	if restarted == nil || !restarted.Equal(restartedAt) || restarted.Equal(existingStartedAt) {
		t.Fatalf("retention clock after reopen = %v, want fresh %v", restarted, restartedAt)
	}
}

func optionalTimeEqual(left *time.Time, right *time.Time) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Equal(*right)
}

func TestPageLimitDefaultsAndCaps(t *testing.T) {
	if got := pageLimit(0); got != defaultPageLimit {
		t.Fatalf("pageLimit(0) = %d, want %d", got, defaultPageLimit)
	}
	if got := pageLimit(maximumPageLimit + 10); got != maximumPageLimit {
		t.Fatalf("pageLimit(over max) = %d, want %d", got, maximumPageLimit)
	}
	if got := pageLimit(7); got != 7 {
		t.Fatalf("pageLimit(7) = %d, want 7", got)
	}
}

func TestInvalidIdentifiersReturnErrorsWithoutPanicking(t *testing.T) {
	// Empty identifiers are rejected before a query. Non-empty malformed UUIDs
	// are returned as normal PostgreSQL errors by the DB integration path.
	repository := &PostgresRepository{}
	if _, err := repository.PatchReport(t.Context(), "", QueuePatch{}); !errors.Is(err, ErrQueueItemNotFound) {
		t.Fatalf("PatchReport(empty id) error = %v, want ErrQueueItemNotFound", err)
	}
	if _, err := repository.PatchSupportTicket(t.Context(), "", QueuePatch{}); !errors.Is(err, ErrQueueItemNotFound) {
		t.Fatalf("PatchSupportTicket(empty id) error = %v, want ErrQueueItemNotFound", err)
	}
	if _, err := repository.MarkNotificationRead(t.Context(), "", "not-a-uuid"); !errors.Is(err, ErrNotificationNotFound) {
		t.Fatalf("MarkNotificationRead(empty user) error = %v, want ErrNotificationNotFound", err)
	}
}
