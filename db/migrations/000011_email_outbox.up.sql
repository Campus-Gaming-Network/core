-- Durable email delivery intent. Domain transactions insert one row per
-- recipient; workers lease rows with SKIP LOCKED and retry independently.
CREATE TABLE email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN (
        'account_verification',
        'password_reset',
        'event_rsvp_confirmation',
        'event_cancellation'
    )),
    recipient TEXT NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    provider_message_id TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((locked_at IS NULL) = (locked_by IS NULL)),
    CHECK (NOT (delivered_at IS NOT NULL AND failed_at IS NOT NULL))
);

CREATE INDEX email_outbox_ready_idx
    ON email_outbox (next_attempt_at, created_at, id)
    WHERE delivered_at IS NULL AND failed_at IS NULL;

CREATE INDEX email_outbox_failure_idx
    ON email_outbox (failed_at)
    WHERE failed_at IS NOT NULL;

CREATE TRIGGER email_outbox_set_updated_at
    BEFORE UPDATE ON email_outbox
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
