-- The UTC days on which each account made a signed-in API request, for daily,
-- weekly, and monthly active-user counts and retention. The API writes a row
-- on an account's first authenticated request of the day. Rows are kept 13
-- months (docs/16-legal-and-data-lifecycle-plan.md), are part of the data
-- export, and are deleted with the account.
CREATE TABLE user_activity_days (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day DATE NOT NULL,
    PRIMARY KEY (user_id, day)
);

-- Active-user counts read a range of days across every account.
CREATE INDEX user_activity_days_day_idx ON user_activity_days (day);
