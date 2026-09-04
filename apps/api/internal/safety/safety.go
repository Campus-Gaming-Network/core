// Package safety handles support tickets and user-submitted reports.
package safety

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrReportTargetNotFound = errors.New("report target not found")
	ErrCannotReportSelf     = errors.New("cannot report self")
)

const (
	ReportTargetEvent = "event"
	ReportTargetUser  = "user"
)

var blockedTerms = map[string]struct{}{
	"ass": {}, "asshole": {}, "bastard": {}, "bitch": {}, "bullshit": {},
	"crap": {}, "cunt": {}, "damn": {}, "fag": {}, "fuck": {},
	"motherfucker": {}, "nigger": {}, "shit": {}, "slut": {}, "whore": {},
}

type SupportTicket struct {
	ID           string `json:"id"`
	ContactEmail string `json:"contact_email"`
	Status       string `json:"status"`
}

type SupportTicketInput struct {
	SubmitterUserID string
	ContactEmail    string
	Name            string
	Subject         string
	Message         string
}

type Report struct {
	ID         string `json:"id"`
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	Status     string `json:"status"`
}

type ReportInput struct {
	ReporterUserID string
	TargetType     string
	TargetID       string
	Reason         string
}

type Repository interface {
	CreateSupportTicket(ctx context.Context, input SupportTicketInput) (SupportTicket, error)
	ReportEvent(ctx context.Context, reporterUserID string, eventSlug string, reason string) (Report, error)
	ReportUser(ctx context.Context, reporterUserID string, targetUserID string, reason string) (Report, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func ValidateSupportTicket(input SupportTicketInput) error {
	if err := ValidateCleanText("name", input.Name); err != nil {
		return err
	}
	if err := ValidateCleanText("subject", input.Subject); err != nil {
		return err
	}
	if err := ValidateCleanText("message", input.Message); err != nil {
		return err
	}
	if _, err := mail.ParseAddress(strings.TrimSpace(input.ContactEmail)); err != nil {
		return errors.New("contact email must be valid")
	}
	if len(strings.TrimSpace(input.Name)) > 120 {
		return errors.New("name must be 120 characters or fewer")
	}
	if subject := strings.TrimSpace(input.Subject); subject == "" || len(subject) > 160 {
		return errors.New("subject is required and must be 160 characters or fewer")
	}
	if message := strings.TrimSpace(input.Message); message == "" || len(message) > 5000 {
		return errors.New("message is required and must be 5,000 characters or fewer")
	}
	return nil
}

func ValidateReport(input ReportInput) error {
	if err := ValidateCleanText("reason", input.Reason); err != nil {
		return err
	}
	if strings.TrimSpace(input.ReporterUserID) == "" {
		return errors.New("reporter is required")
	}
	if input.TargetType != ReportTargetEvent && input.TargetType != ReportTargetUser {
		return errors.New("report target type must be event or user")
	}
	if strings.TrimSpace(input.TargetID) == "" {
		return errors.New("report target is required")
	}
	if reason := strings.TrimSpace(input.Reason); reason == "" || len(reason) > 2000 {
		return errors.New("reason is required and must be 2,000 characters or fewer")
	}
	return nil
}

// ContainsBlockedLanguage applies the launch content policy to user-authored
// text. It tokenizes on punctuation so ordinary words such as "class" do not
// match shorter blocked terms.
func ContainsBlockedLanguage(value string) bool {
	word := make([]rune, 0, len(value))
	for _, character := range strings.ToLower(value) {
		if unicode.IsLetter(character) || unicode.IsNumber(character) {
			word = append(word, character)
			continue
		}
		if len(word) > 0 {
			if _, blocked := blockedTerms[string(word)]; blocked {
				return true
			}
			word = word[:0]
		}
	}
	_, blocked := blockedTerms[string(word)]
	return blocked
}

func ValidateCleanText(field string, value string) error {
	if ContainsBlockedLanguage(value) {
		return fmt.Errorf("%s contains language that is not allowed", field)
	}
	return nil
}

func (r *PostgresRepository) CreateSupportTicket(ctx context.Context, input SupportTicketInput) (SupportTicket, error) {
	input = normalizeSupportTicket(input)
	if err := ValidateSupportTicket(input); err != nil {
		return SupportTicket{}, err
	}

	var ticket SupportTicket
	err := r.pool.QueryRow(ctx, `
		INSERT INTO support_tickets (submitter_user_id, contact_email, name, subject, message)
		VALUES (NULLIF($1, '')::uuid, $2, $3, $4, $5)
		RETURNING id::text, contact_email, status
	`, input.SubmitterUserID, input.ContactEmail, input.Name, input.Subject, input.Message).Scan(
		&ticket.ID,
		&ticket.ContactEmail,
		&ticket.Status,
	)
	if err != nil {
		return SupportTicket{}, fmt.Errorf("create support ticket: %w", err)
	}
	return ticket, nil
}

func (r *PostgresRepository) ReportEvent(ctx context.Context, reporterUserID string, eventSlug string, reason string) (Report, error) {
	eventID, err := r.eventIDBySlug(ctx, eventSlug)
	if err != nil {
		return Report{}, err
	}
	return r.createReport(ctx, ReportInput{
		ReporterUserID: reporterUserID,
		TargetType:     ReportTargetEvent,
		TargetID:       eventID,
		Reason:         reason,
	})
}

func (r *PostgresRepository) ReportUser(ctx context.Context, reporterUserID string, targetUserID string, reason string) (Report, error) {
	reporterUserID = strings.TrimSpace(reporterUserID)
	targetUserID = strings.TrimSpace(targetUserID)
	if reporterUserID == targetUserID {
		return Report{}, ErrCannotReportSelf
	}
	if err := r.ensureActiveUser(ctx, targetUserID); err != nil {
		return Report{}, err
	}
	return r.createReport(ctx, ReportInput{
		ReporterUserID: reporterUserID,
		TargetType:     ReportTargetUser,
		TargetID:       targetUserID,
		Reason:         reason,
	})
}

func (r *PostgresRepository) createReport(ctx context.Context, input ReportInput) (Report, error) {
	input = normalizeReport(input)
	if err := ValidateReport(input); err != nil {
		return Report{}, err
	}

	var report Report
	err := r.pool.QueryRow(ctx, `
		INSERT INTO reports (reporter_user_id, target_type, target_id, reason)
		VALUES ($1::uuid, $2, $3::uuid, $4)
		RETURNING id::text, target_type, target_id::text, status
	`, input.ReporterUserID, input.TargetType, input.TargetID, input.Reason).Scan(
		&report.ID,
		&report.TargetType,
		&report.TargetID,
		&report.Status,
	)
	if err != nil {
		return Report{}, fmt.Errorf("create report: %w", err)
	}
	return report, nil
}

func (r *PostgresRepository) eventIDBySlug(ctx context.Context, slug string) (string, error) {
	var eventID string
	err := r.pool.QueryRow(ctx, `
		SELECT id::text
		FROM events
		WHERE slug = $1
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug)).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrReportTargetNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get report event target: %w", err)
	}
	return eventID, nil
}

func (r *PostgresRepository) ensureActiveUser(ctx context.Context, id string) error {
	var exists bool
	if err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM users
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
			  AND account_status = 'active'
		)
	`, strings.TrimSpace(id)).Scan(&exists); err != nil {
		return fmt.Errorf("check report user target: %w", err)
	}
	if !exists {
		return ErrReportTargetNotFound
	}
	return nil
}

func normalizeSupportTicket(input SupportTicketInput) SupportTicketInput {
	input.SubmitterUserID = strings.TrimSpace(input.SubmitterUserID)
	input.ContactEmail = normalizeEmailAddress(input.ContactEmail)
	input.Name = strings.TrimSpace(input.Name)
	input.Subject = strings.TrimSpace(input.Subject)
	input.Message = strings.TrimSpace(input.Message)
	return input
}

func normalizeEmailAddress(value string) string {
	address, err := mail.ParseAddress(strings.TrimSpace(value))
	if err != nil {
		return strings.ToLower(strings.TrimSpace(value))
	}
	return strings.ToLower(strings.TrimSpace(address.Address))
}

func normalizeReport(input ReportInput) ReportInput {
	input.ReporterUserID = strings.TrimSpace(input.ReporterUserID)
	input.TargetType = strings.TrimSpace(input.TargetType)
	input.TargetID = strings.TrimSpace(input.TargetID)
	input.Reason = strings.TrimSpace(input.Reason)
	return input
}
