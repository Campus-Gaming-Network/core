-- People lists: signed-in visitors can see who is going to an event, who has
-- a school as their home school, and who is on a team. show_in_lists lets a
-- person opt out of all three. It only hides the person from the lists: their
-- RSVPs, memberships, and the counts built from them do not change.
-- Existing accounts default to listed, so the setting is opt-out.
ALTER TABLE users ADD COLUMN show_in_lists BOOLEAN NOT NULL DEFAULT TRUE;

-- Serves the school member list: one school's listable members in name order,
-- the order the list pages by. The predicate matches the list query's filter,
-- so deleted, suspended, unverified, and opted-out accounts are not indexed.
CREATE INDEX users_home_school_listing_idx
    ON users (home_school_id, lower(name), id)
    WHERE deleted_at IS NULL
      AND account_status = 'active'
      AND email_verified_at IS NOT NULL
      AND show_in_lists;
