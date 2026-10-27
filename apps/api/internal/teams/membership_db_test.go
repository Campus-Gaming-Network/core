package teams

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryLeaveAndRemoveMember(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "teams")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	var schoolID string
	schoolID = dbtest.InsertSchool(t, pool, "Roster School", "roster-school")
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
	ownerID := user("owner")
	captainID := user("captain")
	memberID := user("member")
	outsiderID := user("outsider")

	var teamID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
		VALUES ($1::uuid, $2::uuid, 'Roster Team', 'roster-team', 'hash')
		RETURNING id::text
	`, ownerID, schoolID).Scan(&teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO team_members (team_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'owner'), ($1::uuid, $3::uuid, 'captain'), ($1::uuid, $4::uuid, 'member')
	`, teamID, ownerID, captainID, memberID); err != nil {
		t.Fatalf("insert members: %v", err)
	}

	repository := NewPostgresRepository(pool)
	const slug = "roster-team"
	roster := func() []string {
		t.Helper()
		members, err := repository.ListMembers(ctx, slug)
		if err != nil {
			t.Fatalf("ListMembers() error = %v", err)
		}
		names := make([]string, 0, len(members))
		for _, member := range members {
			names = append(names, member.Name+"="+member.Role)
		}
		return names
	}

	refusals := []struct {
		name string
		call func() error
		want error
	}{
		{"owner leaves", func() error { _, err := repository.Leave(ctx, slug, ownerID); return err }, ErrOwnerCannotLeave},
		{"outsider leaves", func() error { _, err := repository.Leave(ctx, slug, outsiderID); return err }, ErrTeamMemberNotFound},
		{"missing team", func() error { _, err := repository.Leave(ctx, "no-such-team", memberID); return err }, ErrTeamNotFound},
		{"captain removes", func() error { _, err := repository.RemoveMember(ctx, slug, captainID, memberID); return err }, ErrNotTeamOwner},
		{"owner removes self", func() error { _, err := repository.RemoveMember(ctx, slug, ownerID, ownerID); return err }, ErrInvalidTeamRole},
		{"owner removes outsider", func() error { _, err := repository.RemoveMember(ctx, slug, ownerID, outsiderID); return err }, ErrTeamMemberNotFound},
	}
	for _, refusal := range refusals {
		if err := refusal.call(); !errors.Is(err, refusal.want) {
			t.Errorf("%s: error = %v, want %v", refusal.name, err, refusal.want)
		}
	}
	if got, want := roster(), []string{"owner=owner", "captain=captain", "member=member"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roster after refusals = %v, want %v", got, want)
	}

	left, err := repository.Leave(ctx, slug, captainID)
	if err != nil {
		t.Fatalf("Leave(captain) error = %v", err)
	}
	if left.ViewerRole != nil || left.MemberCount != 2 {
		t.Fatalf("Leave(captain) = viewer role %v, %d members; want none and 2", left.ViewerRole, left.MemberCount)
	}
	afterRemove, err := repository.RemoveMember(ctx, slug, ownerID, memberID)
	if err != nil {
		t.Fatalf("RemoveMember() error = %v", err)
	}
	if afterRemove.MemberCount != 1 {
		t.Fatalf("RemoveMember() member count = %d, want 1", afterRemove.MemberCount)
	}
	if got, want := roster(), []string{"owner=owner"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("roster after leave and remove = %v, want %v", got, want)
	}

	if _, err := repository.Join(ctx, slug, captainID); err != nil {
		t.Fatalf("Join(former captain) error = %v", err)
	}
	if role, err := repository.MembershipRole(ctx, slug, captainID); err != nil || role != RoleMember {
		t.Fatalf("rejoined role = %q, %v; want member", role, err)
	}
}
