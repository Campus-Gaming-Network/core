-- Every stored school-logo object for AC-010. A row is written as `pending`
-- before its upload, becomes `current` in the same transaction that points
-- schools.logo_url at it, and becomes `retired` when replaced or removed. The
-- API deletes retired objects, and pending objects whose transaction never
-- committed, then deletes their rows; a failed delete leaves the row for the
-- next reconciliation pass, so no object outlives its row.
CREATE TABLE school_logo_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id),
    object_key TEXT NOT NULL UNIQUE CHECK (LENGTH(object_key) BETWEEN 1 AND 200),
    state TEXT NOT NULL CHECK (state IN ('pending', 'current', 'retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX school_logo_objects_current_idx ON school_logo_objects (school_id) WHERE state = 'current';
CREATE INDEX school_logo_objects_cleanup_idx ON school_logo_objects (updated_at) WHERE state <> 'current';
