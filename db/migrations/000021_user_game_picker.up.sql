-- Users can add a game the catalog does not hold yet, by IGDB search or by
-- typing its name.

-- A typed game is unlisted: it stays out of the public picker but may be
-- attached to events and teams. A site admin can list it or delete it.
ALTER TABLE games ADD COLUMN user_submitted BOOLEAN NOT NULL DEFAULT FALSE;

-- IGDB search results, kept so a repeated search does not call IGDB.
CREATE TABLE igdb_search_cache (
    query TEXT PRIMARY KEY,
    results JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
