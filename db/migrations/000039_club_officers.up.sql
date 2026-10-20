-- Club owners and editors (docs/01-product.md, Clubs). An owner invites
-- editors by email and hands the club to another member, which takes effect
-- only when that member accepts.

-- Invitations to edit a club, sent by an owner. Like event organizer invites,
-- the link works once, expires, and only for a signed-in account with that
-- address; only the token's hash is stored. Inviting an address again
-- revokes its pending invite.
CREATE TABLE club_editor_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX club_editor_invites_pending_email_key
    ON club_editor_invites (club_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX club_editor_invites_invited_by_idx ON club_editor_invites (invited_by_user_id);
CREATE INDEX club_editor_invites_accepted_by_idx ON club_editor_invites (accepted_by_user_id);

CREATE TRIGGER club_editor_invites_set_updated_at
    BEFORE UPDATE ON club_editor_invites
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An owner's offer to hand the club to another member. A club has at most one
-- offer at a time; nothing changes until the recipient accepts.
CREATE TABLE club_ownership_offers (
    club_id UUID PRIMARY KEY REFERENCES clubs (id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES users (id),
    to_user_id UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_user_id <> to_user_id)
);

CREATE INDEX club_ownership_offers_from_idx ON club_ownership_offers (from_user_id);
CREATE INDEX club_ownership_offers_to_idx ON club_ownership_offers (to_user_id);

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN (
    'account_verification',
    'password_reset',
    'event_rsvp_confirmation',
    'event_cancellation',
    'email_change_verification',
    'email_changed_notice',
    'event_organizer_invite',
    'team_member_joined',
    'team_ownership_transferred',
    'club_claim_approved',
    'club_claim_rejected',
    'club_editor_invite',
    'club_ownership_offered'
));
