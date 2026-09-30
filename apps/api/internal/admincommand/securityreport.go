package admincommand

import (
	"context"
	"errors"
	"time"
)

// AlertRule is one threshold over the durable Admin Console security events.
// Each rule counts events of a type, optionally narrowed to one reason code,
// inside a trailing window and fires when the count reaches the threshold.
type AlertRule struct {
	Name string
	// EventType limits the rule to one event type; empty matches every type.
	EventType string
	// ReasonCode limits the rule to one metadata reason code; empty matches all.
	ReasonCode string
	Threshold  int
	Window     time.Duration
}

// Finding is the outcome of evaluating one rule.
type Finding struct {
	Rule      AlertRule
	Count     int
	Firing    bool
	Evaluated time.Time
}

// DefaultAlertRules are the v1 thresholds from the observability plan. They
// are deliberately low: the console has a handful of operators, so a burst of
// any of these is a signal worth a human look. Failures that never reach the
// database, such as audit-write failures and 5xx responses, are alerted from
// the request log instead; docs/22 lists those queries.
var DefaultAlertRules = []AlertRule{
	{Name: "access_validation_failures", EventType: "admin.authentication.exchange_denied", ReasonCode: "invalid_access_assertion", Threshold: 5, Window: 15 * time.Minute},
	{Name: "step_up_failures", EventType: "admin.authentication.step_up_denied", Threshold: 3, Window: 15 * time.Minute},
	{Name: "denied_authorization", EventType: "admin.authorization.denied", Threshold: 20, Window: 15 * time.Minute},
	{Name: "rate_limited", ReasonCode: "rate_limited", Threshold: 1, Window: 15 * time.Minute},
	{Name: "unusual_session_creation", EventType: "admin.authentication.exchange_succeeded", Threshold: 10, Window: 15 * time.Minute},
}

// SecurityReport evaluates rules against the security events at now. It reads
// only event types and reason codes, never request or credential material.
func (service *Service) SecurityReport(ctx context.Context, rules []AlertRule, now time.Time) ([]Finding, error) {
	if service == nil || service.pool == nil {
		return nil, ErrInvalidCommand
	}
	findings := make([]Finding, 0, len(rules))
	for _, rule := range rules {
		if rule.Name == "" || rule.Threshold < 1 || rule.Window <= 0 {
			return nil, ErrInvalidCommand
		}
		var count int
		err := service.pool.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM admin_security_events
			WHERE occurred_at > $1 AND occurred_at <= $2
			  AND ($3 = '' OR event_type = $3)
			  AND ($4 = '' OR metadata ->> 'reason_code' = $4)
		`, now.Add(-rule.Window), now, rule.EventType, rule.ReasonCode).Scan(&count)
		if err != nil {
			return nil, errors.New("could not read security events")
		}
		findings = append(findings, Finding{Rule: rule, Count: count, Firing: count >= rule.Threshold, Evaluated: now})
	}
	return findings, nil
}
