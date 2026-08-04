package schools

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// DefaultRefreshInterval is how often the cached catalog reloads when no
// explicit interval is configured.
const DefaultRefreshInterval = 15 * time.Minute

// CachedRepository serves the school catalog from memory.
//
// The catalog is effectively static — 6,243 rows expected to grow by one or two
// a year — and the whole thing is about 1.4 MB, so keeping it in the process
// removes a Postgres round trip from every browse, search, and detail read. On
// Railway that round trip crosses a service boundary, so it costs more in
// production than it does locally.
//
// Reads never touch the database. The snapshot is replaced wholesale on
// refresh, so readers always see an internally consistent catalog.
type CachedRepository struct {
	source Repository
	logger *slog.Logger

	mu       sync.RWMutex
	snapshot *snapshot
}

type snapshot struct {
	ordered  []School
	byID     map[string]School
	bySlug   map[string]School
	loadedAt time.Time
}

// NewCachedRepository wraps source. The cache starts empty; call Refresh before
// serving, or let Start do the first load.
func NewCachedRepository(source Repository, logger *slog.Logger) *CachedRepository {
	if logger == nil {
		logger = slog.Default()
	}
	return &CachedRepository{source: source, logger: logger}
}

// Refresh reloads the catalog and atomically swaps it in. On failure the
// previous snapshot is left in place, so a database blip degrades to stale data
// rather than an empty catalog.
func (c *CachedRepository) Refresh(ctx context.Context) error {
	// Page through the source rather than assuming a single unbounded read,
	// since List caps the limit it will honor.
	const page = 100

	var all []School
	for offset := 0; ; offset += page {
		batch, err := c.source.List(ctx, ListParams{Limit: page, Offset: offset})
		if err != nil {
			return fmt.Errorf("refresh school catalog: %w", err)
		}
		all = append(all, batch...)
		if len(batch) < page {
			break
		}
	}

	next := &snapshot{
		ordered:  all,
		byID:     make(map[string]School, len(all)),
		bySlug:   make(map[string]School, len(all)),
		loadedAt: time.Now(),
	}
	for _, school := range all {
		next.byID[school.ID] = school
		next.bySlug[school.Slug] = school
	}

	c.mu.Lock()
	c.snapshot = next
	c.mu.Unlock()

	c.logger.Info("school catalog cached", "schools", len(all))
	return nil
}

// Start performs the first load and then refreshes on every tick until ctx is
// cancelled. It blocks, so callers should run it in its own goroutine.
func (c *CachedRepository) Start(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultRefreshInterval
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		if err := c.Refresh(ctx); err != nil {
			c.logger.Error("school catalog refresh failed", "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Loaded reports whether a snapshot is available.
func (c *CachedRepository) Loaded() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshot != nil
}

func (c *CachedRepository) current() *snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshot
}

// List filters, sorts, and pages the cached catalog. The result matches what the
// SQL query returns: a case-insensitive substring match on name or alias, an
// exact state match, ordered by name, city, id.
func (c *CachedRepository) List(ctx context.Context, params ListParams) ([]School, error) {
	current := c.current()
	if current == nil {
		return c.source.List(ctx, params)
	}
	params = NormalizeListParams(params)

	query := strings.ToLower(params.Query)
	matches := make([]School, 0, params.Limit)
	skipped := 0

	for _, school := range current.ordered {
		if params.State != "" && school.State != params.State {
			continue
		}
		if query != "" && !matchesQuery(school, query) {
			continue
		}
		if skipped < params.Offset {
			skipped++
			continue
		}
		matches = append(matches, school)
		if len(matches) == params.Limit {
			break
		}
	}

	return matches, nil
}

func matchesQuery(school School, lowerQuery string) bool {
	return strings.Contains(strings.ToLower(school.Name), lowerQuery) ||
		strings.Contains(strings.ToLower(school.Alias), lowerQuery)
}

func (c *CachedRepository) GetByID(ctx context.Context, id string) (School, error) {
	current := c.current()
	if current == nil {
		return c.source.GetByID(ctx, id)
	}
	school, ok := current.byID[id]
	if !ok {
		return School{}, ErrSchoolNotFound
	}
	return school, nil
}

func (c *CachedRepository) GetBySlug(ctx context.Context, slug string) (School, error) {
	current := c.current()
	if current == nil {
		return c.source.GetBySlug(ctx, slug)
	}
	school, ok := current.bySlug[strings.TrimSpace(slug)]
	if !ok {
		return School{}, ErrSchoolNotFound
	}
	return school, nil
}

func (c *CachedRepository) ExistsActive(ctx context.Context, id string) (bool, error) {
	current := c.current()
	if current == nil {
		return c.source.ExistsActive(ctx, id)
	}
	_, ok := current.byID[id]
	return ok, nil
}
