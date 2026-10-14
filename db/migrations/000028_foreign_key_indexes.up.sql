-- Index the foreign keys that no index leads with.
--
-- Postgres does not index referencing columns. Without one, deleting or
-- updating a referenced row scans the whole referencing table to enforce the
-- constraint, and ON DELETE CASCADE does the same to find the rows to remove.
-- TestSchemaInvariants fails on any foreign key left without a leading index.
--
-- The migration runner applies each file in a transaction, so these are plain
-- CREATE INDEX statements, not CONCURRENTLY, and they lock writes to their
-- table while they build. Every table here is small.
--
-- Other foreign keys were checked against the same rule and already have an
-- index. None of the trigram indexes dropped in 000007 comes back.
CREATE INDEX events_creator_user_id_idx
    ON events (creator_user_id);

CREATE INDEX teams_owner_user_id_idx
    ON teams (owner_user_id);

CREATE INDEX site_role_grants_granted_by_user_id_idx
    ON site_role_grants (granted_by_user_id);

CREATE INDEX site_role_grants_revoked_by_user_id_idx
    ON site_role_grants (revoked_by_user_id);

CREATE INDEX admin_sessions_grant_id_user_id_idx
    ON admin_sessions (grant_id, user_id);

CREATE INDEX user_policy_acceptances_policy_document_id_idx
    ON user_policy_acceptances (policy_document_id);
