package adminhttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
)

const (
	secondApplicantID = "10000000-0000-4000-8000-000000000004"
	unverifiedUserID  = "10000000-0000-4000-8000-000000000005"
)

var officerEvidence = clubs.ClaimEvidence{Text: "I am the club president.", URL: "https://fixture.example.edu/orgs/club"}

func (f catalogFixture) newClaim(t *testing.T, slug, applicant string) (string, time.Time) {
	t.Helper()
	f.newClub(t, slug)
	if _, err := f.club.SubmitClaim(t.Context(), clubs.ClaimInput{UserID: applicant, ClubSlug: slug, ClaimEvidence: officerEvidence}); err != nil {
		t.Fatal(err)
	}
	return f.pendingClaim(t, applicant, slug)
}

func (f catalogFixture) pendingClaim(t *testing.T, applicant, slug string) (string, time.Time) {
	t.Helper()
	var id string
	var updatedAt time.Time
	if err := f.pool.QueryRow(t.Context(), `
		SELECT cc.id::text, cc.updated_at FROM club_claims cc LEFT JOIN clubs c ON c.id = cc.club_id
		WHERE cc.applicant_user_id = $1::uuid AND cc.status = 'pending' AND (c.slug = $2 OR cc.requested_name = $2)
	`, applicant, slug).Scan(&id, &updatedAt); err != nil {
		t.Fatal(err)
	}
	return id, updatedAt
}

func (f catalogFixture) insertApplicant(t *testing.T, id, email string, verified bool) {
	t.Helper()
	if _, err := f.pool.Exec(t.Context(), `
		INSERT INTO users (id, email, password_hash, name, home_school_id, age_confirmed_at, email_verified_at)
		VALUES ($1, $2, 'credential-must-not-leak', 'Applicant', $3, NOW(), CASE WHEN $4 THEN NOW() END)
	`, id, email, catalogSchoolID, verified); err != nil {
		t.Fatal(err)
	}
}

