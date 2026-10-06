// Package policies holds the published Terms and Privacy Policy versions and
// each user's acceptance of them.
//
// A user agrees to the Terms and acknowledges the Privacy Policy. Both are
// recorded as acceptances of one exact published version. Published documents
// are immutable and acceptances are append-only.
package policies

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	TypeTerms   = "terms"
	TypePrivacy = "privacy"

	SourceSignup       = "signup"
	SourcePolicyUpdate = "policy_update"
)

var (
	// ErrVersionMismatch means the caller named a version that is not the one
	// in effect: it is stale or was never published. The caller must show the
	// current documents again.
	ErrVersionMismatch = apperror.New(apperror.KindConflict, "policy_version_mismatch", "the Terms or Privacy Policy version is not the current one")
	// ErrUnavailable means a document type has no published version in effect.
	ErrUnavailable = errors.New("no published policy document is in effect")
)

// Document is one published version of a policy.
type Document struct {
	ID            string    `json:"-"`
	Type          string    `json:"-"`
	Version       string    `json:"version"`
	EffectiveAt   time.Time `json:"effective_at"`
	ContentSHA256 string    `json:"content_sha256"`
}

// Current is the version of each document in effect now.
type Current struct {
	Terms   Document `json:"terms"`
	Privacy Document `json:"privacy"`
}

// Claim is what a caller says it was shown and accepted.
type Claim struct {
	TermsAgreed         bool
	TermsVersion        string
	PrivacyAcknowledged bool
	PrivacyVersion      string
}

// Acceptance is one recorded acceptance, for the user it belongs to.
type Acceptance struct {
	DocumentType string    `json:"document_type"`
	Version      string    `json:"version"`
	AcceptedAt   time.Time `json:"accepted_at"`
	Source       string    `json:"source"`
}

// ValidateClaim rejects a claim that does not affirm both documents. It does
// not check the versions; Resolve does that against the published record.
func ValidateClaim(claim Claim) error {
	if !claim.TermsAgreed || strings.TrimSpace(claim.TermsVersion) == "" {
		return apperror.Validation("agreement to the Terms is required")
	}
	if !claim.PrivacyAcknowledged || strings.TrimSpace(claim.PrivacyVersion) == "" {
		return apperror.Validation("acknowledgement of the Privacy Policy is required")
	}
	return nil
}

// Resolve returns the IDs of the current documents when the claim names
// exactly those versions. A client-supplied version is never trusted on its
// own: it must match the published record.
func (current Current) Resolve(claim Claim) ([]string, error) {
	if err := ValidateClaim(claim); err != nil {
		return nil, err
	}
	if claim.TermsVersion != current.Terms.Version || claim.PrivacyVersion != current.Privacy.Version {
		return nil, ErrVersionMismatch
	}
	return []string{current.Terms.ID, current.Privacy.ID}, nil
}

type Repository interface {
	// Current returns the version of each document in effect at now.
	Current(ctx context.Context, now time.Time) (Current, error)
	// ListAcceptances returns a user's acceptances, oldest first.
	ListAcceptances(ctx context.Context, userID string) ([]Acceptance, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) Current(ctx context.Context, now time.Time) (Current, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT ON (document_type)
		       id::text, document_type, version, effective_at, content_sha256
		FROM policy_documents
		WHERE effective_at <= $1
		ORDER BY document_type, effective_at DESC, created_at DESC
	`, now)
	if err != nil {
		return Current{}, fmt.Errorf("read current policy documents: %w", err)
	}
	defer rows.Close()

	var current Current
	for rows.Next() {
		var document Document
		if err := rows.Scan(&document.ID, &document.Type, &document.Version, &document.EffectiveAt, &document.ContentSHA256); err != nil {
			return Current{}, fmt.Errorf("scan policy document: %w", err)
		}
		switch document.Type {
		case TypeTerms:
			current.Terms = document
		case TypePrivacy:
			current.Privacy = document
		}
	}
	if err := rows.Err(); err != nil {
		return Current{}, fmt.Errorf("read current policy documents: %w", err)
	}
	if current.Terms.ID == "" || current.Privacy.ID == "" {
		return Current{}, ErrUnavailable
	}
	return current, nil
}

func (r *PostgresRepository) ListAcceptances(ctx context.Context, userID string) ([]Acceptance, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT d.document_type, d.version, a.accepted_at, a.source
		FROM user_policy_acceptances a
		JOIN policy_documents d ON d.id = a.policy_document_id
		WHERE a.user_id = $1::uuid
		ORDER BY a.accepted_at, d.document_type DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list policy acceptances: %w", err)
	}
	defer rows.Close()

	acceptances := make([]Acceptance, 0)
	for rows.Next() {
		var acceptance Acceptance
		if err := rows.Scan(&acceptance.DocumentType, &acceptance.Version, &acceptance.AcceptedAt, &acceptance.Source); err != nil {
			return nil, fmt.Errorf("scan policy acceptance: %w", err)
		}
		acceptances = append(acceptances, acceptance)
	}
	return acceptances, rows.Err()
}

// RecordAcceptances appends one acceptance per document inside the caller's
// transaction, so an account and its acceptances commit or roll back together.
func RecordAcceptances(ctx context.Context, tx pgx.Tx, userID string, documentIDs []string, source string, acceptedAt time.Time) error {
	for _, documentID := range documentIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_policy_acceptances (user_id, policy_document_id, accepted_at, source)
			VALUES ($1::uuid, $2::uuid, $3, $4)
		`, userID, documentID, acceptedAt, source); err != nil {
			return fmt.Errorf("record policy acceptance: %w", err)
		}
	}
	return nil
}
