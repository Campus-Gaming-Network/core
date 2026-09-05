package users

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DeleteAccount is a single multi-table transaction, so fakes would assert
// nothing about it. Runs only when API_DATABASE_URL points at a migrated
// database; local runs without one skip while CI provisions PostgreSQL.
func newDeletionFixture(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("API_DATABASE_URL")
	if url == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	var schoolID string
	slug := "deletion-school-" + strings.ReplaceAll(t.Name(), "/", "-")
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO schools (name, slug) VALUES ('Deletion School', $1)
		RETURNING id::text`, slug).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM schools WHERE id = $1::uuid`, schoolID)
	})
	return pool, schoolID
}

func insertUser(t *testing.T, pool *pgxpool.Pool, schoolID, email string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		VALUES ($1, 'hash', 'Player', $2::uuid, NOW())
		RETURNING id::text`, email, schoolID).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, id)
	})
	return id
}

func insertTeam(t *testing.T, pool *pgxpool.Pool, ownerID, slug string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO teams (owner_user_id, name, slug, password_hash)
		VALUES ($1::uuid, 'Team', $2, 'hash')
		RETURNING id::text`, ownerID, slug).Scan(&id); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM teams WHERE id = $1::uuid`, id)
	})
	return id
}

func addMember(t *testing.T, pool *pgxpool.Pool, teamID, userID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
		teamID, userID, role); err != nil {
		t.Fatalf("insert member: %v", err)
	}
}

func insertDeletionEvent(t *testing.T, pool *pgxpool.Pool, creatorID, schoolID, slug string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, visibility, format,
			starts_at, ends_at
		)
		VALUES (
			$1::uuid, $2::uuid, 'Deletion Event', $3, 'public', 'online',
			NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days'
		)
		RETURNING id::text`, creatorID, schoolID, slug).Scan(&id); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO event_organizers (event_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'creator')`, id, creatorID); err != nil {
		t.Fatalf("insert event creator: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM events WHERE id = $1::uuid`, id)
	})
	return id
}

