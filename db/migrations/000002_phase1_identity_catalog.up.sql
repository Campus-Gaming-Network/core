-- Phase 1A: auth, profiles, schools, follows, and curated games foundation.
-- Events, teams, reports, support, notifications, and CRM/admin workflows are
-- intentionally deferred to the phases that own them.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unitid BIGINT UNIQUE,
    name TEXT NOT NULL,
    alias TEXT,
    slug TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    website_url TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_main_campus BOOLEAN NOT NULL DEFAULT TRUE,
    num_branches INTEGER NOT NULL DEFAULT 0 CHECK (num_branches >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX schools_active_name_trgm_idx
    ON schools USING GIN (name gin_trgm_ops)
    WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE INDEX schools_active_alias_trgm_idx
    ON schools USING GIN (alias gin_trgm_ops)
    WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE INDEX schools_active_state_idx
    ON schools (state, name)
    WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    igdb_id BIGINT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    cover_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email_verified_at TIMESTAMPTZ,
    verification_level TEXT NOT NULL DEFAULT 'basic'
        CHECK (verification_level IN ('basic', 'verified', 'staff_faculty')),
    name TEXT NOT NULL,
    bio TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    home_school_id UUID NOT NULL REFERENCES schools (id),
    age_confirmed_at TIMESTAMPTZ NOT NULL,
    account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX users_home_school_idx ON users (home_school_id)
    WHERE deleted_at IS NULL;

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id)
    WHERE revoked_at IS NULL AND deleted_at IS NULL;
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at)
    WHERE revoked_at IS NULL AND deleted_at IS NULL;

CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX email_verification_tokens_user_idx
    ON email_verification_tokens (user_id, expires_at)
    WHERE consumed_at IS NULL AND deleted_at IS NULL;

CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX password_reset_tokens_user_idx
    ON password_reset_tokens (user_id, expires_at)
    WHERE consumed_at IS NULL AND deleted_at IS NULL;

CREATE TABLE user_social_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX user_social_links_user_idx ON user_social_links (user_id, sort_order)
    WHERE deleted_at IS NULL;

CREATE TABLE user_school_follows (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, school_id)
);

CREATE INDEX user_school_follows_school_idx ON user_school_follows (school_id)
    WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER schools_set_updated_at
    BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER games_set_updated_at
    BEFORE UPDATE ON games
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER auth_sessions_set_updated_at
    BEFORE UPDATE ON auth_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER email_verification_tokens_set_updated_at
    BEFORE UPDATE ON email_verification_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER password_reset_tokens_set_updated_at
    BEFORE UPDATE ON password_reset_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_social_links_set_updated_at
    BEFORE UPDATE ON user_social_links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_school_follows_set_updated_at
    BEFORE UPDATE ON user_school_follows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
