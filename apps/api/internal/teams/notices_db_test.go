package teams

import (
	"context"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/emailoutbox"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/notifications"
)

func TestPostgresRepositoryNotifiesTheOwnerOfJoinsAndTheNewOwnerOfATransfer(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "team_notices")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	var schoolID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO schools (name, slug) VALUES ('Notice School', 'notice-school') RETURNING id::text
	`).Scan(&schoolID); err != nil {
		t.Fatalf("insert school: %v", err)
	}
	user := func(name string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
			VALUES ($1 || '@example.test', 'hash', $1, $2::uuid, NOW())
			RETURNING id::text
		`, name, schoolID).Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", name, err)
		}
		return id
	}
	ownerID := user("Owen")
	joinerID := user("Jo")

	var teamID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
		VALUES ($1::uuid, $2::uuid, 'Notice Team', 'notice-team', 'hash')
		RETURNING id::text
	`, ownerID, schoolID).Scan(&teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')
	`, teamID, ownerID); err != nil {
		t.Fatalf("insert owner: %v", err)
	}

	type notice struct{ Type, Title, Body, TeamSlug string }
	inbox := func(userID string) []notice {
		t.Helper()
		page, err := notifications.NewPostgresRepository(pool).List(ctx, userID, nil, notifications.MaximumLimit)
		if err != nil {
			t.Fatalf("List(%s) error = %v", userID, err)
		}
		notices := make([]notice, 0, len(page.Notifications))
		for _, n := range page.Notifications {
			notices = append(notices, notice{n.Type, n.Title, n.Body, n.TeamSlug})
		}
		return notices
	}

	repository := NewPostgresRepository(pool)
	const slug = "notice-team"
	// Joining twice, and the owner joining their own team, tell the owner
	// only once.
	for _, userID := range []string{joinerID, joinerID, ownerID} {
		if _, err := repository.Join(ctx, slug, userID); err != nil {
			t.Fatalf("Join(%s) error = %v", userID, err)
		}
	}
	joined := notice{notifications.TypeTeamMemberJoined, "New team member", "Jo joined Notice Team.", slug}
	if got, want := inbox(ownerID), []notice{joined}; !reflect.DeepEqual(got, want) {
		t.Fatalf("owner inbox after joins = %#v, want %#v", got, want)
	}
	// Leaving and joining again is a new join, with its own email.
	if _, err := repository.Leave(ctx, slug, joinerID); err != nil {
		t.Fatalf("Leave() error = %v", err)
	}
	if _, err := repository.Join(ctx, slug, joinerID); err != nil {
		t.Fatalf("rejoin error = %v", err)
	}
	if got, want := inbox(ownerID), []notice{joined, joined}; !reflect.DeepEqual(got, want) {
		t.Fatalf("owner inbox after rejoin = %#v, want %#v", got, want)
	}

	if _, err := repository.TransferOwnership(ctx, slug, ownerID, joinerID); err != nil {
		t.Fatalf("TransferOwnership() error = %v", err)
	}
	transferred := notice{notifications.TypeTeamOwnershipTransferred, "You own a team", "Owen made you the owner of Notice Team.", slug}
	if got, want := inbox(joinerID), []notice{transferred}; !reflect.DeepEqual(got, want) {
		t.Fatalf("new owner inbox = %#v, want %#v", got, want)
	}
	if got, want := inbox(ownerID), []notice{joined, joined}; !reflect.DeepEqual(got, want) {
		t.Fatalf("previous owner inbox after transfer = %#v, want %#v", got, want)
	}

	type email struct {
		Kind      string
		Recipient string
		Payload   NoticePayload
	}
	rows, err := pool.Query(ctx, `SELECT kind, recipient, payload, idempotency_key FROM email_outbox ORDER BY created_at, id`)
	if err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	var emails []email
	keys := map[string]bool{}
	for rows.Next() {
		var queued email
		var key string
		if err := rows.Scan(&queued.Kind, &queued.Recipient, &queued.Payload, &key); err != nil {
			t.Fatalf("scan outbox: %v", err)
		}
		emails = append(emails, queued)
		keys[key] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	joinedEmail := email{emailoutbox.KindTeamMemberJoined, "Owen@example.test", NoticePayload{TeamName: "Notice Team", TeamSlug: slug, PersonName: "Jo"}}
	transferredEmail := email{emailoutbox.KindTeamOwnershipTransferred, "Jo@example.test", NoticePayload{TeamName: "Notice Team", TeamSlug: slug, PersonName: "Owen"}}
	if want := []email{joinedEmail, joinedEmail, transferredEmail}; !reflect.DeepEqual(emails, want) {
		t.Fatalf("queued emails = %#v, want %#v", emails, want)
	}
	if len(keys) != len(emails) {
		t.Fatalf("idempotency keys = %v, want one per email", keys)
	}
}