func addEventOrganizer(t *testing.T, pool *pgxpool.Pool, eventID, userID string, createdAt time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO event_organizers (event_id, user_id, role, created_at)
		VALUES ($1::uuid, $2::uuid, 'organizer', $3)`, eventID, userID, createdAt); err != nil {
		t.Fatalf("insert event organizer: %v", err)
	}
}

func TestDeleteAccountScrubsIdentifyingData(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	userID := insertUser(t, pool, schoolID, "scrub@example.test")

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_social_links (user_id, label, url) VALUES ($1::uuid, 'Discord', 'https://example.test')`,
		userID); err != nil {
		t.Fatalf("insert social link: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_school_follows (user_id, school_id) VALUES ($1::uuid, $2::uuid)`,
		userID, schoolID); err != nil {
		t.Fatalf("insert follow: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth_sessions (user_id, token_hash, expires_at)
		VALUES ($1::uuid, '\xfe'::bytea, NOW() + INTERVAL '10 days')`, userID); err != nil {
		t.Fatalf("insert session: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO notifications (user_id, type, title, body)
		VALUES ($1::uuid, 'account.test', 'Test', 'Personal notification')`, userID); err != nil {
		t.Fatalf("insert notification: %v", err)
	}
	var assignedReportID, assignedTicketID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO reports (
			reporter_user_id, target_type, target_id, reason, assigned_to_user_id
		)
		VALUES ($1::uuid, 'user', $1::uuid, 'Assignment cleanup test', $1::uuid)
		RETURNING id::text`, userID).Scan(&assignedReportID); err != nil {
		t.Fatalf("insert assigned report: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO support_tickets (
			submitter_user_id, contact_email, subject, message, assigned_to_user_id
		)
		VALUES ($1::uuid, 'scrub@example.test', 'Assignment test', 'Help', $1::uuid)
		RETURNING id::text`, userID).Scan(&assignedTicketID); err != nil {
		t.Fatalf("insert assigned support ticket: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM reports WHERE id = $1::uuid`, assignedReportID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM support_tickets WHERE id = $1::uuid`, assignedTicketID)
	})
	var auditID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
		VALUES ($1::uuid, 'account.test', 'user', $1::uuid)
		RETURNING id::text`, userID).Scan(&auditID); err != nil {
		t.Fatalf("insert audit history: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_logs WHERE id = $1::uuid`, auditID)
	})

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, userID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var email, name, status string
	var bio *string
	if err := pool.QueryRow(ctx, `
		SELECT email::text, name, account_status, bio FROM users WHERE id = $1::uuid`,
		userID).Scan(&email, &name, &status, &bio); err != nil {
		t.Fatalf("read scrubbed user: %v", err)
	}
	if email == "scrub@example.test" {
		t.Fatal("email was not scrubbed")
	}
	if !strings.HasSuffix(email, "@deleted.invalid") {
		t.Fatalf("email = %q, want a deleted placeholder", email)
	}
	if name != DeletedNamePlaceholder {
		t.Fatalf("name = %q, want %q", name, DeletedNamePlaceholder)
	}
	if status != "deleted" {
		t.Fatalf("account_status = %q, want deleted", status)
	}
	if bio != nil {
		t.Fatalf("bio = %q, want NULL", *bio)
	}

	for _, check := range []struct {
		label string
		query string
	}{
		{"social links", `SELECT COUNT(*) FROM user_social_links WHERE user_id = $1::uuid`},
		{"school follows", `SELECT COUNT(*) FROM user_school_follows WHERE user_id = $1::uuid`},
		{"notifications", `SELECT COUNT(*) FROM notifications WHERE user_id = $1::uuid`},
		{"live sessions", `SELECT COUNT(*) FROM auth_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL`},
	} {
		var count int
		if err := pool.QueryRow(ctx, check.query, userID).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", check.label, err)
		}
		if count != 0 {
			t.Fatalf("%s remaining = %d, want 0", check.label, count)
		}
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM audit_logs
		WHERE id = $1::uuid AND actor_user_id = $2::uuid
	`, auditID, userID).Scan(&auditCount); err != nil {
		t.Fatalf("count retained audit history: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("retained audit history = %d, want 1", auditCount)
	}

	for _, check := range []struct {
		label string
		query string
		id    string
	}{
		{"report", `SELECT assigned_to_user_id::text FROM reports WHERE id = $1::uuid`, assignedReportID},
		{"support ticket", `SELECT assigned_to_user_id::text FROM support_tickets WHERE id = $1::uuid`, assignedTicketID},
	} {
		var assignee *string
		if err := pool.QueryRow(ctx, check.query, check.id).Scan(&assignee); err != nil {
			t.Fatalf("read %s assignment: %v", check.label, err)
		}
		if assignee != nil {
			t.Fatalf("%s assignee = %q, want NULL", check.label, *assignee)
		}
	}

	// The scrubbed address must free the original for re-registration.
	reused := insertUser(t, pool, schoolID, "scrub@example.test")
	if reused == "" {
		t.Fatal("could not re-register the released email")
	}
}

func TestDeleteAccountTransfersCreatedEventToLongestTenuredActiveOrganizer(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	creatorID := insertUser(t, pool, schoolID, "event-creator@example.test")
	firstOrganizerID := insertUser(t, pool, schoolID, "event-first@example.test")
	secondOrganizerID := insertUser(t, pool, schoolID, "event-second@example.test")
	eventID := insertDeletionEvent(t, pool, creatorID, schoolID, "deletion-event-transfer")

	joinedAt := time.Now().Add(-2 * time.Hour).UTC()
	addEventOrganizer(t, pool, eventID, firstOrganizerID, joinedAt)
	addEventOrganizer(t, pool, eventID, secondOrganizerID, joinedAt.Add(time.Hour))

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, creatorID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var newCreatorID, successorRole string
	var deletedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT e.creator_user_id::text, e.deleted_at, eo.role
		FROM events e
		JOIN event_organizers eo
		  ON eo.event_id = e.id AND eo.user_id = e.creator_user_id
		WHERE e.id = $1::uuid
	`, eventID).Scan(&newCreatorID, &deletedAt, &successorRole); err != nil {
		t.Fatalf("read transferred event: %v", err)
	}
	if newCreatorID != firstOrganizerID {
		t.Fatalf("event creator = %s, want longest-tenured organizer %s", newCreatorID, firstOrganizerID)
	}
	if deletedAt != nil {
		t.Fatal("event with an active successor was soft deleted")
	}
	if successorRole != "creator" {
		t.Fatalf("successor role = %q, want creator", successorRole)
	}

	var formerMemberships int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM event_organizers
		WHERE event_id = $1::uuid AND user_id = $2::uuid
	`, eventID, creatorID).Scan(&formerMemberships); err != nil {
		t.Fatalf("count former organizer memberships: %v", err)
	}
	if formerMemberships != 0 {
		t.Fatalf("former organizer memberships = %d, want 0", formerMemberships)
	}
}

func TestDeleteAccountSoftDeletesEventWithoutActiveSuccessor(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	creatorID := insertUser(t, pool, schoolID, "orphan-event-creator@example.test")
	inactiveOrganizerID := insertUser(t, pool, schoolID, "inactive-event-organizer@example.test")
	eventID := insertDeletionEvent(t, pool, creatorID, schoolID, "deletion-event-orphan")
	addEventOrganizer(t, pool, eventID, inactiveOrganizerID, time.Now().Add(-time.Hour).UTC())
	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET account_status = 'suspended'
		WHERE id = $1::uuid`, inactiveOrganizerID); err != nil {
		t.Fatalf("suspend organizer: %v", err)
	}

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, creatorID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var deletedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT deleted_at FROM events WHERE id = $1::uuid
	`, eventID).Scan(&deletedAt); err != nil {
		t.Fatalf("read orphaned event: %v", err)
	}
	if deletedAt == nil {
		t.Fatal("event without an active successor was not soft deleted")
	}
}

func TestDeleteAccountArchivesPastEventAndChildRecords(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	creatorID := insertUser(t, pool, schoolID, "past-event-creator@example.test")
	organizerID := insertUser(t, pool, schoolID, "past-event-organizer@example.test")
	eventID := insertDeletionEvent(t, pool, creatorID, schoolID, "deletion-event-past")
	addEventOrganizer(t, pool, eventID, organizerID, time.Now().Add(-2*time.Hour).UTC())

	seeds := []struct {
		label string
		query string
		args  []any
	}{
		{label: "past dates", query: `
			UPDATE events
			SET starts_at = NOW() - INTERVAL '2 days',
			    ends_at = NOW() - INTERVAL '1 day'
			WHERE id = $1::uuid`, args: []any{eventID}},
		{label: "RSVP", query: `
			INSERT INTO event_rsvps (event_id, user_id, response)
			VALUES ($1::uuid, $2::uuid, 'yes')`, args: []any{eventID, organizerID}},
		{label: "interest", query: `
			INSERT INTO event_interests (event_id, user_id)
			VALUES ($1::uuid, $2::uuid)`, args: []any{eventID, organizerID}},
		{label: "private unlock", query: `
			INSERT INTO event_private_unlocks (event_id, token_hash, expires_at)
			VALUES (
			    $1::uuid,
			    decode(replace(gen_random_uuid()::text, '-', ''), 'hex'),
			    NOW() + INTERVAL '1 day'
			)`, args: []any{eventID}},
	}
	for _, seed := range seeds {
		if _, err := pool.Exec(ctx, seed.query, seed.args...); err != nil {
			t.Fatalf("seed past event %s: %v", seed.label, err)
		}
	}

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, creatorID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var retainedCreatorID string
	var deletedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT creator_user_id::text, deleted_at
		FROM events
		WHERE id = $1::uuid
	`, eventID).Scan(&retainedCreatorID, &deletedAt); err != nil {
		t.Fatalf("read past event: %v", err)
	}
	if retainedCreatorID != creatorID {
		t.Fatalf("past event creator = %s, want retained creator %s", retainedCreatorID, creatorID)
	}
	if deletedAt == nil {
		t.Fatal("past event was not soft deleted")
	}

	for _, table := range []string{
		"event_organizers",
		"event_rsvps",
		"event_interests",
		"event_private_unlocks",
	} {
		var activeRecords int
		query := "SELECT COUNT(*) FROM " + table + " WHERE event_id = $1::uuid AND deleted_at IS NULL"
		if err := pool.QueryRow(ctx, query, eventID).Scan(&activeRecords); err != nil {
			t.Fatalf("count active %s: %v", table, err)
		}
		if activeRecords != 0 {
			t.Fatalf("active %s records = %d, want 0", table, activeRecords)
		}
	}
}

