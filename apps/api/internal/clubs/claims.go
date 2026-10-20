package clubs

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Claim statuses.
const (
	ClaimPending  = "pending"
	ClaimApproved = "approved"
	ClaimRejected = "rejected"
)

// Claim kinds: a claim on a listed club, or a request for a new one.
const (
	ClaimKindClaim   = "claim"
	ClaimKindRequest = "request"
)

var (
	ErrEmailUnverified = apperror.New(apperror.KindAuthorization, "email_verification_required", "verify your email address first")
	ErrClubClaimed     = apperror.New(apperror.KindConflict, "club_already_claimed", "the club is already managed by its officers")
	ErrClubListed      = apperror.New(apperror.KindConflict, "club_already_listed", "a club with that name is already listed at the school")
	ErrClaimPending    = apperror.New(apperror.KindConflict, "club_claim_pending", "you already have a pending claim for this club")
	// ErrApplicantUnavailable refuses to make a deleted, suspended, or
	// unverified account a club's owner.
	ErrApplicantUnavailable = apperror.New(apperror.KindConflict, "club_claim_applicant_unavailable", "the applicant's account cannot own a club")
)

// ClaimEvidence is how an applicant shows they run the club. A school email
// address alone is not enough, so the text is required.
type ClaimEvidence struct {
	Text string `json:"evidence_text"`
	URL  string `json:"evidence_url"`
}

// ClaimInput claims the published club with ClubSlug.
type ClaimInput struct {
	UserID   string
	ClubSlug string
	ClaimEvidence
}

// RequestInput asks for a club that is not listed at the school with
// SchoolSlug.
type RequestInput struct {
	UserID     string
	SchoolSlug string
	Name       string
	Type       string
	ClaimEvidence
}

// ClaimReceipt is what the applicant gets back. It repeats nothing they sent.
type ClaimReceipt struct {
	Status string `json:"status"`
}

func (evidence ClaimEvidence) normalize() (ClaimEvidence, error) {
	evidence.Text = strings.TrimSpace(evidence.Text)
	evidence.URL = strings.TrimSpace(evidence.URL)
	if !adminmutation.Text(evidence.Text, 2000, true) {
		return ClaimEvidence{}, apperror.Validation("evidence is required and must be 2,000 characters or fewer")
	}
	if len(evidence.URL) > 500 || !adminmutation.URL(evidence.URL) {
		return ClaimEvidence{}, apperror.Validation("evidence link must be an http or https address")
	}
	if err := safety.ValidateCleanText("evidence", evidence.Text); err != nil {
		return ClaimEvidence{}, err
	}
	return evidence, nil
}

