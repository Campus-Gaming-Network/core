-- The Admin Console audit log lists every administrative change newest
-- first. The existing audit indexes all lead with an entity, actor, session,
-- or request, so none of them serves that order.
CREATE INDEX audit_logs_history_idx
    ON audit_logs (created_at DESC, id DESC);