func TestDeleteAccountDetachesSupportTicketsAndScrubsTerminalContact(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	userID := insertUser(t, pool, schoolID, "ticket-owner@example.test")

	insertTicket := func(status, subject string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO support_tickets (
				submitter_user_id, contact_email, name, subject, message, status
			)
			VALUES ($1::uuid, 'ticket-owner@example.test', 'Ticket Owner', $2, 'Case details', $3)
			RETURNING id::text
		`, userID, subject, status).Scan(&id); err != nil {
			t.Fatalf("insert %s ticket: %v", status, err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM support_tickets WHERE id = $1::uuid`, id)
		})
		return id
	}
	openTicketID := insertTicket("open", "Pending support")
	resolvedTicketID := insertTicket("resolved", "Finished support")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, userID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	for _, check := range []struct {
		id        string
		label     string
		wantEmail string
		wantName  string
	}{
		{openTicketID, "open", "ticket-owner@example.test", "Ticket Owner"},
		{resolvedTicketID, "resolved", "deleted@deleted.invalid", ""},
	} {
		var submitterID *string
		var submitterDeletedAt *time.Time
		var email, name string
		if err := pool.QueryRow(ctx, `
			SELECT submitter_user_id::text, submitter_deleted_at, contact_email, name
			FROM support_tickets
			WHERE id = $1::uuid
		`, check.id).Scan(&submitterID, &submitterDeletedAt, &email, &name); err != nil {
			t.Fatalf("read %s ticket: %v", check.label, err)
		}
		if submitterID != nil {
			t.Fatalf("%s ticket submitter = %q, want NULL", check.label, *submitterID)
		}
		if submitterDeletedAt == nil {
			t.Fatalf("%s ticket submitter_deleted_at = nil", check.label)
		}
		if email != check.wantEmail || name != check.wantName {
			t.Fatalf("%s ticket contact = (%q, %q), want (%q, %q)", check.label, email, name, check.wantEmail, check.wantName)
		}
	}
}

