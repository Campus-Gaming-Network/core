package teams

import (
	"context"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
)

func TestPostgresRepositoryTeamGamesReportServedCovers(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewMigratedSchemaPool(t, "team_covers")

	var ownerID, teamID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('Cover School', 'cover-school') RETURNING id),
		     owner AS (
		       INSERT INTO users (email, password_hash, name, home_school_id, age_confirmed_at)
		       SELECT 'owner@example.test', 'hash', 'Owner', id, NOW() FROM school
		       RETURNING id
		     ),
		     team AS (
		       INSERT INTO teams (owner_user_id, school_id, name, slug, password_hash)
		       SELECT owner.id, school.id, 'Cover Team', 'cover-team', 'hash' FROM owner, school
		       RETURNING id, owner_user_id
		     ),
		     membership AS (
		       INSERT INTO team_members (team_id, user_id, role) SELECT id, owner_user_id, 'owner' FROM team
		     )
		SELECT owner.id::text, team.id::text FROM owner, team
	`).Scan(&ownerID, &teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	game := func(name, slug string, covered bool) GameSummary {
		t.Helper()
		summary := GameSummary{Name: name, Slug: slug}
		if err := pool.QueryRow(ctx, `INSERT INTO games (name, slug) VALUES ($1, $2) RETURNING id::text`, name, slug).Scan(&summary.ID); err != nil {
			t.Fatalf("insert game %s: %v", name, err)
		}
		if covered {
			if _, err := pool.Exec(ctx, `
				INSERT INTO game_covers (game_id, content_type, bytes, source_image_id, etag)
				VALUES ($1::uuid, 'image/jpeg', '\xff'::bytea, 'cover', 'etag')
			`, summary.ID); err != nil {
				t.Fatalf("insert cover for %s: %v", name, err)
			}
		}
		if _, err := pool.Exec(ctx, `INSERT INTO team_games (team_id, game_id) VALUES ($1::uuid, $2::uuid)`, teamID, summary.ID); err != nil {
			t.Fatalf("link game %s: %v", name, err)
		}
		return summary
	}
	covered := game("Covered Game", "covered-game", true)
	plain := game("Plain Game", "plain-game", false)
	// A game hidden after the team chose it keeps its stored cover, but the
	// site stops serving it.
	hidden := game("Hidden Game", "hidden-game", true)
	if _, err := pool.Exec(ctx, `UPDATE games SET is_active = FALSE WHERE id = $1::uuid`, hidden.ID); err != nil {
		t.Fatalf("hide game: %v", err)
	}
	covered.HasCover = true

	repository := NewPostgresRepository(pool)
	listed, err := repository.ListPublic(ctx, ListParams{})
	if err != nil {
		t.Fatalf("ListPublic() error = %v", err)
	}
	detail, err := repository.GetBySlug(ctx, "cover-team")
	if err != nil {
		t.Fatalf("GetBySlug() error = %v", err)
	}
	mine, err := repository.ListForUser(ctx, ownerID, 5)
	if err != nil {
		t.Fatalf("ListForUser() error = %v", err)
	}
	gamesOf := func(teams []Team) [][]GameSummary {
		result := make([][]GameSummary, 0, len(teams))
		for _, team := range teams {
			result = append(result, team.Games)
		}
		return result
	}

	want := []GameSummary{covered, hidden, plain}
	got := map[string][][]GameSummary{"list": gamesOf(listed), "detail": gamesOf([]Team{detail}), "mine": gamesOf(mine)}
	wantAll := map[string][][]GameSummary{"list": {want}, "detail": {want}, "mine": {want}}
	if !reflect.DeepEqual(got, wantAll) {
		t.Fatalf("team games = %+v, want %+v", got, wantAll)
	}
}
