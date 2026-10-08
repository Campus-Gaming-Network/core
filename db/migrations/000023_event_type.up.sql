-- What kind of event this is, so browse can tell a weekly game night from a
-- 200-person LAN. Existing events keep NULL and show no type. New and edited
-- events must name one, which the API enforces. 'tournament' is a label only:
-- it adds no brackets, entries, or standings.
ALTER TABLE events ADD COLUMN event_type TEXT
    CHECK (event_type IN (
        'game_night', 'lan', 'tournament', 'watch_party',
        'tryout', 'meeting', 'workshop', 'other'
    ));
