-- A link to a tournament's bracket hosted on another site (start.gg,
-- Challonge, Battlefy), shown on the event page as external until native
-- brackets ship, or instead of them. '' is no link. The API accepts only
-- http and https URLs; its 500-byte limit is at most 500 characters.
ALTER TABLE tournaments
    ADD COLUMN bracket_url TEXT NOT NULL DEFAULT ''
        CHECK (char_length(bracket_url) <= 500);