func TestDeleteAccountSkipsInactiveTeamSuccessor(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	ownerID := insertUser(t, pool, schoolID, "inactive-successor-owner@example.test")
	suspendedCaptainID := insertUser(t, pool, schoolID, "inactive-successor-captain@example.test")
	activeMemberID := insertUser(t, pool, schoolID, "inactive-successor-member@example.test")
	teamID := insertTeam(t, pool, ownerID, "deletion-team-inactive-successor")
	addMember(t, pool, teamID, ownerID, "owner")
	addMember(t, pool, teamID, suspendedCaptainID, "captain")
	addMember(t, pool, teamID, activeMemberID, "member")
	if _, err := pool.Exec(ctx, `
		UPDATE users SET account_status = 'suspended'
		WHERE id = $1::uuid
	`, suspendedCaptainID); err != nil {
		t.Fatalf("suspend captain: %v", err)
	}

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, ownerID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var newOwnerID, newOwnerRole string
	if err := pool.QueryRow(ctx, `
		SELECT t.owner_user_id::text, m.role
		FROM teams t
		JOIN team_members m
		  ON m.team_id = t.id AND m.user_id = t.owner_user_id
		WHERE t.id = $1::uuid
	`, teamID).Scan(&newOwnerID, &newOwnerRole); err != nil {
		t.Fatalf("read transferred team: %v", err)
	}
	if newOwnerID != activeMemberID || newOwnerRole != "owner" {
		t.Fatalf("team owner = (%s, %s), want active member (%s, owner)", newOwnerID, newOwnerRole, activeMemberID)
	}
}

