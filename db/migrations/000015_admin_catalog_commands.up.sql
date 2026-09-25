-- Additive catalog lifecycle and school-grant identity for AC-009.
ALTER TABLE games ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE school_admins ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE school_admins ADD CONSTRAINT school_admins_id_key UNIQUE (id);

CREATE INDEX schools_admin_page_idx ON schools (created_at DESC, id DESC);
CREATE INDEX games_admin_page_idx ON games (created_at DESC, id DESC);
CREATE INDEX users_admin_page_idx ON users (created_at DESC, id DESC);
CREATE INDEX users_admin_email_prefix_idx ON users (lower(email::text) text_pattern_ops);
CREATE INDEX users_admin_name_prefix_idx ON users (lower(name) text_pattern_ops);
CREATE INDEX school_admins_history_idx ON school_admins (school_id, created_at DESC, id DESC);
CREATE INDEX site_role_grants_history_idx ON site_role_grants (granted_at DESC, id DESC);

-- Versions must advance even when a transaction started before the writer it
-- waited for, or when two writes occur within one transaction.
CREATE FUNCTION set_admin_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = GREATEST(clock_timestamp(), OLD.updated_at + INTERVAL '1 microsecond');
    RETURN NEW;
END;
$$;
DROP TRIGGER schools_set_updated_at ON schools;
DROP TRIGGER games_set_updated_at ON games;
DROP TRIGGER users_set_updated_at ON users;
DROP TRIGGER school_admins_set_updated_at ON school_admins;
CREATE TRIGGER schools_set_updated_at BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION set_admin_updated_at();
CREATE TRIGGER games_set_updated_at BEFORE UPDATE ON games
    FOR EACH ROW EXECUTE FUNCTION set_admin_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_admin_updated_at();
CREATE TRIGGER school_admins_set_updated_at BEFORE UPDATE ON school_admins
    FOR EACH ROW EXECUTE FUNCTION set_admin_updated_at();

-- Hold a parent share lock until a reference commits. A concurrent administrative
-- soft delete takes FOR UPDATE, so dependency checks cannot miss a late insert.
-- Historical references remain readable; new/restored references cannot point
-- to an already deleted catalog record.
CREATE FUNCTION guard_catalog_reference() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    target_id UUID;
    target_deleted TIMESTAMPTZ;
BEGIN
    IF (to_jsonb(NEW)->>'deleted_at') IS NOT NULL THEN RETURN NEW; END IF;
    target_id = (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
    IF target_id IS NULL THEN RETURN NEW; END IF;
    IF TG_ARGV[0] = 'school' THEN
        SELECT deleted_at INTO target_deleted FROM schools WHERE id = target_id FOR SHARE;
    ELSE
        SELECT deleted_at INTO target_deleted FROM games WHERE id = target_id FOR SHARE;
    END IF;
    IF NOT FOUND OR target_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'catalog reference unavailable' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER users_catalog_reference BEFORE INSERT OR UPDATE OF home_school_id, deleted_at ON users
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('school', 'home_school_id');
CREATE TRIGGER events_catalog_reference BEFORE INSERT OR UPDATE OF host_school_id, deleted_at ON events
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('school', 'host_school_id');
CREATE TRIGGER teams_catalog_reference BEFORE INSERT OR UPDATE OF school_id, deleted_at ON teams
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('school', 'school_id');
CREATE TRIGGER follows_catalog_reference BEFORE INSERT OR UPDATE OF school_id, deleted_at ON user_school_follows
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('school', 'school_id');
CREATE TRIGGER grants_catalog_reference BEFORE INSERT OR UPDATE OF school_id, deleted_at ON school_admins
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('school', 'school_id');
CREATE TRIGGER event_games_catalog_reference BEFORE INSERT OR UPDATE OF game_id ON event_games
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('game', 'game_id');
CREATE TRIGGER team_games_catalog_reference BEFORE INSERT OR UPDATE OF game_id ON team_games
    FOR EACH ROW EXECUTE FUNCTION guard_catalog_reference('game', 'game_id');
