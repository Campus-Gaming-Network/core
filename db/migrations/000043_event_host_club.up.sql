-- The club that hosts an event, when a club does (docs/01-product.md,
-- Clubs). Any owner or editor of the club may edit and cancel the event, so
-- it survives officer turnover. The API keeps host_school_id equal to the
-- club's school. An event has at most one hosting team or club.
ALTER TABLE events ADD COLUMN host_club_id UUID REFERENCES clubs (id);

ALTER TABLE events ADD CONSTRAINT events_one_host_group
    CHECK (host_team_id IS NULL OR host_club_id IS NULL);

-- Leads with the foreign key (TestSchemaInvariants) and serves a club page's
-- list of upcoming events.
CREATE INDEX events_host_club_id_idx
    ON events (host_club_id, starts_at);
