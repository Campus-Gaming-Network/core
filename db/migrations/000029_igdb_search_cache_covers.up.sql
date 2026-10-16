-- Let the site serve the covers of IGDB search results.
--
-- The game picker shows a small cover beside each IGDB result, proxied
-- through the site so no page loads an image from IGDB. The API serves only
-- image IDs that a cached search returned, and this index makes that check a
-- lookup instead of a scan of every cached result.
CREATE INDEX igdb_search_cache_results_idx ON igdb_search_cache
    USING GIN (results jsonb_path_ops);
