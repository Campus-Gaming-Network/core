-- The team that hosts an event, when a team does. An event with no team is
-- run by its organizer alone. The team stays on the event when the organizer
-- later leaves the team or loses the captain role; the API checks the role
-- only when an organizer picks a team. Existing events have no team.
ALTER TABLE events ADD COLUMN host_team_id UUID REFERENCES teams (id);

-- Leads with the foreign key (TestSchemaInvariants) and serves a team page's
-- list of upcoming events.
CREATE INDEX events_host_team_id_idx
    ON events (host_team_id, starts_at);