func TestDeleteAccountRevokesSchoolAdminGrant(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	userID := insertUser(t, pool, schoolID, "school-admin-delete@example.test")
	if _, err := pool.Exec(ctx, `
		INSERT INTO school_admins (school_id, user_id)
		VALUES ($1::uuid, $2::uuid)
	`, schoolID, userID); err != nil {
		t.Fatalf("insert school admin: %v", err)
	}

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, userID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var grants int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM school_admins WHERE user_id = $1::uuid
	`, userID).Scan(&grants); err != nil {
		t.Fatalf("count school admin grants: %v", err)
	}
	if grants != 0 {
		t.Fatalf("school admin grants = %d, want 0", grants)
	}
}

func TestDeleteAccountPromotesCaptainOverMember(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	owner := insertUser(t, pool, schoolID, "owner-captain@example.test")
	member := insertUser(t, pool, schoolID, "member@example.test")
	captain := insertUser(t, pool, schoolID, "captain@example.test")
	teamID := insertTeam(t, pool, owner, "deletion-team-captain")

	addMember(t, pool, teamID, owner, "owner")
	addMember(t, pool, teamID, member, "member") // joins first
	addMember(t, pool, teamID, captain, "captain")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, owner); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var newOwner string
	var deletedAt *string
	if err := pool.QueryRow(ctx, `
		SELECT owner_user_id::text, deleted_at::text FROM teams WHERE id = $1::uuid`,
		teamID).Scan(&newOwner, &deletedAt); err != nil {
		t.Fatalf("read team: %v", err)
	}
	if deletedAt != nil {
		t.Fatal("team was soft deleted despite having members")
	}
	if newOwner != captain {
		t.Fatalf("owner = %s, want the captain %s (member was %s)", newOwner, captain, member)
	}

	var role string
	if err := pool.QueryRow(ctx, `
		SELECT role FROM team_members WHERE team_id = $1::uuid AND user_id = $2::uuid`,
		teamID, captain).Scan(&role); err != nil {
		t.Fatalf("read new owner role: %v", err)
	}
	if role != "owner" {
		t.Fatalf("new owner role = %q, want owner", role)
	}
}

func TestDeleteAccountPromotesMemberWhenNoCaptain(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	owner := insertUser(t, pool, schoolID, "owner-member@example.test")
	member := insertUser(t, pool, schoolID, "sole-member@example.test")
	teamID := insertTeam(t, pool, owner, "deletion-team-member")

	addMember(t, pool, teamID, owner, "owner")
	addMember(t, pool, teamID, member, "member")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, owner); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var newOwner string
	if err := pool.QueryRow(ctx, `
		SELECT owner_user_id::text FROM teams WHERE id = $1::uuid`, teamID).Scan(&newOwner); err != nil {
		t.Fatalf("read team: %v", err)
	}
	if newOwner != member {
		t.Fatalf("owner = %s, want the remaining member %s", newOwner, member)
	}
}

func TestDeleteAccountSoftDeletesSoleMemberTeam(t *testing.T) {
	pool, schoolID := newDeletionFixture(t)
	ctx := context.Background()
	owner := insertUser(t, pool, schoolID, "owner-alone@example.test")
	teamID := insertTeam(t, pool, owner, "deletion-team-alone")
	addMember(t, pool, teamID, owner, "owner")

	if err := NewPostgresRepository(pool).DeleteAccount(ctx, owner); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	var deletedAt *string
	if err := pool.QueryRow(ctx, `
		SELECT deleted_at::text FROM teams WHERE id = $1::uuid`, teamID).Scan(&deletedAt); err != nil {
		t.Fatalf("read team: %v", err)
	}
	if deletedAt == nil {
		t.Fatal("team with no other members was not soft deleted")
	}
}
