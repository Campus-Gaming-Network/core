-- Club roles and claims (docs/01-product.md, Clubs). Officers claim an
-- existing club or request one that is not listed; site admins review both,
-- and an approved claim makes the applicant the club's owner.

-- A person's role in a club. Claims write only owners; editors and members
-- arrive with their own work. A club with an owner is claimed.
CREATE TABLE club_members (
    club_id UUID NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (club_id, user_id)
);

CREATE INDEX club_members_user_idx ON club_members (user_id);

-- A claim on a listed club (club_id set) or a request for a new one
-- (club_id null, with the requested name and type). Approving a request
-- creates the club and records it here. Evidence and the review note are
-- private to the applicant and site admins.
CREATE TABLE club_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs (id),
    school_id UUID NOT NULL REFERENCES schools (id),
    requested_name TEXT CHECK (LENGTH(BTRIM(requested_name)) BETWEEN 1 AND 120),
    requested_type TEXT CHECK (requested_type IN ('student_club', 'university_program')),
    applicant_user_id UUID NOT NULL REFERENCES users (id),
    evidence_text TEXT NOT NULL CHECK (LENGTH(BTRIM(evidence_text)) BETWEEN 1 AND 2000),
    evidence_url TEXT NOT NULL DEFAULT '' CHECK (evidence_url = '' OR (evidence_url ~* '^https?://' AND LENGTH(evidence_url) <= 500)),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewer_user_id UUID REFERENCES users (id),
    review_note TEXT CHECK (LENGTH(review_note) <= 1000),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A request names the club it asks for; a claim names neither.
    CHECK ((requested_name IS NULL) = (requested_type IS NULL)),
    -- A pending request has no club yet; every other claim has one.
    CHECK (club_id IS NOT NULL OR (requested_name IS NOT NULL AND status <> 'approved')),
    CHECK ((status = 'pending') = (reviewed_at IS NULL)),
    CHECK ((status = 'pending') = (reviewer_user_id IS NULL)),
    CHECK (status <> 'rejected' OR LENGTH(BTRIM(review_note)) > 0)
);

-- One pending claim per person per club, and one pending request per person
-- per club name at a school.
CREATE UNIQUE INDEX club_claims_pending_claim_idx
    ON club_claims (club_id, applicant_user_id)
    WHERE status = 'pending' AND requested_name IS NULL;
CREATE UNIQUE INDEX club_claims_pending_request_idx
    ON club_claims (school_id, LOWER(BTRIM(requested_name)), applicant_user_id)
    WHERE status = 'pending' AND requested_name IS NOT NULL;
-- The review queue reads newest first within a status.
CREATE INDEX club_claims_queue_idx ON club_claims (status, created_at DESC, id DESC);
CREATE INDEX club_claims_club_idx ON club_claims (club_id);
CREATE INDEX club_claims_school_idx ON club_claims (school_id);
CREATE INDEX club_claims_applicant_idx ON club_claims (applicant_user_id);
CREATE INDEX club_claims_reviewer_idx ON club_claims (reviewer_user_id);

CREATE TRIGGER club_members_set_updated_at
    BEFORE UPDATE ON club_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- A review is an admin command checked against the claim's version.
CREATE TRIGGER club_claims_set_updated_at
    BEFORE UPDATE ON club_claims
    FOR EACH ROW EXECUTE FUNCTION set_admin_updated_at();

-- The applicant hears about the decision by email.
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
    'club_claim_rejected'
));
