package adminhttp

import (
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/clubs"
)

func (f catalogFixture) publicSlug(t *testing.T, slug string) string {
	t.Helper()
	club, err := f.club.GetBySlug(t.Context(), slug)
	if errors.Is(err, clubs.ErrClubNotFound) {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return club.Slug
}

func TestClubAdminLifecycleReachesThePublicSite(t *testing.T) {
	f := newCatalogFixture(t)
	game := f.insertGame(t, "Club Game", "club-game")

	created := decodeCatalog[clubs.AdminClub](t, f.request(t, "POST", "/admin/v1/clubs", clubs.AdminCreate{
		Command:  f.command,
		SchoolID: catalogSchoolID,
		AdminFields: clubs.AdminFields{
			Name: "  Esports Program ", Slug: "esports-program", Type: clubs.TypeUniversityProgram,
			Summary: "Varsity rosters.", HowToJoin: "Tryouts in September.", GameIDs: []string{game.ID, game.ID},
		},
	}, http.StatusCreated))
	if created.Name != "Esports Program" || !created.IsActive || len(created.Games) != 1 || created.ConfirmedAt != nil {
		t.Fatalf("created = %+v, want a trimmed, published club with one game and no confirmation", created)
	}
	if got := f.publicSlug(t, "esports-program"); got != "esports-program" {
		t.Fatalf("public slug after create = %q", got)
	}

	withLinks := decodeCatalog[clubs.AdminClub](t, f.request(t, "POST", "/admin/v1/clubs/"+created.ID+"/links", clubs.LinksEdit{
		Command: f.versioned(created.UpdatedAt),
		Links: []clubs.Link{
			{Type: clubs.LinkWebsite, Label: "Site", URL: "https://club.example.test"},
			{Type: clubs.LinkDiscord, Label: "Discord", URL: "https://discord.example.test/club"},
		},
	}, http.StatusOK))
	public, err := f.club.GetBySlug(t.Context(), "esports-program")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(public.Links, withLinks.Links) || len(public.Links) != 2 || public.Links[0].Label != "Site" {
		t.Fatalf("public links = %+v, want %+v", public.Links, withLinks.Links)
	}

	renamed := decodeCatalog[clubs.AdminClub](t, f.request(t, "PATCH", "/admin/v1/clubs/"+created.ID, clubs.AdminEdit{
		Command:     f.versioned(withLinks.UpdatedAt),
		AdminFields: clubs.AdminFields{Name: "Anteater Esports", Slug: "anteater-esports", Type: clubs.TypeUniversityProgram, HowToJoin: "Tryouts in October."},
	}, http.StatusOK))
	if got := []string{f.publicSlug(t, "esports-program"), f.publicSlug(t, "anteater-esports")}; !reflect.DeepEqual(got, []string{"anteater-esports", "anteater-esports"}) {
		t.Fatalf("after rename, old and new slugs resolve to %v", got)
	}
	if len(renamed.Games) != 0 || renamed.HowToJoin != "Tryouts in October." {
		t.Fatalf("renamed = %+v, want games cleared and How to join updated", renamed)
	}

	other := f.newClub(t, "esports-program")
	if got := f.publicSlug(t, "esports-program"); got != "esports-program" {
		t.Fatalf("the old slug after another club took it resolves to %q", got)
	}
	taken := f.request(t, "PATCH", "/admin/v1/clubs/"+other.ID, clubs.AdminEdit{
		Command:     f.versioned(other.UpdatedAt),
		AdminFields: clubs.AdminFields{Name: "Clash", Slug: "anteater-esports", Type: clubs.TypeStudentClub},
	}, http.StatusConflict)
	if body := taken.Body.String(); body != `{"error":"admin_record_already_exists"}`+"\n" {
		t.Fatalf("taking a live slug = %s", body)
	}

	hidden := decodeCatalog[clubs.AdminClub](t, f.request(t, "POST", "/admin/v1/clubs/"+renamed.ID+"/hide", f.versioned(renamed.UpdatedAt), http.StatusOK))
	if got := []string{f.publicSlug(t, "anteater-esports"), f.publicSlug(t, "esports-program")}; !reflect.DeepEqual(got, []string{"", "esports-program"}) || hidden.IsActive {
		t.Fatalf("after hide: public %v, active %v", got, hidden.IsActive)
	}
	f.request(t, "POST", "/admin/v1/clubs/"+renamed.ID+"/hide", f.versioned(hidden.UpdatedAt), http.StatusConflict)
	unhidden := decodeCatalog[clubs.AdminClub](t, f.request(t, "POST", "/admin/v1/clubs/"+renamed.ID+"/unhide", f.versioned(hidden.UpdatedAt), http.StatusOK))
	if f.publicSlug(t, "anteater-esports") != "anteater-esports" || !unhidden.IsActive {
		t.Fatal("unhiding did not publish the club again")
	}

	checked := decodeCatalog[clubs.AdminClub](t, f.request(t, "POST", "/admin/v1/clubs/"+renamed.ID+"/mark-checked", f.versioned(unhidden.UpdatedAt), http.StatusOK))
	if checked.ConfirmedAt == nil || checked.ConfirmedSource == nil || *checked.ConfirmedSource != clubs.ConfirmedByCGN {
		t.Fatalf("checked = %+v, want a CGN confirmation", checked)
	}

	stale := f.request(t, "POST", "/admin/v1/clubs/"+renamed.ID+"/hide", f.versioned(unhidden.UpdatedAt), http.StatusConflict)
	conflict := decodeCatalog[struct {
		Error   string          `json:"error"`
		Current clubs.AdminClub `json:"current"`
	}](t, stale)
	if conflict.Error != "admin_record_conflict" || !conflict.Current.UpdatedAt.Equal(checked.UpdatedAt) {
		t.Fatalf("stale write = %+v", conflict)
	}

	listed := decodeCatalog[struct {
		Clubs []clubs.AdminClub `json:"clubs"`
	}](t, f.request(t, "GET", "/admin/v1/clubs?q=anteater&school="+catalogSchoolID, nil, http.StatusOK))
	if len(listed.Clubs) != 1 || listed.Clubs[0].ID != renamed.ID || listed.Clubs[0].Links == nil || listed.Clubs[0].Games == nil {
		t.Fatalf("listed = %+v, want the renamed club with its games and links", listed.Clubs)
	}
}

func TestClubAdminRejectsInvalidInput(t *testing.T) {
	f := newCatalogFixture(t)
	club := f.newClub(t, "valid-club")
	tooManyGames := make([]string, 21)
	for index := range tooManyGames {
		tooManyGames[index] = "10000000-0000-4000-8000-0000000000" + string(rune('a'+index%6)) + string(rune('a'+index/6))
	}
	for name, test := range map[string]struct {
		method, path string
		body         any
		status       int
	}{
		"blank name":     {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: f.command, SchoolID: catalogSchoolID, AdminFields: clubs.AdminFields{Name: " ", Slug: "blank", Type: clubs.TypeStudentClub}}, http.StatusBadRequest},
		"bad slug":       {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: f.command, SchoolID: catalogSchoolID, AdminFields: clubs.AdminFields{Name: "Club", Slug: "Not A Slug", Type: clubs.TypeStudentClub}}, http.StatusBadRequest},
		"unknown type":   {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: f.command, SchoolID: catalogSchoolID, AdminFields: clubs.AdminFields{Name: "Club", Slug: "typed", Type: "official"}}, http.StatusBadRequest},
		"too many games": {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: f.command, SchoolID: catalogSchoolID, AdminFields: clubs.AdminFields{Name: "Club", Slug: "games", Type: clubs.TypeStudentClub, GameIDs: tooManyGames}}, http.StatusBadRequest},
		"unknown game":   {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: f.command, SchoolID: catalogSchoolID, AdminFields: clubs.AdminFields{Name: "Club", Slug: "game", Type: clubs.TypeStudentClub, GameIDs: []string{"10000000-0000-4000-8000-00000000ffff"}}}, http.StatusUnprocessableEntity},
		"missing school": {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: f.command, SchoolID: "10000000-0000-4000-8000-00000000eeee", AdminFields: clubs.AdminFields{Name: "Club", Slug: "orphan", Type: clubs.TypeStudentClub}}, http.StatusNotFound},
		"no reason":      {"POST", "/admin/v1/clubs", clubs.AdminCreate{Command: adminmutation.Command{}, SchoolID: catalogSchoolID, AdminFields: clubs.AdminFields{Name: "Club", Slug: "reasonless", Type: clubs.TypeStudentClub}}, http.StatusBadRequest},
		"script link":    {"POST", "/admin/v1/clubs/" + club.ID + "/links", clubs.LinksEdit{Command: f.versioned(club.UpdatedAt), Links: []clubs.Link{{Type: clubs.LinkWebsite, Label: "Site", URL: "javascript:alert(1)"}}}, http.StatusBadRequest},
		"unknown link":   {"POST", "/admin/v1/clubs/" + club.ID + "/links", clubs.LinksEdit{Command: f.versioned(club.UpdatedAt), Links: []clubs.Link{{Type: "membership", Label: "Form", URL: "https://form.example.test"}}}, http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			f.request(t, test.method, test.path, test.body, test.status)
		})
	}
	var count int
	if err := f.pool.QueryRow(t.Context(), `SELECT COUNT(*) FROM clubs`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("clubs after refused input = %d, %v; want only the valid one", count, err)
	}
}

func TestASchoolWithClubsCannotBeDeleted(t *testing.T) {
	f := newCatalogFixture(t)
	school := f.newSchool(t, "club-school")
	if _, err := f.club.CreateAdmin(t.Context(), clubs.AdminCreate{
		Command: f.command, SchoolID: school.ID,
		AdminFields: clubs.AdminFields{Name: "Kept Club", Slug: "kept-club", Type: clubs.TypeStudentClub},
	}); err != nil {
		t.Fatal(err)
	}
	refused := f.request(t, "DELETE", "/admin/v1/schools/"+school.ID, f.versioned(school.UpdatedAt), http.StatusConflict)
	if body := refused.Body.String(); body != `{"error":"catalog_dependencies_exist"}`+"\n" {
		t.Fatalf("deleting a school with a club = %s", body)
	}
}
