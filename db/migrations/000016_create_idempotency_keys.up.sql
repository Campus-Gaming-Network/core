-- Client-supplied idempotency keys for create requests. A request that repeats
-- a key returns the row the first attempt created instead of inserting another.
-- The column is nullable because rows created before this migration and
-- recurring-event occurrences have no key; UNIQUE permits any number of NULLs.
ALTER TABLE events ADD COLUMN idempotency_key UUID UNIQUE;
ALTER TABLE teams ADD COLUMN idempotency_key UUID UNIQUE;
ALTER TABLE reports ADD COLUMN idempotency_key UUID UNIQUE;
ALTER TABLE support_tickets ADD COLUMN idempotency_key UUID UNIQUE;
