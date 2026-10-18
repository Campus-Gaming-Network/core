-- Clubs: student clubs and university esports programs, each under one
-- school (docs/01-product.md, Clubs). This adds the public record only;
-- creating and editing clubs, claims, roles, and members come later.

CREATE TABLE clubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools (id),
    name TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) BETWEEN 1 AND 120),
    slug TEXT NOT NULL UNIQUE,
    -- Neither type implies that the university endorses the club.
    type TEXT NOT NULL CHECK (type IN ('student_club', 'university_program')),
    summary TEXT NOT NULL DEFAULT '' CHECK (LENGTH(summary) <= 2000),
    -- The club's own process for becoming a member. Empty means the club has
    -- not said, and the page claims no process.
    how_to_join TEXT NOT NULL DEFAULT '' CHECK (LENGTH(how_to_join) <= 2000),
    -- A hidden club is absent everywhere and its page is a 404.
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
    -- When the details were last confirmed, and by whom: the club, or CGN
    -- checking the public source.
    confirmed_at TIMESTAMPTZ,
    confirmed_source TEXT CHECK (confirmed_source IN ('club', 'cgn')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CHECK ((confirmed_at IS NULL) = (confirmed_source IS NULL))
);

-- A school page lists its clubs by name; it also leads with the foreign key
-- (TestSchemaInvariants).
CREATE INDEX clubs_school_idx ON clubs (school_id, name);

CREATE TABLE club_games (
    club_id UUID NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (club_id, game_id)
);

CREATE INDEX club_games_game_idx ON club_games (game_id, club_id);

-- Labeled outbound links. They are information; none is the way to join.
CREATE TABLE club_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('website', 'discord', 'social')),
    label TEXT NOT NULL CHECK (LENGTH(BTRIM(label)) BETWEEN 1 AND 60),
    url TEXT NOT NULL CHECK (url ~* '^https?://' AND LENGTH(url) <= 500),
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX club_links_club_idx ON club_links (club_id, position);

CREATE TRIGGER clubs_set_updated_at
    BEFORE UPDATE ON clubs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER club_links_set_updated_at
    BEFORE UPDATE ON club_links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
