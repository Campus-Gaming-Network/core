-- is_paid could not tell "free" from "the organizer did not say". cost can:
-- free, paid, or unspecified. No existing event was ever declared free, so
-- paid events become 'paid' and every other event becomes 'unspecified'.
-- payment_note and payment_url stay and still describe paid events only.
ALTER TABLE events ADD COLUMN cost TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (cost IN ('free', 'paid', 'unspecified'));

UPDATE events SET cost = 'paid' WHERE is_paid;

ALTER TABLE events DROP COLUMN is_paid;
