package events

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/dbtest"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
)

func TestPostgresRepositorySearchesByTitleAndLocalDate(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewSchemaPool(t, "events")
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}
	var schoolID, userID string
	schoolID = dbtest.InsertSchool(t, pool, "Search School", "search-school")
	userID = dbtest.InsertUser(t, pool, schoolID, "search@example.test", "Searcher")

	repository := NewPostgresRepository(pool)
	repository.now = func() time.Time { return time.Date(2031, time.April, 1, 0, 0, 0, 0, time.UTC) }
	losAngeles, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	create := func(title string, visibility string, startsAt time.Time) {
		t.Helper()
		input := CreateInput{
			Title:         title,
			CreatorUserID: userID,
			HostSchoolID:  schoolID,
			Visibility:    visibility,
			Format:        FormatOnline,
			Audience:      AudienceOpen,
			EventType:     EventTypeGameNight,
			StartsAt:      startsAt,
			EndsAt:        startsAt.Add(time.Hour),
			Timezone:      startsAt.Location().String(),
		}
		params := CreateParams{CreateInput: input}
		if visibility == VisibilityPrivate {
			params.PrivatePasswordHash = "hash"
			params.PrivatePassword = "password1"
		}
		if _, err := repository.Create(ctx, params); err != nil {
			t.Fatalf("Create(%s) error = %v", title, err)
		}
	}
	// 11:30 PM on May 1 in Los Angeles is already May 2 in UTC.
	create("Smash Bros Night", VisibilityPublic, time.Date(2031, time.May, 1, 23, 30, 0, 0, losAngeles))
	create("SMASH Ultimate Bracket", VisibilityPublic, time.Date(2031, time.May, 3, 18, 0, 0, 0, losAngeles))
	create("Valorant 100% Scrims", VisibilityPublic, time.Date(2031, time.May, 4, 18, 0, 0, 0, losAngeles))
	create("Smash Unlisted Meetup", VisibilityUnlisted, time.Date(2031, time.May, 2, 18, 0, 0, 0, losAngeles))
	create("Smash Private Practice", VisibilityPrivate, time.Date(2031, time.May, 2, 19, 0, 0, 0, losAngeles))

	titles := func(params ListParams) []string {
		t.Helper()
		events, err := repository.ListPublic(ctx, params)
		if err != nil {
			t.Fatalf("ListPublic(%+v) error = %v", params, err)
		}
		got := []string{}
		for _, event := range events {
			got = append(got, event.Title)
		}
		return got
	}

	got := map[string][]string{
		"keyword, any case":       titles(ListParams{Query: "smash"}),
		"keyword, extra spaces":   titles(ListParams{Query: "  smash   ultimate "}),
		"percent is literal":      titles(ListParams{Query: "100%"}),
		"underscore is literal":   titles(ListParams{Query: "smash_"}),
		"local date May 1":        titles(ListParams{FromDate: "2031-05-01", ToDate: "2031-05-01"}),
		"from May 2":              titles(ListParams{FromDate: "2031-05-02"}),
		"to May 3, with keyword":  titles(ListParams{Query: "smash", ToDate: "2031-05-03"}),
		"keyword and other range": titles(ListParams{Query: "valorant", FromDate: "2031-05-01", ToDate: "2031-05-03"}),
	}
	want := map[string][]string{
		"keyword, any case":       {"Smash Bros Night", "SMASH Ultimate Bracket"},
		"keyword, extra spaces":   {"SMASH Ultimate Bracket"},
		"percent is literal":      {"Valorant 100% Scrims"},
		"underscore is literal":   {},
		"local date May 1":        {"Smash Bros Night"},
		"from May 2":              {"SMASH Ultimate Bracket", "Valorant 100% Scrims"},
		"to May 3, with keyword":  {"Smash Bros Night", "SMASH Ultimate Bracket"},
		"keyword and other range": {},
	}
	for name := range want {
		if !reflect.DeepEqual(got[name], want[name]) {
			t.Errorf("%s = %v, want %v", name, got[name], want[name])
		}
	}

	first, err := repository.ListPublic(ctx, NormalizeListParams(ListParams{Query: "smash", Limit: 1}))
	if err != nil || len(first) != 1 {
		t.Fatalf("first page = %d events, %v", len(first), err)
	}
	second := titles(NormalizeListParams(ListParams{
		Query: "smash",
		Limit: 1,
		After: &pagecursor.Cursor{Timestamp: first[0].StartsAt, ID: first[0].ID},
	}))
	if !reflect.DeepEqual(second, []string{"SMASH Ultimate Bracket"}) {
		t.Fatalf("second page = %v, want the second match", second)
	}
}
