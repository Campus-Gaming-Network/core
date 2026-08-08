-- Phase 3: support and safety intake.
-- Queues support tickets and reports for CRM/admin review.

CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submitter_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    contact_email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_review', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX support_tickets_status_idx
    ON support_tickets (status, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX support_tickets_submitter_idx
    ON support_tickets (submitter_user_id, created_at)
    WHERE deleted_at IS NULL AND submitter_user_id IS NOT NULL;

CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('event', 'user')),
    target_id UUID NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_review', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX reports_status_idx
    ON reports (status, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX reports_target_idx
    ON reports (target_type, target_id, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX reports_reporter_idx
    ON reports (reporter_user_id, created_at)
    WHERE deleted_at IS NULL;

CREATE TRIGGER support_tickets_set_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER reports_set_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
