-- Phase 3.5: school role indicators.
-- Admin grants are scoped to a school and can be revoked without deleting
-- the historical relationship.

CREATE TABLE school_admins (
    school_id UUID NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (school_id, user_id)
);

CREATE INDEX school_admins_user_idx
    ON school_admins (user_id, school_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER school_admins_set_updated_at
    BEFORE UPDATE ON school_admins
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
