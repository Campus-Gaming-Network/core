-- Publishes a Privacy version that adds the cookies, analytics, and error
-- report sections. The Terms are unchanged. Accounts that accepted
-- draft-2026-10-06 keep that acceptance; asking them to acknowledge this
-- version is the existing-user flow in docs/16.
INSERT INTO policy_documents (document_type, version, effective_at, content_sha256, source_ref)
VALUES
    ('privacy', 'draft-2026-11-17', '2026-11-17T00:00:00Z',
     '72963fa5ad9d984147ae4c247bdcd52afcb592f6f6cf9d6bb0ac9e9d8f0a63ea',
     'apps/web/src/policies/privacy-draft-2026-11-17.ts');
