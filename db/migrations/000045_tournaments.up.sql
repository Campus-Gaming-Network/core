-- Tournament settings and status on a tournament-type event
-- (docs/01-product.md, Tournaments). An event has at most one tournament, and
-- everything an event already has stays on the event. The API keeps game_id
-- one of the event's games and the event's type `tournament` while the row
-- exists. Text limits match the Go validator, which counts bytes.
CREATE TABLE tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE REFERENCES events (id),
    game_id UUID NOT NULL REFERENCES games (id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('solo', 'team')),
    team_size INTEGER CHECK (team_size BETWEEN 2 AND 20),
    substitutes INTEGER NOT NULL DEFAULT 0 CHECK (substitutes >= 0),
    entrant_cap INTEGER CHECK (entrant_cap BETWEEN 2 AND 512),
    -- NULL closes registration at the event's start.
    registration_closes_at TIMESTAMPTZ,
    format TEXT NOT NULL CHECK (format IN ('single_elimination', 'round_robin', 'swiss', 'double_elimination')),
    rules TEXT NOT NULL DEFAULT '' CHECK (char_length(rules) <= 10000),
    prizes TEXT NOT NULL DEFAULT '' CHECK (char_length(prizes) <= 2000),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'registration_open', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A team size and substitutes belong to team entry only, and a roster
    -- has at most twice the team size.
    CONSTRAINT tournaments_team_fields CHECK (
        (entry_type = 'solo' AND team_size IS NULL AND substitutes = 0)
        OR (entry_type = 'team' AND team_size IS NOT NULL AND substitutes <= team_size)
    )
);

-- Leads with the foreign key (TestSchemaInvariants); event_id's unique
-- constraint already leads with it.
CREATE INDEX tournaments_game_id_idx ON tournaments (game_id);

CREATE TRIGGER tournaments_set_updated_at
    BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
