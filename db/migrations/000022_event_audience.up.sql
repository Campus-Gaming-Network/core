-- Who an event is for: anyone, students at any school, the host school's
-- students and staff, or members of the hosting group. This is information for
-- attendees and is separate from visibility, which controls who can see the
-- page. Existing events keep NULL and show no audience; they are not
-- backfilled with a guess. New and edited events must name one, which the API
-- enforces.
ALTER TABLE events ADD COLUMN audience TEXT
    CHECK (audience IN ('open', 'collegiate', 'campus', 'members'));
