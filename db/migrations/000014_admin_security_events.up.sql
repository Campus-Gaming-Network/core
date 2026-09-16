-- Durable, append-oriented security telemetry for the Admin Console. This is
-- deliberately separate from domain audit history: it records authentication,
-- authorization, session, sensitive-read, and break-glass events without
-- copying request bodies or credentials.

ALTER TABLE audit_logs
    ADD COLUMN admin_session_id UUID
        REFERENCES admin_sessions (id) ON DELETE SET NULL,
    ADD COLUMN request_id TEXT
        CHECK (request_id IS NULL OR LENGTH(BTRIM(request_id)) BETWEEN 1 AND 128);

CREATE INDEX audit_logs_admin_session_history_idx
    ON audit_logs (admin_session_id, created_at DESC, id DESC)
    WHERE admin_session_id IS NOT NULL;

CREATE INDEX audit_logs_request_history_idx
    ON audit_logs (request_id, created_at DESC, id DESC)
    WHERE request_id IS NOT NULL;

CREATE TABLE admin_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL
        CHECK (
            LENGTH(event_type) BETWEEN 3 AND 120
            AND event_type ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$'
        ),
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'denied', 'error')),
    actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    admin_session_id UUID REFERENCES admin_sessions (id) ON DELETE SET NULL,
    request_id TEXT
        CHECK (request_id IS NULL OR LENGTH(BTRIM(request_id)) BETWEEN 1 AND 128),
    -- Store only an HMAC/SHA-256-style privacy-reviewed network identifier,
    -- never a raw address. The Go writer accepts exactly 32 bytes.
    network_identifier_hash BYTEA
        CHECK (network_identifier_hash IS NULL OR OCTET_LENGTH(network_identifier_hash) = 32),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (JSONB_TYPEOF(metadata) = 'object')
        CHECK (OCTET_LENGTH(metadata::text) <= 4096),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_security_events_type_history_idx
    ON admin_security_events (event_type, occurred_at DESC, id DESC);

CREATE INDEX admin_security_events_actor_history_idx
    ON admin_security_events (actor_user_id, occurred_at DESC, id DESC)
    WHERE actor_user_id IS NOT NULL;

CREATE INDEX admin_security_events_session_history_idx
    ON admin_security_events (admin_session_id, occurred_at DESC, id DESC)
    WHERE admin_session_id IS NOT NULL;

-- Production must run migrations as a distinct owner and grant the API runtime
-- only SELECT/INSERT. Revoking PUBLIC prevents accidentally broad grants from
-- supplying mutation privileges; deployment verification still checks the
-- concrete runtime role because table owners bypass ordinary grants.
REVOKE UPDATE, DELETE, TRUNCATE ON admin_security_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
