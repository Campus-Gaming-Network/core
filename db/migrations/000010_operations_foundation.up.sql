-- Operations foundation: moderation queue ownership, domain audit history,
-- and per-user in-app notifications. Site-admin authorization remains an API
-- concern; this migration does not make any of these records public.

ALTER TABLE reports
    ADD COLUMN assigned_to_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN resolution_note TEXT NOT NULL DEFAULT '',
    ADD COLUMN retention_started_at TIMESTAMPTZ;

ALTER TABLE support_tickets
    ADD COLUMN assigned_to_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN resolution_note TEXT NOT NULL DEFAULT '',
    ADD COLUMN submitter_deleted_at TIMESTAMPTZ,
    ADD COLUMN retention_started_at TIMESTAMPTZ;

-- Existing terminal records predate lifecycle tracking. Their most recent
-- update is the best available conservative start for the retention clock.
UPDATE reports
SET retention_started_at = updated_at
WHERE status IN ('resolved', 'closed');

UPDATE support_tickets
SET retention_started_at = updated_at
WHERE status IN ('resolved', 'closed');

CREATE INDEX reports_assignee_status_idx
    ON reports (assigned_to_user_id, status, created_at)
    WHERE deleted_at IS NULL AND assigned_to_user_id IS NOT NULL;

CREATE INDEX support_tickets_assignee_status_idx
    ON support_tickets (assigned_to_user_id, status, created_at)
    WHERE deleted_at IS NULL AND assigned_to_user_id IS NOT NULL;

CREATE INDEX reports_retention_cleanup_idx
    ON reports (retention_started_at, id)
    WHERE deleted_at IS NULL AND retention_started_at IS NOT NULL;

CREATE INDEX support_tickets_retention_cleanup_idx
    ON support_tickets (retention_started_at, id)
    WHERE deleted_at IS NULL AND retention_started_at IS NOT NULL;

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (LENGTH(BTRIM(action)) BETWEEN 1 AND 120),
    entity_type TEXT NOT NULL CHECK (LENGTH(BTRIM(entity_type)) BETWEEN 1 AND 80),
    entity_id UUID NOT NULL,
    before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_entity_history_idx
    ON audit_logs (entity_type, entity_id, created_at DESC, id DESC);

CREATE INDEX audit_logs_actor_history_idx
    ON audit_logs (actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (LENGTH(BTRIM(type)) BETWEEN 1 AND 80),
    title TEXT NOT NULL CHECK (LENGTH(BTRIM(title)) BETWEEN 1 AND 160),
    body TEXT NOT NULL CHECK (LENGTH(BTRIM(body)) BETWEEN 1 AND 2000),
    entity_type TEXT,
    entity_id UUID,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
    CHECK (entity_type IS NULL OR LENGTH(BTRIM(entity_type)) BETWEEN 1 AND 80)
);

CREATE INDEX notifications_user_history_idx
    ON notifications (user_id, created_at DESC, id DESC);

CREATE INDEX notifications_user_unread_idx
    ON notifications (user_id, created_at DESC, id DESC)
    WHERE read_at IS NULL;
