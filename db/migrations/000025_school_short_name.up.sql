-- alias is a search field: for many schools it lists former names, variants,
-- and misspellings. short_name is the one name an admin chooses to display
-- beside the school's name. It is empty until an admin sets it.
ALTER TABLE schools ADD COLUMN short_name TEXT
    CHECK (short_name IS NULL OR char_length(short_name) <= 40);
