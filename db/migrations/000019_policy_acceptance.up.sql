-- Versioned Terms and Privacy documents and each user's acceptance of them.
--
-- A policy document is immutable once published: a change is a new row with a
-- new version, never an edit. content_sha256 is the SHA-256 of the published
-- source file named by source_ref, so an edit to a published file is detected.
CREATE TABLE policy_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type TEXT NOT NULL CHECK (document_type IN ('terms', 'privacy')),
    version TEXT NOT NULL CHECK (version ~ '^[0-9a-z][0-9a-z.-]{0,39}$'),
    effective_at TIMESTAMPTZ NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    source_ref TEXT NOT NULL CHECK (source_ref <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_type, version)
);

-- Serves "the version in effect now" for each document type.
CREATE INDEX policy_documents_current_idx
    ON policy_documents (document_type, effective_at DESC);

CREATE FUNCTION reject_policy_document_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'policy documents are immutable; publish a new version'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_documents_immutable
    BEFORE UPDATE OR DELETE ON policy_documents
    FOR EACH ROW EXECUTE FUNCTION reject_policy_document_change();

-- One row per user per document version. The user agrees to the Terms and
-- acknowledges the Privacy Policy; document_type on the referenced row says
-- which. Rows are appended and never edited: a later version is a new row.
-- No IP address or user agent is recorded. Existing accounts get no row here;
-- they are asked to accept on their next visit instead.
CREATE TABLE user_policy_acceptances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    policy_document_id UUID NOT NULL REFERENCES policy_documents (id),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL CHECK (source IN ('signup', 'policy_update')),
    UNIQUE (user_id, policy_document_id)
);

CREATE FUNCTION reject_policy_acceptance_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'policy acceptances are append-only'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_policy_acceptances_append_only
    BEFORE UPDATE ON user_policy_acceptances
    FOR EACH ROW EXECUTE FUNCTION reject_policy_acceptance_change();

-- The placeholder documents in effect before reviewed legal copy exists.
INSERT INTO policy_documents (document_type, version, effective_at, content_sha256, source_ref)
VALUES
    ('terms', 'draft-2026-10-06', '2026-10-06T00:00:00Z',
     '38a64fd155fa84110c8c873b0e835bff87976de139e1cd47442ddc2c8693ae9d',
     'apps/web/src/policies/terms-draft-2026-10-06.ts'),
    ('privacy', 'draft-2026-10-06', '2026-10-06T00:00:00Z',
     '5b51599c3a2feb2a7314c6375556eaaff143a622322b3b1926401830297cdcdf',
     'apps/web/src/policies/privacy-draft-2026-10-06.ts');
