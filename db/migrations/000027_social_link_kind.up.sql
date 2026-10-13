-- A social link is a URL or a Discord username. A Discord username has no page
-- to link to, so it is stored in its own column and url is empty. Existing
-- rows are URL links.
ALTER TABLE user_social_links
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'url'
        CHECK (kind IN ('url', 'discord')),
    ADD COLUMN username TEXT,
    ALTER COLUMN url DROP NOT NULL,
    ADD CONSTRAINT user_social_links_kind_value_check CHECK (
        (kind = 'url' AND url IS NOT NULL AND username IS NULL)
        OR (kind = 'discord' AND username IS NOT NULL AND url IS NULL)
    );
