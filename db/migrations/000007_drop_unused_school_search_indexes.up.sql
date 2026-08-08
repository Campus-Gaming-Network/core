-- Drop the trigram indexes on schools.
--
-- They were built for fuzzy name search, but the planner never chooses them.
-- The catalog holds 6,243 rows in about 192 pages, so a sequential scan wins
-- outright: measured at 5.3 ms against 5.4 ms for a forced index scan, with
-- pg_stat_user_indexes reporting zero scans for both indexes across the whole
-- benchmark. Together they occupied roughly 6 MB, four times the size of the
-- table they indexed.
--
-- The catalog is expected to grow by one or two rows a year, so this will not
-- change. If typo-tolerant search is added later it should come back as a
-- similarity query against a purpose-built index, not as an ILIKE that happens
-- to be trigram-eligible.

DROP INDEX IF EXISTS schools_active_name_trgm_idx;
DROP INDEX IF EXISTS schools_active_alias_trgm_idx;
