-- A signed-in person's request to change their email. The new address takes
-- effect only when the link sent to it is followed: the token is single-use,
-- expires, and a newer request retires older ones. new_email is checked again
-- when the link is used, since another account may have taken it meanwhile.
CREATE TABLE email_change_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    new_email CITEXT NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX email_change_tokens_user_idx
    ON email_change_tokens (user_id, created_at DESC);

CREATE TRIGGER email_change_tokens_set_updated_at
    BEFORE UPDATE ON email_change_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The link to confirm a new address, and the notice to the old one after it
-- changes.
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN (
    'account_verification',
    'password_reset',
    'event_rsvp_confirmation',
    'event_cancellation',
    'email_change_verification',
    'email_changed_notice'
));
