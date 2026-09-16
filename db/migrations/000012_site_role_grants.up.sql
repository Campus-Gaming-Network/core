-- Site-wide role grants for the Admin Console. Grants are append-only history:
-- revocation closes a grant instead of deleting it, and user references are
-- deliberately restrictive so account cleanup cannot erase provenance.

CREATE TABLE site_role_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('site_admin')),
    -- NULL is reserved for the one-time BootstrapSiteAdmin path. Normal grants
    -- always store the active site administrator who authorized the change.
    granted_by_user_id UUID REFERENCES users (id) ON DELETE RESTRICT,
    grant_reason TEXT NOT NULL
        CHECK (LENGTH(BTRIM(grant_reason)) BETWEEN 1 AND 1000),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by_user_id UUID REFERENCES users (id) ON DELETE RESTRICT,
    revoke_reason TEXT,
    UNIQUE (id, user_id),
    CHECK (
        (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL)
        OR
        (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL
            AND LENGTH(BTRIM(revoke_reason)) BETWEEN 1 AND 1000)
    ),
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- A user may be granted the same role again after a prior grant is revoked,
-- but can have only one active instance of it at a time.
CREATE UNIQUE INDEX site_role_grants_one_active_idx
    ON site_role_grants (user_id, role)
    WHERE revoked_at IS NULL;

CREATE INDEX site_role_grants_user_history_idx
    ON site_role_grants (user_id, role, granted_at DESC, id DESC);

CREATE INDEX site_role_grants_active_role_idx
    ON site_role_grants (role, user_id)
    WHERE revoked_at IS NULL;
