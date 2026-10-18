package clubs

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
)

func TestPostgresRepositoryReadsPublishedClubs(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "clubs")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	insert := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, query+" RETURNING id::text", args...).Scan(&id); err != nil {
			t.Fatalf("insert %q: %v", query, err)
		}
		return id
	}
	schoolID := insert(`INSERT INTO schools (name, slug, city, state) VALUES ('Club University', 'club-university', 'Irvine', 'CA')`)
	insert(`INSERT INTO schools (name, slug) VALUES ('Quiet College', 'quiet-college')`)
	valorantID := insert(`INSERT INTO games (name, slug) VALUES ('Valorant', 'valorant')`)
	leagueID := insert(`INSERT INTO games (name, slug) VALUES ('League of Legends', 'league-of-legends')`)
	confirmed := time.Date(2031, time.March, 4, 12, 0, 0, 0, time.UTC)

	esportsID := insert(`
		INSERT INTO clubs (school_id, name, slug, type, summary, how_to_join, confirmed_at, confirmed_source)
		VALUES ($1::uuid, 'Esports Program', 'esports-program', 'university_program',
		        'Varsity rosters for three titles.', 'Tryouts each September. Sign up at the fall fair.', $2, 'cgn')
	`, schoolID, confirmed)
	if _, err := pool.Exec(ctx, `
		INSERT INTO club_games (club_id, game_id) VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid);
	`, esportsID, valorantID, leagueID); err != nil {
		t.Fatalf("insert club games: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO club_links (club_id, type, label, url, position)
		VALUES ($1::uuid, 'discord', 'Discord', 'https://discord.example.test/esports', 1),
		       ($1::uuid, 'website', 'Program site', 'https://club.example.test/esports', 0)
	`, esportsID); err != nil {
		t.Fatalf("insert club links: %v", err)
	}
	// A club that has said nothing beyond its name and type.
	insert(`INSERT INTO clubs (school_id, name, slug, type) VALUES ($1::uuid, 'casual gamers', 'casual-gamers', 'student_club')`, schoolID)
	insert(`INSERT INTO clubs (school_id, name, slug, type, status) VALUES ($1::uuid, 'Hidden Guild', 'hidden-guild', 'student_club', 'hidden')`, schoolID)
	insert(`INSERT INTO clubs (school_id, name, slug, type, deleted_at) VALUES ($1::uuid, 'Old Club', 'old-club', 'student_club', NOW())`, schoolID)

	repository := NewPostgresRepository(pool)

	listed, err := repository.ListBySchool(ctx, "club-university")
	if err != nil {
		t.Fatalf("ListBySchool() error = %v", err)
	}
	valorant := GameSummary{ID: valorantID, Name: "Valorant", Slug: "valorant"}
	league := GameSummary{ID: leagueID, Name: "League of Legends", Slug: "league-of-legends"}
	wantListed := []ListItem{
		{ID: listed[0].ID, Name: "casual gamers", Slug: "casual-gamers", Type: TypeStudentClub, Games: []GameSummary{}},
		{ID: esportsID, Name: "Esports Program", Slug: "esports-program", Type: TypeUniversityProgram, Summary: "Varsity rosters for three titles.", Games: []GameSummary{league, valorant}},
	}
	if !reflect.DeepEqual(listed, wantListed) {
		t.Fatalf("ListBySchool() = %+v, want %+v", listed, wantListed)
	}

	esports, err := repository.GetBySlug(ctx, "esports-program")
	if err != nil {
		t.Fatalf("GetBySlug() error = %v", err)
	}
	wantEsports := Club{
		ID: esportsID, Name: "Esports Program", Slug: "esports-program", Type: TypeUniversityProgram,
		Summary:   "Varsity rosters for three titles.",
		HowToJoin: "Tryouts each September. Sign up at the fall fair.",
		School:    SchoolSummary{ID: schoolID, Name: "Club University", Slug: "club-university", City: "Irvine", State: "CA"},
		Games:     []GameSummary{league, valorant},
		Links: []Link{
			{Type: "website", Label: "Program site", URL: "https://club.example.test/esports"},
			{Type: "discord", Label: "Discord", URL: "https://discord.example.test/esports"},
		},
		ConfirmedSource: ConfirmedByCGN,
	}
	if esports.ConfirmedAt == nil || !esports.ConfirmedAt.Equal(confirmed) {
		t.Fatalf("ConfirmedAt = %v, want %v", esports.ConfirmedAt, confirmed)
	}
	esports.ConfirmedAt = nil
	if !reflect.DeepEqual(esports, wantEsports) {
		t.Fatalf("GetBySlug() = %+v, want %+v", esports, wantEsports)
	}

	casual, err := repository.GetBySlug(ctx, "casual-gamers")
	if err != nil {
		t.Fatalf("GetBySlug(casual) error = %v", err)
	}
	if casual.HowToJoin != "" || len(casual.Games) != 0 || len(casual.Links) != 0 || casual.ConfirmedAt != nil || casual.Claimed {
		t.Fatalf("bare club = %+v, want no how to join, games, links, confirmation, or claim", casual)
	}

	for _, slug := range []string{"hidden-guild", "old-club", "no-such-club"} {
		if _, err := repository.GetBySlug(ctx, slug); !errors.Is(err, ErrClubNotFound) {
			t.Errorf("GetBySlug(%s) error = %v, want ErrClubNotFound", slug, err)
		}
	}
	quiet, err := repository.ListBySchool(ctx, "quiet-college")
	if err != nil || len(quiet) != 0 {
		t.Fatalf("ListBySchool(quiet) = %v, %v; want an empty list", quiet, err)
	}
	if _, err := repository.ListBySchool(ctx, "no-such-school"); !errors.Is(err, ErrSchoolNotFound) {
		t.Fatalf("ListBySchool(missing) error = %v, want ErrSchoolNotFound", err)
	}
}

func TestClubLinksAcceptOnlyHTTPURLs(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "clubs")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	var clubID string
	if err := pool.QueryRow(ctx, `
		WITH school AS (INSERT INTO schools (name, slug) VALUES ('Link School', 'link-school') RETURNING id)
		INSERT INTO clubs (school_id, name, slug, type) SELECT id, 'Link Club', 'link-club', 'student_club' FROM school
		RETURNING id::text
	`).Scan(&clubID); err != nil {
		t.Fatalf("insert club: %v", err)
	}
	for url, wantOK := range map[string]bool{
		"https://club.example.test": true,
		"http://club.example.test":  true,
		"javascript:alert(1)":       false,
		"ftp://club.example.test":   false,
	} {
		_, err := pool.Exec(ctx, `
			INSERT INTO club_links (club_id, type, label, url) VALUES ($1::uuid, 'website', 'Site', $2)
		`, clubID, url)
		if (err == nil) != wantOK {
			t.Errorf("link %q: error = %v, want accepted = %v", url, err, wantOK)
		}
	}
}
