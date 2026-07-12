-- Phase 3: teams foundation.
-- Creates public team pages, game associations, and membership roles.

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    school_id UUID REFERENCES schools (id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX teams_public_browse_idx
    ON teams (created_at DESC, id)
    WHERE deleted_at IS NULL;

CREATE INDEX teams_school_idx
    ON teams (school_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE team_games (
    team_id UUID NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, game_id)
);

CREATE INDEX team_games_game_idx ON team_games (game_id, team_id);

CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'captain', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (team_id, user_id)
);

CREATE INDEX team_members_user_idx
    ON team_members (user_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TRIGGER teams_set_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER team_members_set_updated_at
    BEFORE UPDATE ON team_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
