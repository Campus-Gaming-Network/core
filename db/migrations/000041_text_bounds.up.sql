-- Closes integrity gaps the API validators already enforce but the schema did
-- not. Every limit below matches the Go validator for that field. The Go
-- validators count bytes and these checks count characters, so the database
-- never rejects a value the API accepts.
--
-- events.title has no upper bound here: the demo seed (internal/seed/demo.go)
-- deliberately writes titles over the API's 120 limit to exercise long-title
-- layouts.
--
-- Each constraint is added NOT VALID and then validated, so a row written
-- before this migration that breaks a rule fails the migration by name.

ALTER TABLE events
  ADD CONSTRAINT events_title_length CHECK (char_length(btrim(title)) >= 1) NOT VALID,
  ADD CONSTRAINT events_description_length CHECK (char_length(description) <= 5000) NOT VALID,
  ADD CONSTRAINT events_location_name_length CHECK (char_length(location_name) <= 200) NOT VALID,
  ADD CONSTRAINT events_address_length CHECK (char_length(address) <= 1000) NOT VALID,
  ADD CONSTRAINT events_online_url_length CHECK (char_length(online_url) <= 500) NOT VALID,
  ADD CONSTRAINT events_payment_note_length CHECK (char_length(payment_note) <= 1000) NOT VALID;
ALTER TABLE events
  VALIDATE CONSTRAINT events_title_length,
  VALIDATE CONSTRAINT events_description_length,
  VALIDATE CONSTRAINT events_location_name_length,
  VALIDATE CONSTRAINT events_address_length,
  VALIDATE CONSTRAINT events_online_url_length,
  VALIDATE CONSTRAINT events_payment_note_length;

ALTER TABLE teams
  ADD CONSTRAINT teams_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT teams_description_length CHECK (char_length(description) <= 5000) NOT VALID;
ALTER TABLE teams
  VALIDATE CONSTRAINT teams_name_length,
  VALIDATE CONSTRAINT teams_description_length;

ALTER TABLE users
  ADD CONSTRAINT users_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT users_bio_length CHECK (char_length(bio) <= 2000) NOT VALID;
ALTER TABLE users
  VALIDATE CONSTRAINT users_name_length,
  VALIDATE CONSTRAINT users_bio_length;

ALTER TABLE user_social_links
  ADD CONSTRAINT user_social_links_label_length CHECK (char_length(btrim(label)) BETWEEN 1 AND 40) NOT VALID,
  ADD CONSTRAINT user_social_links_url_length CHECK (char_length(url) <= 500) NOT VALID;
ALTER TABLE user_social_links
  VALIDATE CONSTRAINT user_social_links_label_length,
  VALIDATE CONSTRAINT user_social_links_url_length;

ALTER TABLE reports
  ADD CONSTRAINT reports_reason_length CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000) NOT VALID;
ALTER TABLE reports VALIDATE CONSTRAINT reports_reason_length;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_name_length CHECK (char_length(btrim(name)) <= 120) NOT VALID,
  ADD CONSTRAINT support_tickets_subject_length CHECK (char_length(btrim(subject)) BETWEEN 1 AND 160) NOT VALID,
  ADD CONSTRAINT support_tickets_message_length CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000) NOT VALID;
ALTER TABLE support_tickets
  VALIDATE CONSTRAINT support_tickets_name_length,
  VALIDATE CONSTRAINT support_tickets_subject_length,
  VALIDATE CONSTRAINT support_tickets_message_length;
