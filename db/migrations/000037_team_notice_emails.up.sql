-- Team notices also go out by email: to a team's owner when someone joins,
-- and to the member a team is handed to.
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
    'team_ownership_transferred'
));