func (f catalogFixture) outbox(t *testing.T) []string {
	t.Helper()
	rows, err := f.pool.Query(t.Context(), `SELECT kind || ':' || recipient FROM email_outbox WHERE kind LIKE 'club_claim_%' ORDER BY created_at, id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	sent := []string{}
	for rows.Next() {
		var row string
		if err := rows.Scan(&row); err != nil {
			t.Fatal(err)
		}
		sent = append(sent, row)
	}
	return sent
}

func (f catalogFixture) auditActions(t *testing.T, entity adminaudit.EntityType, id string) []adminaudit.Action {
	t.Helper()
	entries, err := adminaudit.NewPostgresStore(f.pool).List(t.Context(), adminaudit.ListParams{EntityType: entity, EntityID: id, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	actions := []adminaudit.Action{}
	for _, entry := range entries {
		actions = append(actions, entry.Action)
	}
	return actions
}

func TestClubClaimIsReviewedAndMakesTheApplicantTheOwner(t *testing.T) {
	f := newCatalogFixture(t)
	f.insertApplicant(t, secondApplicantID, "second@example.edu", true)
	f.insertApplicant(t, unverifiedUserID, "unverified@example.edu", false)
	claimID, version := f.newClaim(t, "smash-club", catalogTargetID)

	if _, err := f.club.SubmitClaim(t.Context(), clubs.ClaimInput{UserID: unverifiedUserID, ClubSlug: "smash-club", ClaimEvidence: officerEvidence}); !errors.Is(err, clubs.ErrEmailUnverified) {
		t.Fatalf("unverified claim error = %v, want ErrEmailUnverified", err)
	}
	if _, err := f.club.SubmitClaim(t.Context(), clubs.ClaimInput{UserID: catalogTargetID, ClubSlug: "smash-club", ClaimEvidence: officerEvidence}); !errors.Is(err, clubs.ErrClaimPending) {
		t.Fatalf("repeated claim error = %v, want ErrClaimPending", err)
	}

	if _, err := f.club.SubmitClaim(t.Context(), clubs.ClaimInput{UserID: secondApplicantID, ClubSlug: "smash-club", ClaimEvidence: clubs.ClaimEvidence{Text: "I am the treasurer."}}); err != nil {
		t.Fatal(err)
	}
	secondID, secondVersion := f.pendingClaim(t, secondApplicantID, "smash-club")
	detail := decodeCatalog[clubs.AdminClaim](t, f.request(t, "GET", "/admin/v1/club-claims/"+claimID, nil, http.StatusOK))
	if detail.ApplicantEmail != "target@example.edu" || detail.EvidenceText != officerEvidence.Text || detail.EvidenceURL != officerEvidence.URL ||
		len(detail.OtherPending) != 1 || detail.OtherPending[0].ID != secondID || detail.OtherPending[0].ApplicantUserID != secondApplicantID {
		t.Fatalf("claim detail = %+v, want the evidence and the second applicant's pending claim", detail)
	}
	queue := decodeCatalog[struct {
		Claims []clubs.AdminClaimSummary `json:"claims"`
	}](t, f.request(t, "GET", "/admin/v1/club-claims?status=pending", nil, http.StatusOK))
	if len(queue.Claims) != 2 || queue.Claims[0].ID != secondID || queue.Claims[1].ID != claimID {
		t.Fatalf("pending queue = %+v, want both claims, newest first", queue.Claims)
	}

	approved := decodeCatalog[clubs.AdminClaim](t, f.request(t, "POST", "/admin/v1/club-claims/"+claimID+"/approve",
		clubs.ClaimApproval{Command: f.versioned(version)}, http.StatusOK))
	if approved.Status != clubs.ClaimApproved || !approved.ClubClaimed || approved.ReviewerUserID == nil || *approved.ReviewerUserID != catalogActorID ||
		approved.ReviewNote == nil || *approved.ReviewNote != f.command.Reason {
		t.Fatalf("approved = %+v", approved)
	}
	var role string
	if err := f.pool.QueryRow(t.Context(), `SELECT role FROM club_members WHERE user_id = $1::uuid`, catalogTargetID).Scan(&role); err != nil || role != "owner" {
		t.Fatalf("applicant role = %q, %v; want owner", role, err)
	}
	public, err := f.club.GetBySlug(t.Context(), "smash-club")
	if err != nil || !public.Claimed {
		t.Fatalf("public club = %+v, %v; want claimed", public, err)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{officerEvidence.Text, officerEvidence.URL, "target@example.edu", f.command.Reason} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("public club %s contains %q", encoded, private)
		}
	}
	if got := f.auditActions(t, adminaudit.EntityClubClaim, claimID); !reflect.DeepEqual(got, []adminaudit.Action{adminaudit.ActionClubClaimApproved}) {
		t.Fatalf("claim audit = %v", got)
	}

	if _, err := f.club.SubmitClaim(t.Context(), clubs.ClaimInput{UserID: secondApplicantID, ClubSlug: "smash-club", ClaimEvidence: officerEvidence}); !errors.Is(err, clubs.ErrClubClaimed) {
		t.Fatalf("claim on a claimed club error = %v, want ErrClubClaimed", err)
	}
	if code := f.errorCode(t, "POST", "/admin/v1/club-claims/"+secondID+"/approve", clubs.ClaimApproval{Command: f.versioned(secondVersion)}, http.StatusConflict); code != "club_already_claimed" {
		t.Fatalf("approving a claim on a claimed club = %q", code)
	}
	noNote := f.versioned(secondVersion)
	noNote.Reason = " "
	f.request(t, "POST", "/admin/v1/club-claims/"+secondID+"/reject", noNote, http.StatusBadRequest)
	rejected := decodeCatalog[clubs.AdminClaim](t, f.request(t, "POST", "/admin/v1/club-claims/"+secondID+"/reject", f.versioned(secondVersion), http.StatusOK))
	if rejected.Status != clubs.ClaimRejected || rejected.ClubClaimed != true || len(rejected.OtherPending) != 0 {
		t.Fatalf("rejected = %+v", rejected)
	}
	f.request(t, "POST", "/admin/v1/club-claims/"+secondID+"/approve", clubs.ClaimApproval{Command: f.versioned(rejected.UpdatedAt)}, http.StatusConflict)

	if got, want := f.outbox(t), []string{"club_claim_approved:target@example.edu", "club_claim_rejected:second@example.edu"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("emails = %v, want %v", got, want)
	}
}

func TestClubRequestApprovalCreatesTheClub(t *testing.T) {
	f := newCatalogFixture(t)
	f.insertApplicant(t, unverifiedUserID, "unverified@example.edu", false)
	f.newClub(t, "listed-club")
	request := clubs.RequestInput{UserID: catalogTargetID, SchoolSlug: "fixture-school", Name: "Chess Club", Type: clubs.TypeStudentClub, ClaimEvidence: officerEvidence}

	for name, test := range map[string]struct {
		input clubs.RequestInput
		want  error
	}{
		"unverified":     {clubs.RequestInput{UserID: unverifiedUserID, SchoolSlug: "fixture-school", Name: "Go Club", Type: clubs.TypeStudentClub, ClaimEvidence: officerEvidence}, clubs.ErrEmailUnverified},
		"already listed": {clubs.RequestInput{UserID: catalogTargetID, SchoolSlug: "fixture-school", Name: "club LISTED-CLUB", Type: clubs.TypeStudentClub, ClaimEvidence: officerEvidence}, clubs.ErrClubListed},
		"unknown school": {clubs.RequestInput{UserID: catalogTargetID, SchoolSlug: "no-such-school", Name: "Go Club", Type: clubs.TypeStudentClub, ClaimEvidence: officerEvidence}, clubs.ErrSchoolNotFound},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := f.club.SubmitRequest(t.Context(), test.input); !errors.Is(err, test.want) {
				t.Fatalf("SubmitRequest() error = %v, want %v", err, test.want)
			}
		})
	}
	if _, err := f.club.SubmitRequest(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	if _, err := f.club.SubmitRequest(t.Context(), request); !errors.Is(err, clubs.ErrClaimPending) {
		t.Fatalf("repeated request error = %v, want ErrClaimPending", err)
	}
	id, version := f.pendingClaim(t, catalogTargetID, "Chess Club")
	detail := decodeCatalog[clubs.AdminClaim](t, f.request(t, "GET", "/admin/v1/club-claims/"+id, nil, http.StatusOK))
	if detail.Kind != clubs.ClaimKindRequest || detail.ClubID != nil || detail.ClubName != "Chess Club" || detail.School.ID != catalogSchoolID {
		t.Fatalf("request detail = %+v", detail)
	}

	approved := decodeCatalog[clubs.AdminClaim](t, f.request(t, "POST", "/admin/v1/club-claims/"+id+"/approve", clubs.ClaimApproval{
		Command: f.versioned(version), Name: "Chess Club", Slug: "fixture-chess-club", Type: clubs.TypeStudentClub,
	}, http.StatusOK))
	if approved.ClubID == nil || approved.ClubSlug == nil || *approved.ClubSlug != "fixture-chess-club" || !approved.ClubClaimed {
		t.Fatalf("approved request = %+v, want the created, claimed club", approved)
	}
	public, err := f.club.GetBySlug(t.Context(), "fixture-chess-club")
	if err != nil || !public.Claimed || public.School.ID != catalogSchoolID {
		t.Fatalf("created club = %+v, %v", public, err)
	}
	if got := f.auditActions(t, adminaudit.EntityClub, *approved.ClubID); !reflect.DeepEqual(got, []adminaudit.Action{adminaudit.ActionClubCreated}) {
		t.Fatalf("created club audit = %v", got)
	}
	if got := f.auditActions(t, adminaudit.EntityClubClaim, id); !reflect.DeepEqual(got, []adminaudit.Action{adminaudit.ActionClubClaimApproved}) {
		t.Fatalf("request audit = %v", got)
	}
}

func TestASiteAdminRemovesAMemberButNotAnOwner(t *testing.T) {
	f := newCatalogFixture(t)
	claimID, version := f.newClaim(t, "admin-member-club", catalogTargetID)
	approved := decodeCatalog[clubs.AdminClaim](t, f.request(t, "POST", "/admin/v1/club-claims/"+claimID+"/approve",
		clubs.ClaimApproval{Command: f.versioned(version)}, http.StatusOK))
	f.insertApplicant(t, secondApplicantID, "member@example.edu", true)
	if err := f.club.Join(t.Context(), "admin-member-club", secondApplicantID); err != nil {
		t.Fatal(err)
	}
	club := decodeCatalog[clubs.AdminClub](t, f.request(t, "GET", "/admin/v1/clubs/"+*approved.ClubID, nil, http.StatusOK))
	roles := map[string]string{}
	for _, member := range club.Members {
		roles[member.UserID] = member.Role
	}
	if want := map[string]string{catalogTargetID: clubs.RoleOwner, secondApplicantID: clubs.RoleMember}; !reflect.DeepEqual(roles, want) {
		t.Fatalf("admin members = %v, want %v", roles, want)
	}

	if code := f.errorCode(t, "POST", "/admin/v1/clubs/"+club.ID+"/remove-member",
		clubs.MemberRemoval{Command: f.versioned(club.UpdatedAt), UserID: catalogTargetID}, http.StatusConflict); code != "club_owner_cannot_be_removed" {
		t.Fatalf("removing the owner = %q", code)
	}
	removed := decodeCatalog[clubs.AdminClub](t, f.request(t, "POST", "/admin/v1/clubs/"+club.ID+"/remove-member",
		clubs.MemberRemoval{Command: f.versioned(club.UpdatedAt), UserID: secondApplicantID}, http.StatusOK))
	if len(removed.Members) != 1 || removed.Members[0].UserID != catalogTargetID {
		t.Fatalf("members after removal = %+v, want only the owner", removed.Members)
	}
	if err := f.club.Join(t.Context(), "admin-member-club", secondApplicantID); err != nil {
		t.Fatalf("Join(after removal) error = %v", err)
	}
}
