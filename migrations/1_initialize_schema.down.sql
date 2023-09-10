-- Remove Foreign Key Constraints
ALTER TABLE participants DROP CONSTRAINT IF EXISTS fk_user_id;
ALTER TABLE participants DROP CONSTRAINT IF EXISTS fk_event_id;
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS fk_user_id;
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS fk_school_id;
ALTER TABLE events DROP CONSTRAINT IF EXISTS fk_user_id;

-- Drop Tables
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS school_users;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS schools;
