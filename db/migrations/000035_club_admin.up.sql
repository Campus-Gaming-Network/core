-- A club's earlier slugs, so a link to a renamed club still reaches it. A
-- slug lives in clubs.slug or here, never both: when a club takes a slug back
-- or another club takes it, the redirect row goes.
CREATE TABLE club_slug_redirects (
    old_slug TEXT PRIMARY KEY,
    club_id UUID NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX club_slug_redirects_club_idx ON club_slug_redirects (club_id);
