-- Phase 2: events foundation.
-- Creates the event catalog, organizer, RSVP, interest, and private-unlock
-- tables. Create/edit/RSVP behavior is wired in later Phase 2 slices.

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id UUID NOT NULL REFERENCES users (id),
    host_school_id UUID NOT NULL REFERENCES schools (id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL
        CHECK (visibility IN ('public', 'unlisted', 'private')),
    format TEXT NOT NULL
        CHECK (format IN ('online', 'in_person', 'hybrid')),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    location_name TEXT,
    address TEXT,
    online_url TEXT,
    private_password_hash TEXT,
    capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,
    payment_note TEXT,
    payment_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CHECK (ends_at > starts_at),
    CHECK (
        (visibility = 'private' AND private_password_hash IS NOT NULL)
        OR (visibility <> 'private' AND private_password_hash IS NULL)
    )
);

CREATE INDEX events_public_browse_idx
    ON events (starts_at, id)
    WHERE deleted_at IS NULL AND visibility = 'public';

CREATE INDEX events_host_school_idx
    ON events (host_school_id, starts_at)
    WHERE deleted_at IS NULL;

CREATE INDEX events_title_trgm_idx
    ON events USING GIN (title gin_trgm_ops)
    WHERE deleted_at IS NULL AND visibility = 'public';

CREATE TABLE event_games (
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, game_id)
);

CREATE INDEX event_games_game_idx ON event_games (game_id, event_id);

CREATE TABLE event_organizers (
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'organizer'
        CHECK (role IN ('creator', 'organizer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX event_organizers_user_idx
    ON event_organizers (user_id)
    WHERE deleted_at IS NULL;

CREATE TABLE event_rsvps (
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    response TEXT NOT NULL CHECK (response IN ('yes', 'no', 'maybe')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX event_rsvps_yes_count_idx
    ON event_rsvps (event_id)
    WHERE response = 'yes' AND deleted_at IS NULL;

CREATE INDEX event_rsvps_user_idx
    ON event_rsvps (user_id, updated_at)
    WHERE deleted_at IS NULL;

CREATE TABLE event_interests (
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX event_interests_user_idx
    ON event_interests (user_id, created_at)
    WHERE deleted_at IS NULL;

CREATE TABLE event_private_unlocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX event_private_unlocks_event_idx
    ON event_private_unlocks (event_id, expires_at)
    WHERE deleted_at IS NULL;

CREATE TRIGGER events_set_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER event_organizers_set_updated_at
    BEFORE UPDATE ON event_organizers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER event_rsvps_set_updated_at
    BEFORE UPDATE ON event_rsvps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER event_interests_set_updated_at
    BEFORE UPDATE ON event_interests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER event_private_unlocks_set_updated_at
    BEFORE UPDATE ON event_private_unlocks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
