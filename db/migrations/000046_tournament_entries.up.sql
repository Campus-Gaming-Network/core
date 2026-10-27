-- Tournament registration (docs/01-product.md, Tournaments). An entry is a
-- solo player or a team; one row per entrant per tournament, so a withdrawn
-- entrant registering again reuses its row and a removed one stays removed.
CREATE TABLE tournament_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    user_id UUID REFERENCES users (id),
    team_id UUID REFERENCES teams (id),
    registered_by_user_id UUID NOT NULL REFERENCES users (id),
    status TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered', 'withdrawn', 'removed')),
    -- Set by organizers; registration order until then.
    seed INTEGER CHECK (seed >= 1),
    -- When the entry last registered, the default seed order.
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tournament_entries_one_entrant CHECK ((user_id IS NULL) <> (team_id IS NULL))
);

CREATE UNIQUE INDEX tournament_entries_user_idx
    ON tournament_entries (tournament_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX tournament_entries_team_idx
    ON tournament_entries (tournament_id, team_id) WHERE team_id IS NOT NULL;
CREATE INDEX tournament_entries_tournament_idx
    ON tournament_entries (tournament_id, registered_at);
-- Lead with the foreign keys (TestSchemaInvariants).
CREATE INDEX tournament_entries_user_id_idx ON tournament_entries (user_id);
CREATE INDEX tournament_entries_team_id_idx ON tournament_entries (team_id);
CREATE INDEX tournament_entries_registered_by_idx ON tournament_entries (registered_by_user_id);

CREATE TRIGGER tournament_entries_set_updated_at
    BEFORE UPDATE ON tournament_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The roster of an active team entry. Rows are deleted when the entry is
-- withdrawn or removed, so a person is on at most one roster per tournament.
CREATE TABLE tournament_entry_players (
    entry_id UUID NOT NULL REFERENCES tournament_entries (id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entry_id, user_id),
    CONSTRAINT tournament_entry_players_one_roster UNIQUE (tournament_id, user_id)
);

CREATE INDEX tournament_entry_players_user_id_idx ON tournament_entry_players (user_id);

-- A member who leaves a team, or is removed from it, leaves its rosters for
-- tournaments that have not started. Rosters freeze once a tournament starts.
CREATE FUNCTION tournament_rosters_drop_departed_member() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL) THEN
        RETURN NEW;
    END IF;
    DELETE FROM tournament_entry_players p
    USING tournament_entries e, tournaments t
    WHERE p.entry_id = e.id
      AND t.id = e.tournament_id
      AND e.team_id = OLD.team_id
      AND p.user_id = OLD.user_id
      AND t.status IN ('draft', 'registration_open');
    RETURN NULL;
END;
$$;

CREATE TRIGGER team_members_leave_tournament_rosters
    AFTER UPDATE OF deleted_at OR DELETE ON team_members
    FOR EACH ROW EXECUTE FUNCTION tournament_rosters_drop_departed_member();
