-- A tournament's matches (docs/01-product.md, Tournaments). Single
-- elimination uses the upper bracket only; double elimination will add the
-- lower bracket, the grand final, and where a loser drops. An entrant slot is
-- empty until an earlier match decides it; a bye advances its entrant without
-- a match, so no row has a bye. The winner moves to next_match_id, in slot
-- next_slot.
CREATE TABLE tournament_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    bracket TEXT NOT NULL DEFAULT 'upper' CHECK (bracket IN ('upper', 'lower', 'grand_final')),
    round INTEGER NOT NULL CHECK (round >= 1),
    position INTEGER NOT NULL CHECK (position >= 1),
    entry1_id UUID REFERENCES tournament_entries (id),
    entry2_id UUID REFERENCES tournament_entries (id),
    next_match_id UUID REFERENCES tournament_matches (id) ON DELETE CASCADE,
    next_slot SMALLINT CHECK (next_slot IN (1, 2)),
    scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'complete')),
    score1 INTEGER CHECK (score1 >= 0),
    score2 INTEGER CHECK (score2 >= 0),
    winner_entry_id UUID REFERENCES tournament_entries (id),
    walkover BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tournament_matches_place UNIQUE (tournament_id, bracket, round, position),
    CONSTRAINT tournament_matches_next CHECK ((next_match_id IS NULL) = (next_slot IS NULL))
);

-- Lead with the foreign keys (TestSchemaInvariants); tournament_id leads the
-- place constraint.
CREATE INDEX tournament_matches_entry1_id_idx ON tournament_matches (entry1_id);
CREATE INDEX tournament_matches_entry2_id_idx ON tournament_matches (entry2_id);
CREATE INDEX tournament_matches_next_match_id_idx ON tournament_matches (next_match_id);
CREATE INDEX tournament_matches_winner_entry_id_idx ON tournament_matches (winner_entry_id);

CREATE TRIGGER tournament_matches_set_updated_at
    BEFORE UPDATE ON tournament_matches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
