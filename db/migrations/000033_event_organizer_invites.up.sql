-- Invitations to co-organize an event. An event's creator invites by email;
-- the link works once, expires, and only for a signed-in account with that
-- address. Only the token's hash is stored. An invite is pending until it is
-- accepted or revoked; inviting the same address again revokes the older one.
CREATE TABLE event_organizer_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    invited_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    email CITEXT NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX event_organizer_invites_pending_email_key
    ON event_organizer_invites (event_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Lead with each foreign key (TestSchemaInvariants).
CREATE INDEX event_organizer_invites_invited_by_idx
    ON event_organizer_invites (invited_by_user_id);

CREATE INDEX event_organizer_invites_accepted_by_idx
    ON event_organizer_invites (accepted_by_user_id);

CREATE TRIGGER event_organizer_invites_set_updated_at
    BEFORE UPDATE ON event_organizer_invites
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN (
    'account_verification',
    'password_reset',
    'event_rsvp_confirmation',
    'event_cancellation',
    'email_change_verification',
    'email_changed_notice',
    'event_organizer_invite'
));