// SubmitClaim records a pending claim on a published club. A club that
// already has an owner, a second pending claim by the same person, and an
// unverified account are refused.
func (r *PostgresRepository) SubmitClaim(ctx context.Context, input ClaimInput) (ClaimReceipt, error) {
	evidence, err := input.ClaimEvidence.normalize()
	if err != nil {
		return ClaimReceipt{}, err
	}
	if err := r.requireVerified(ctx, input.UserID); err != nil {
		return ClaimReceipt{}, err
	}
	var clubID, schoolID string
	var claimed bool
	err = r.pool.QueryRow(ctx, `
		SELECT c.id::text, c.school_id::text, `+claimedColumn+`
		FROM clubs c JOIN schools s ON s.id = c.school_id AND s.deleted_at IS NULL
		WHERE c.slug = $1 AND `+publishedClub+`
	`, strings.TrimSpace(input.ClubSlug)).Scan(&clubID, &schoolID, &claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		return ClaimReceipt{}, ErrClubNotFound
	}
	if err != nil {
		return ClaimReceipt{}, fmt.Errorf("get claimed club: %w", err)
	}
	if claimed {
		return ClaimReceipt{}, ErrClubClaimed
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO club_claims (club_id, school_id, applicant_user_id, evidence_text, evidence_url)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
	`, clubID, schoolID, input.UserID, evidence.Text, evidence.URL)
	if isUniqueViolation(err) {
		return ClaimReceipt{}, ErrClaimPending
	}
	if err != nil {
		return ClaimReceipt{}, fmt.Errorf("insert club claim: %w", err)
	}
	return ClaimReceipt{Status: ClaimPending}, nil
}

// SubmitRequest records a pending request for a club that is not listed at
// an active school. A name a published club at the school already uses is
// refused, so the applicant claims that club instead.
func (r *PostgresRepository) SubmitRequest(ctx context.Context, input RequestInput) (ClaimReceipt, error) {
	name := strings.TrimSpace(input.Name)
	if !adminmutation.Text(name, 120, true) {
		return ClaimReceipt{}, apperror.Validation("club name is required and must be 120 characters or fewer")
	}
	if err := safety.ValidateCleanText("name", name); err != nil {
		return ClaimReceipt{}, err
	}
	if input.Type != TypeStudentClub && input.Type != TypeUniversityProgram {
		return ClaimReceipt{}, apperror.Validation("choose a club type")
	}
	evidence, err := input.ClaimEvidence.normalize()
	if err != nil {
		return ClaimReceipt{}, err
	}
	if err := r.requireVerified(ctx, input.UserID); err != nil {
		return ClaimReceipt{}, err
	}
	var schoolID string
	var listed bool
	err = r.pool.QueryRow(ctx, `
		SELECT s.id::text, EXISTS (
			SELECT 1 FROM clubs c
			WHERE c.school_id = s.id AND LOWER(c.name) = LOWER($2) AND `+publishedClub+`)
		FROM schools s
		WHERE s.slug = $1 AND s.deleted_at IS NULL AND s.is_active = TRUE
	`, strings.TrimSpace(input.SchoolSlug), name).Scan(&schoolID, &listed)
	if errors.Is(err, pgx.ErrNoRows) {
		return ClaimReceipt{}, ErrSchoolNotFound
	}
	if err != nil {
		return ClaimReceipt{}, fmt.Errorf("get requested club school: %w", err)
	}
	if listed {
		return ClaimReceipt{}, ErrClubListed
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO club_claims (school_id, requested_name, requested_type, applicant_user_id, evidence_text, evidence_url)
		VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6)
	`, schoolID, name, input.Type, input.UserID, evidence.Text, evidence.URL)
	if isUniqueViolation(err) {
		return ClaimReceipt{}, ErrClaimPending
	}
	if err != nil {
		return ClaimReceipt{}, fmt.Errorf("insert club request: %w", err)
	}
	return ClaimReceipt{Status: ClaimPending}, nil
}

// requireVerified refuses an account that has not verified its email.
func (r *PostgresRepository) requireVerified(ctx context.Context, userID string) error {
	var verified bool
	err := r.pool.QueryRow(ctx, `
		SELECT email_verified_at IS NOT NULL FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL AND account_status = 'active'
	`, userID).Scan(&verified)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperror.New(apperror.KindAuthentication, "authentication_required", "sign in first")
	}
	if err != nil {
		return fmt.Errorf("check claim applicant: %w", err)
	}
	if !verified {
		return ErrEmailUnverified
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23505"
}

