-- Organizer approval for tournament registration (docs/01-product.md,
-- Tournaments). In approval mode an entry starts as a pending request that
-- organizers approve or decline. A pending entry is active: it keeps its
-- roster rows and counts toward the one-entry rules, but it holds no spot.
-- registered_at is when the entry last requested or registered, and approval
-- sets it again, so seeds follow approval order.
ALTER TABLE tournaments
    ADD COLUMN registration_mode TEXT NOT NULL DEFAULT 'open'
        CHECK (registration_mode IN ('open', 'approval'));

ALTER TABLE tournament_entries
    DROP CONSTRAINT tournament_entries_status_check,
    ADD CONSTRAINT tournament_entries_status_check
        CHECK (status IN ('registered', 'pending', 'withdrawn', 'declined', 'removed'));
