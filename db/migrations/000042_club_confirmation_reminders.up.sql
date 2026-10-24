-- Reminders to a claimed club's owners that its details need confirming
-- (docs/01-product.md, Clubs). A club has one row, naming the confirmation
-- it was last reminded about; confirming again starts a new lapse, and the
-- next reminder replaces the row. Outbox rows are deleted after 30 days, so
-- they cannot carry this.

CREATE TABLE club_confirmation_reminders (
    club_id UUID PRIMARY KEY REFERENCES clubs (id) ON DELETE CASCADE,
    confirmed_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    'club_ownership_offered',
    'club_confirmation_due'
));