// AdminClaimSummary is a claim as the review queue lists it.
type AdminClaimSummary struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// ClubID is the claimed club, or the club an approved request created.
	ClubID *string `json:"club_id"`
	// ClubName is the club's current name, or the name a request asked for.
	ClubName        string        `json:"club_name"`
	School          SchoolSummary `json:"school"`
	ApplicantUserID string        `json:"applicant_user_id"`
	ApplicantName   string        `json:"applicant_name"`
	Status          string        `json:"status"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
}

// AdminClaim is one claim with its evidence and review. Only the Admin API
// returns it.
type AdminClaim struct {
	AdminClaimSummary
	RequestedName  *string    `json:"requested_name"`
	RequestedType  *string    `json:"requested_type"`
	ClubSlug       *string    `json:"club_slug"`
	ClubClaimed    bool       `json:"club_claimed"`
	ApplicantEmail string     `json:"applicant_email"`
	EvidenceText   string     `json:"evidence_text"`
	EvidenceURL    string     `json:"evidence_url"`
	ReviewerUserID *string    `json:"reviewer_user_id"`
	ReviewerName   *string    `json:"reviewer_name"`
	ReviewNote     *string    `json:"review_note"`
	ReviewedAt     *time.Time `json:"reviewed_at"`
	// OtherPending lists the other pending claims on the same club, or the
	// other pending requests for the same name at the same school.
	OtherPending []AdminClaimSummary `json:"other_pending_claims"`
}

// ClaimApproval approves a claim. A request also names the club it creates;
// the form starts from what the applicant asked for.
type ClaimApproval struct {
	adminmutation.Command
	Name string `json:"name"`
	Slug string `json:"slug"`
	Type string `json:"type"`
}

const claimSummaryColumns = `cc.id::text, CASE WHEN cc.requested_name IS NULL THEN 'claim' ELSE 'request' END,
	cc.club_id::text, COALESCE(c.name, cc.requested_name),
	s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
	cc.applicant_user_id::text, applicant.name, cc.status, cc.created_at, cc.updated_at`

const claimFrom = `FROM club_claims cc
	JOIN schools s ON s.id = cc.school_id
	JOIN users applicant ON applicant.id = cc.applicant_user_id
	LEFT JOIN clubs c ON c.id = cc.club_id`

func scanClaimSummary(row pgx.Row, extra ...any) (AdminClaimSummary, error) {
	var claim AdminClaimSummary
	err := row.Scan(append([]any{&claim.ID, &claim.Kind, &claim.ClubID, &claim.ClubName,
		&claim.School.ID, &claim.School.Name, &claim.School.Slug, &claim.School.City, &claim.School.State,
		&claim.ApplicantUserID, &claim.ApplicantName, &claim.Status, &claim.CreatedAt, &claim.UpdatedAt}, extra...)...)
	return claim, adminmutation.Error(err)
}

func collectClaimSummaries(rows pgx.Rows, err error) ([]AdminClaimSummary, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	claims := []AdminClaimSummary{}
	for rows.Next() {
		claim, err := scanClaimSummary(rows)
		if err != nil {
			return nil, err
		}
		claims = append(claims, claim)
	}
	return claims, rows.Err()
}

// ListClaims returns one page of claims, newest first, narrowed to status
// when it is set.
func (r *PostgresRepository) ListClaims(ctx context.Context, status string, filter adminmutation.Filter) ([]AdminClaimSummary, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if !slices.Contains([]string{"", ClaimPending, ClaimApproved, ClaimRejected}, status) {
		return nil, apperror.Validation("invalid claim status")
	}
	timestamp, id, before := filter.Cursor()
	order := "DESC"
	if before {
		order = "ASC"
	}
	claims, err := collectClaimSummaries(r.pool.Query(ctx, `SELECT `+claimSummaryColumns+` `+claimFrom+`
	 WHERE ($1 = '' OR cc.status = $1)
	 AND ($2::timestamptz IS NULL OR (NOT $4 AND (cc.created_at, cc.id) < ($2, $3::uuid)) OR ($4 AND (cc.created_at, cc.id) > ($2, $3::uuid)))
	 ORDER BY cc.created_at `+order+`, cc.id `+order+` LIMIT $5`,
		status, timestamp, id, before, filter.Limit))
	if err != nil {
		return nil, err
	}
	if before {
		slices.Reverse(claims)
	}
	return claims, nil
}

// GetClaim returns a claim with its evidence, its review, and the other
// pending claims it competes with, or adminmutation.ErrNotFound.
func (r *PostgresRepository) GetClaim(ctx context.Context, id string) (AdminClaim, error) {
	if !adminmutation.UUID(id) {
		return AdminClaim{}, adminmutation.ErrNotFound
	}
	var claim AdminClaim
	summary, err := scanClaimSummary(r.pool.QueryRow(ctx, `SELECT `+claimSummaryColumns+`,
		cc.requested_name, cc.requested_type, c.slug,
		EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = cc.club_id AND m.role = 'owner'),
		applicant.email::text, cc.evidence_text, cc.evidence_url,
		cc.reviewer_user_id::text, reviewer.name, cc.review_note, cc.reviewed_at
		`+claimFrom+` LEFT JOIN users reviewer ON reviewer.id = cc.reviewer_user_id
		WHERE cc.id = $1::uuid`, id),
		&claim.RequestedName, &claim.RequestedType, &claim.ClubSlug, &claim.ClubClaimed,
		&claim.ApplicantEmail, &claim.EvidenceText, &claim.EvidenceURL,
		&claim.ReviewerUserID, &claim.ReviewerName, &claim.ReviewNote, &claim.ReviewedAt)
	if err != nil {
		return AdminClaim{}, err
	}
	claim.AdminClaimSummary = summary
	claim.OtherPending, err = collectClaimSummaries(r.pool.Query(ctx, `SELECT `+claimSummaryColumns+` `+claimFrom+`
	 JOIN club_claims this ON this.id = $1::uuid
	 WHERE cc.status = 'pending' AND cc.id <> this.id
	 AND ((this.club_id IS NOT NULL AND cc.club_id = this.club_id)
	   OR (this.club_id IS NULL AND cc.club_id IS NULL AND cc.school_id = this.school_id
	       AND LOWER(BTRIM(cc.requested_name)) = LOWER(BTRIM(this.requested_name))))
	 ORDER BY cc.created_at, cc.id LIMIT 50`, id))
	if err != nil {
		return AdminClaim{}, err
	}
	return claim, nil
}

// claimRecord is the part of a claim a review reads and changes.
type claimRecord struct {
	clubID          *string
	schoolID        string
	requestedName   *string
	requestedType   *string
	applicantUserID string
	status          string
	updatedAt       time.Time
}

func (claim claimRecord) auditState() adminaudit.ClubClaimState {
	return adminaudit.ClubClaimState{Status: claim.status, ClubID: claim.clubID, UpdatedAt: claim.updatedAt}
}

func loadClaimForUpdate(ctx context.Context, tx pgx.Tx, id string) (claimRecord, error) {
	var claim claimRecord
	err := tx.QueryRow(ctx, `
		SELECT club_id::text, school_id::text, requested_name, requested_type, applicant_user_id::text, status, updated_at
		FROM club_claims WHERE id = $1::uuid FOR UPDATE
	`, id).Scan(&claim.clubID, &claim.schoolID, &claim.requestedName, &claim.requestedType,
		&claim.applicantUserID, &claim.status, &claim.updatedAt)
	return claim, adminmutation.Error(err)
}

// ApproveClaim makes the applicant the club's owner. For a request it first
// creates the club, published and under the requested school. A club that
// already has an owner is refused; other pending claims on it stay pending
// for the reviewer to reject.
func (r *PostgresRepository) ApproveClaim(ctx context.Context, id string, input ClaimApproval) (AdminClaim, error) {
	return r.review(ctx, id, input.Command, adminaudit.ActionClubClaimApproved, func(tx pgx.Tx, claim *claimRecord) (DecisionPayload, error) {
		var applicantActive bool
		if err := tx.QueryRow(ctx, `
			SELECT deleted_at IS NULL AND account_status = 'active' AND email_verified_at IS NOT NULL
			FROM users WHERE id = $1::uuid FOR SHARE
		`, claim.applicantUserID).Scan(&applicantActive); err != nil {
			return DecisionPayload{}, err
		}
		if !applicantActive {
			return DecisionPayload{}, ErrApplicantUnavailable
		}
		notice := DecisionPayload{Request: claim.requestedName != nil}
		if claim.clubID == nil {
			created, err := createRequestedClub(ctx, tx, claim.schoolID, input)
			if err != nil {
				return DecisionPayload{}, err
			}
			claim.clubID = &created.ID
		} else {
			club, err := loadForUpdate(ctx, tx, *claim.clubID)
			if err != nil {
				return DecisionPayload{}, err
			}
			if club.DeletedAt != nil {
				return DecisionPayload{}, adminmutation.ErrTransition
			}
			if club.Claimed {
				return DecisionPayload{}, ErrClubClaimed
			}
			if err := touch(ctx, tx, club.ID); err != nil {
				return DecisionPayload{}, err
			}
		}
		// An applicant who already has a role in the club becomes its owner.
		if _, err := tx.Exec(ctx, `
			INSERT INTO club_members (club_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')
			ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'owner'
		`, *claim.clubID, claim.applicantUserID); err != nil {
			return DecisionPayload{}, err
		}
		if err := tx.QueryRow(ctx, `
			SELECT c.name, c.slug, s.name FROM clubs c JOIN schools s ON s.id = c.school_id WHERE c.id = $1::uuid
		`, *claim.clubID).Scan(&notice.ClubName, &notice.ClubSlug, &notice.SchoolName); err != nil {
			return DecisionPayload{}, err
		}
		claim.status = ClaimApproved
		return notice, nil
	})
}

// RejectClaim closes a pending claim. The command's reason is the review
// note, so a rejection always has one.
func (r *PostgresRepository) RejectClaim(ctx context.Context, id string, command adminmutation.Command) (AdminClaim, error) {
	return r.review(ctx, id, command, adminaudit.ActionClubClaimRejected, func(tx pgx.Tx, claim *claimRecord) (DecisionPayload, error) {
		var notice DecisionPayload
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(c.name, cc.requested_name), s.name
			FROM club_claims cc JOIN schools s ON s.id = cc.school_id LEFT JOIN clubs c ON c.id = cc.club_id
			WHERE cc.id = $1::uuid
		`, id).Scan(&notice.ClubName, &notice.SchoolName); err != nil {
			return DecisionPayload{}, err
		}
		notice.Request = claim.requestedName != nil
		claim.status = ClaimRejected
		return notice, nil
	})
}

