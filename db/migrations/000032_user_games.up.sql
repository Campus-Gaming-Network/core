-- The games a user lists on their profile: favorites, games they like, and
-- games they want to play. A game is in at most one of a user's lists, and
-- each list is ordered by position from 0. Moving a game between lists or
-- within one rewrites positions in a transaction, so the unique position is
-- checked when the transaction commits.
CREATE TABLE user_games (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games (id),
    list TEXT NOT NULL CHECK (list IN ('favorite', 'like', 'want_to_play')),
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, game_id),
    CONSTRAINT user_games_list_position_key UNIQUE (user_id, list, position) DEFERRABLE INITIALLY DEFERRED,
    -- Favorites are capped at five. With unique positions from 0, this check
    -- is the cap.
    CONSTRAINT user_games_favorite_cap CHECK (list <> 'favorite' OR position < 5)
);

-- Leads with the foreign key (TestSchemaInvariants).
CREATE INDEX user_games_game_idx ON user_games (game_id, user_id);

CREATE TRIGGER user_games_catalog_reference BEFORE INSERT OR UPDATE OF game_id ON user_games
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('game', 'game_id');
