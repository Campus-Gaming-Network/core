-- Phase 3.5: recurring event occurrences.
-- Each occurrence remains a normal event so RSVPs, links, and cancellation
-- notices continue to work without introducing a second event type.

ALTER TABLE events
    ADD COLUMN recurrence_rule TEXT
        CHECK (recurrence_rule IS NULL OR recurrence_rule IN ('weekly', 'biweekly', 'monthly')),
    ADD COLUMN recurrence_until TIMESTAMPTZ,
    ADD COLUMN recurrence_parent_id UUID REFERENCES events (id);

ALTER TABLE events
    ADD CONSTRAINT events_recurrence_pair_check
    CHECK (
        (recurrence_rule IS NULL AND recurrence_until IS NULL)
        OR (recurrence_rule IS NOT NULL AND recurrence_until IS NOT NULL AND recurrence_until >= starts_at)
    );

CREATE INDEX events_recurrence_parent_idx
    ON events (recurrence_parent_id, starts_at)
    WHERE deleted_at IS NULL AND recurrence_parent_id IS NOT NULL;
