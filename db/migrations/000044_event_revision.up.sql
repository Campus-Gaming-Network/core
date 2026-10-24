-- A counter that rises whenever something a calendar file shows changes, so
-- an imported calendar entry is replaced (RFC 5545 SEQUENCE). Cancelling
-- counts. Existing events start at 0, the SEQUENCE their files had.
ALTER TABLE events ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE FUNCTION events_bump_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Only this trigger moves the counter.
    NEW.revision := OLD.revision;
    IF (NEW.title, NEW.description, NEW.starts_at, NEW.ends_at, NEW.timezone,
        NEW.format, NEW.location_name, NEW.address, NEW.online_url,
        NEW.audience, NEW.deleted_at)
       IS DISTINCT FROM
       (OLD.title, OLD.description, OLD.starts_at, OLD.ends_at, OLD.timezone,
        OLD.format, OLD.location_name, OLD.address, OLD.online_url,
        OLD.audience, OLD.deleted_at) THEN
        NEW.revision := OLD.revision + 1;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER events_bump_revision
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION events_bump_revision();
