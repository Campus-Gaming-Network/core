-- Admin Console sessions are deliberately isolated from public-site sessions.
-- A session is bound to the exact site-role grant that created it so revoking
-- and later re-granting access can never reactivate an older credential.

CREATE TABLE admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    grant_id UUID NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE CHECK (OCTET_LENGTH(token_hash) = 32),
    csrf_token_hash BYTEA NOT NULL CHECK (OCTET_LENGTH(csrf_token_hash) = 32),
    authn_method TEXT NOT NULL
        CHECK (authn_method IN ('cloudflare_access')),
    access_issuer TEXT NOT NULL
        CHECK (LENGTH(BTRIM(access_issuer)) BETWEEN 1 AND 500),
    access_subject TEXT NOT NULL
        CHECK (LENGTH(BTRIM(access_subject)) BETWEEN 1 AND 320),
    access_email CITEXT NOT NULL
        CHECK (LENGTH(BTRIM(access_email::text)) BETWEEN 3 AND 320),
    authenticated_at TIMESTAMPTZ NOT NULL,
    step_up_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (grant_id, user_id)
        REFERENCES site_role_grants (id, user_id) ON DELETE RESTRICT,
    CHECK (idle_expires_at <= absolute_expires_at),
    CHECK (idle_expires_at > last_seen_at),
    CHECK (authenticated_at <= last_seen_at),
    CHECK (step_up_at IS NULL OR step_up_at >= authenticated_at),
    CHECK (step_up_at IS NULL OR step_up_at <= last_seen_at),
    CHECK (absolute_expires_at > created_at),
    CHECK (
        (revoked_at IS NULL AND revocation_reason IS NULL)
        OR
        (revoked_at IS NOT NULL AND LENGTH(BTRIM(revocation_reason)) BETWEEN 1 AND 500)
    )
);

CREATE INDEX admin_sessions_user_active_idx
    ON admin_sessions (user_id, absolute_expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX admin_sessions_grant_active_idx
    ON admin_sessions (grant_id, absolute_expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX admin_sessions_expiry_idx
    ON admin_sessions (LEAST(idle_expires_at, absolute_expires_at))
    WHERE revoked_at IS NULL;
