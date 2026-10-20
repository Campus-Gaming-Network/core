-- A user's public ID: ten base58 characters that name the user in a public
-- profile URL (/users/{public_id}). It never changes. The UUID primary key
-- stays the internal identifier and every foreign key keeps pointing at it.
--
-- Base58 leaves out 0, O, I, and l, which read alike. Each character comes
-- from one random byte; bytes of 232 or more are skipped so every character
-- is equally likely (232 = 4 * 58).
CREATE FUNCTION new_user_public_id() RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    alphabet CONSTANT TEXT := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    result TEXT := '';
    random_bytes BYTEA;
    value INT;
BEGIN
    WHILE length(result) < 10 LOOP
        random_bytes := gen_random_bytes(16);
        FOR i IN 0..15 LOOP
            value := get_byte(random_bytes, i);
            IF value < 232 AND length(result) < 10 THEN
                result := result || substr(alphabet, value % 58 + 1, 1);
            END IF;
        END LOOP;
    END LOOP;
    RETURN result;
END;
$$;

ALTER TABLE users ADD COLUMN public_id TEXT;
UPDATE users SET public_id = new_user_public_id();
ALTER TABLE users
    ALTER COLUMN public_id SET DEFAULT new_user_public_id(),
    ALTER COLUMN public_id SET NOT NULL,
    ADD CONSTRAINT users_public_id_key UNIQUE (public_id),
    ADD CONSTRAINT users_public_id_format
        CHECK (public_id ~ '^[1-9A-HJ-NP-Za-km-z]{10}$');

-- Nothing may change a public ID once it is set.
CREATE FUNCTION keep_user_public_id() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
        RAISE EXCEPTION 'users.public_id cannot change';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_public_id_immutable
    BEFORE UPDATE OF public_id ON users
    FOR EACH ROW EXECUTE FUNCTION keep_user_public_id();
