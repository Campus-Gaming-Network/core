-- IGDB import: the game catalog now comes from IGDB instead of a hand-made
-- list. Covers are stored here and served by the API, so no page loads an
-- image from IGDB.

ALTER TABLE games ADD COLUMN last_synced_at TIMESTAMPTZ;

CREATE TABLE game_covers (
    game_id UUID PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
    content_type TEXT NOT NULL
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 102400),
    source_image_id TEXT NOT NULL,
    etag TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remove the launch games seeded by 000003, with the event and team links
-- that point at them. Games are imported from IGDB from here on.
DELETE FROM event_games
WHERE game_id IN (
    SELECT id FROM games
    WHERE igdb_id IS NULL
      AND slug IN ('rocket-league', 'valorant', 'league-of-legends', 'overwatch-2', 'super-smash-bros-ultimate', 'csgo')
);

DELETE FROM team_games
WHERE game_id IN (
    SELECT id FROM games
    WHERE igdb_id IS NULL
      AND slug IN ('rocket-league', 'valorant', 'league-of-legends', 'overwatch-2', 'super-smash-bros-ultimate', 'csgo')
);

DELETE FROM games
WHERE igdb_id IS NULL
  AND slug IN ('rocket-league', 'valorant', 'league-of-legends', 'overwatch-2', 'super-smash-bros-ultimate', 'csgo');