// createRequestedClub creates the club an approved request asked for and
// audits its creation on the club's own history.
func createRequestedClub(ctx context.Context, tx pgx.Tx, schoolID string, input ClaimApproval) (AdminClub, error) {
	fields := AdminFields{Name: input.Name, Slug: input.Slug, Type: input.Type}
	if err := fields.Validate(); err != nil {
		return AdminClub{}, err
	}
	var schoolActive bool
	if err := tx.QueryRow(ctx, `SELECT is_active AND deleted_at IS NULL FROM schools WHERE id = $1::uuid`, schoolID).Scan(&schoolActive); err != nil {
		return AdminClub{}, adminmutation.Error(err)
	}
	if !schoolActive {
		return AdminClub{}, adminmutation.ErrTransition
	}
	if err := claimSlug(ctx, tx, fields.Slug, ""); err != nil {
		return AdminClub{}, err
	}
	var clubID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO clubs (school_id, name, slug, type) VALUES ($1::uuid, $2, $3, $4) RETURNING id::text
	`, schoolID, fields.Name, fields.Slug, fields.Type).Scan(&clubID); err != nil {
		return AdminClub{}, adminmutation.Error(err)
	}
	club, err := loadForUpdate(ctx, tx, clubID)
	if err != nil {
		return AdminClub{}, err
	}
	return club, input.Audit(ctx, tx, adminaudit.ActionClubCreated, adminaudit.EntityClub, clubID, adminaudit.EmptyState{}, club.auditState())
}

// review decides one pending claim under a row lock: it checks the version,
// applies the decision, records the reviewer and note, queues the
// applicant's email, and audits, all in one transaction.
func (r *PostgresRepository) review(
	ctx context.Context, id string, command adminmutation.Command, action adminaudit.Action,
	decide func(pgx.Tx, *claimRecord) (DecisionPayload, error),
) (AdminClaim, error) {
	if !adminmutation.UUID(id) {
		return AdminClaim{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminClaim{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminClaim{}, err
	}
	defer tx.Rollback(ctx)
	claim, err := loadClaimForUpdate(ctx, tx, id)
	if err != nil {
		return AdminClaim{}, err
	}
	if !claim.updatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminClaim{}, adminmutation.ErrConflict
	}
	if claim.status != ClaimPending {
		return AdminClaim{}, adminmutation.ErrTransition
	}
	before := claim.auditState()
	notice, err := decide(tx, &claim)
	if err != nil {
		return AdminClaim{}, err
	}
	var recipient string
	if err := tx.QueryRow(ctx, `
		UPDATE club_claims cc
		SET status = $2, club_id = $3::uuid, reviewer_user_id = $4::uuid, review_note = $5, reviewed_at = clock_timestamp()
		FROM users applicant
		WHERE cc.id = $1::uuid AND applicant.id = cc.applicant_user_id
		RETURNING cc.updated_at, CASE WHEN applicant.deleted_at IS NULL AND applicant.account_status = 'active'
		                              THEN applicant.email::text ELSE '' END
	`, id, claim.status, claim.clubID, command.Correlation.ActorUserID, strings.TrimSpace(command.Reason)).Scan(&claim.updatedAt, &recipient); err != nil {
		return AdminClaim{}, adminmutation.Error(err)
	}
	if recipient != "" {
		kind := emailoutbox.KindClubClaimRejected
		if claim.status == ClaimApproved {
			kind = emailoutbox.KindClubClaimApproved
		}
		if err := emailoutbox.Enqueue(ctx, tx, emailoutbox.Intent{
			Kind: kind, Recipient: recipient, Payload: notice, IdempotencyKey: kind + ":" + id,
		}); err != nil {
			return AdminClaim{}, err
		}
	}
	if err := command.Audit(ctx, tx, action, adminaudit.EntityClubClaim, id, before, claim.auditState()); err != nil {
		return AdminClaim{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminClaim{}, err
	}
	return r.GetClaim(ctx, id)
}
