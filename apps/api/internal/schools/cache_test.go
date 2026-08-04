package schools

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

type stubRepository struct {
	all       []School
	listCalls int
	err       error
}

func (s *stubRepository) List(_ context.Context, params ListParams) ([]School, error) {
	s.listCalls++
	if s.err != nil {
		return nil, s.err
	}
	params = NormalizeListParams(params)
	if params.Offset >= len(s.all) {
		return nil, nil
	}
	end := min(params.Offset+params.Limit, len(s.all))
	return s.all[params.Offset:end], nil
}

func (s *stubRepository) GetByID(context.Context, string) (School, error) {
	return School{}, ErrSchoolNotFound
}
func (s *stubRepository) GetBySlug(context.Context, string) (School, error) {
	return School{}, ErrSchoolNotFound
}
func (s *stubRepository) ExistsActive(context.Context, string) (bool, error) {
	return false, nil
}

func testCatalog(count int) []School {
	all := make([]School, 0, count)
	for i := 0; i < count; i++ {
		all = append(all, School{
			ID:    fmt.Sprintf("id-%04d", i),
			Name:  fmt.Sprintf("University %04d", i),
			Slug:  fmt.Sprintf("university-%04d", i),
			State: []string{"CA", "NY", "TX"}[i%3],
			City:  "Somewhere",
		})
	}
	return all
}

func loadedCache(t *testing.T, all []School) (*CachedRepository, *stubRepository) {
	t.Helper()
	source := &stubRepository{all: all}
	cache := NewCachedRepository(source, nil)
	if err := cache.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh() error = %v", err)
	}
	return cache, source
}

func TestCacheServesReadsWithoutTouchingSource(t *testing.T) {
	cache, source := loadedCache(t, testCatalog(250))
	callsAfterLoad := source.listCalls

	for i := 0; i < 20; i++ {
		if _, err := cache.List(context.Background(), ListParams{Limit: 25}); err != nil {
			t.Fatalf("List() error = %v", err)
		}
		if _, err := cache.GetBySlug(context.Background(), "university-0007"); err != nil {
			t.Fatalf("GetBySlug() error = %v", err)
		}
	}

	if source.listCalls != callsAfterLoad {
		t.Fatalf("source was queried %d extra times, want 0", source.listCalls-callsAfterLoad)
	}
}

func TestCacheRefreshPagesThroughTheWholeCatalog(t *testing.T) {
	// 250 rows against a 100-row page cap means the loader must paginate.
	cache, _ := loadedCache(t, testCatalog(250))

	found, err := cache.List(context.Background(), ListParams{Limit: 100, Offset: 200})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(found) != 50 {
		t.Fatalf("got %d rows past offset 200, want 50 — catalog was truncated", len(found))
	}
	if _, err := cache.GetBySlug(context.Background(), "university-0249"); err != nil {
		t.Fatalf("last school missing from cache: %v", err)
	}
}

// The in-memory filter has to reproduce the SQL: case-insensitive substring on
// name or alias, exact state match, ordered by name, city, id.
func TestCacheMatchesSQLFilterSemantics(t *testing.T) {
	cache, _ := loadedCache(t, []School{
		{ID: "1", Name: "Alpha State University", Slug: "alpha", State: "CA", City: "A"},
		{ID: "2", Name: "Beta College", Alias: "STATE Tech", Slug: "beta", State: "NY", City: "B"},
		{ID: "3", Name: "Gamma Institute", Slug: "gamma", State: "CA", City: "C"},
	})

	byName, _ := cache.List(context.Background(), ListParams{Query: "state"})
	if len(byName) != 2 {
		t.Fatalf("query matched %d schools, want 2 (name and alias)", len(byName))
	}

	mixedCase, _ := cache.List(context.Background(), ListParams{Query: "StAtE"})
	if len(mixedCase) != 2 {
		t.Fatalf("query is case sensitive: matched %d, want 2", len(mixedCase))
	}

	byState, _ := cache.List(context.Background(), ListParams{State: "ca"})
	if len(byState) != 2 {
		t.Fatalf("state filter matched %d, want 2 (should be normalized to upper case)", len(byState))
	}

	combined, _ := cache.List(context.Background(), ListParams{Query: "state", State: "CA"})
	if len(combined) != 1 || combined[0].ID != "1" {
		t.Fatalf("combined filters returned %+v, want only Alpha", combined)
	}
}

func TestCachePagesResults(t *testing.T) {
	cache, _ := loadedCache(t, testCatalog(30))

	first, _ := cache.List(context.Background(), ListParams{Limit: 10})
	second, _ := cache.List(context.Background(), ListParams{Limit: 10, Offset: 10})

	if len(first) != 10 || len(second) != 10 {
		t.Fatalf("page sizes = %d and %d, want 10 and 10", len(first), len(second))
	}
	if first[0].ID == second[0].ID {
		t.Fatal("offset was ignored; both pages start at the same school")
	}
}

func TestCacheReportsMissesAsNotFound(t *testing.T) {
	cache, _ := loadedCache(t, testCatalog(5))

	if _, err := cache.GetBySlug(context.Background(), "nope"); !errors.Is(err, ErrSchoolNotFound) {
		t.Fatalf("GetBySlug() error = %v, want ErrSchoolNotFound", err)
	}
	if _, err := cache.GetByID(context.Background(), "nope"); !errors.Is(err, ErrSchoolNotFound) {
		t.Fatalf("GetByID() error = %v, want ErrSchoolNotFound", err)
	}
	exists, err := cache.ExistsActive(context.Background(), "id-0001")
	if err != nil || !exists {
		t.Fatalf("ExistsActive() = %v, %v; want true, nil", exists, err)
	}
}

// Before the first load the cache must pass through rather than report an empty
// catalog, so a slow first refresh cannot make every school look missing.
func TestCacheFallsBackToSourceBeforeFirstLoad(t *testing.T) {
	source := &stubRepository{all: testCatalog(5)}
	cache := NewCachedRepository(source, nil)

	if cache.Loaded() {
		t.Fatal("cache reports loaded before any refresh")
	}
	found, err := cache.List(context.Background(), ListParams{Limit: 5})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(found) != 5 {
		t.Fatalf("fallback returned %d rows, want 5", len(found))
	}
}

// A failed refresh must leave the previous catalog in place rather than
// emptying it, so a database blip degrades to stale data.
func TestCacheKeepsPreviousSnapshotWhenRefreshFails(t *testing.T) {
	source := &stubRepository{all: testCatalog(10)}
	cache := NewCachedRepository(source, nil)
	if err := cache.Refresh(context.Background()); err != nil {
		t.Fatalf("first Refresh() error = %v", err)
	}

	source.err = errors.New("database unavailable")
	if err := cache.Refresh(context.Background()); err == nil {
		t.Fatal("Refresh() returned nil despite a source failure")
	}

	found, err := cache.List(context.Background(), ListParams{Limit: 10})
	if err != nil {
		t.Fatalf("List() after failed refresh error = %v", err)
	}
	if len(found) != 10 {
		t.Fatalf("catalog holds %d rows after a failed refresh, want the previous 10", len(found))
	}
}
