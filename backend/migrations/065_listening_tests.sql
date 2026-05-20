-- Migration: 065_listening_tests.sql
-- Sprint 13.4 (DEBT-ADMIN-LISTENING-AUTHORING 6/N) — parent entity for
-- Cambridge IELTS test bundles. 1 test = 4 sections × 10 questions.
-- Each section maps to a listening_content row via test_id (migration 066).
-- Forward-only — no rollback script committed.

CREATE TABLE IF NOT EXISTS listening_tests (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- External test identifier (e.g., "ILR-LIS-001"). UNIQUE so re-import
    -- of the same DOCX bundle returns 422 (router level enforces "Test
    -- đã tồn tại" message — Sprint 13.4 §Falsifications).
    test_id                  TEXT NOT NULL UNIQUE,

    title                    TEXT NOT NULL,
    version                  TEXT NOT NULL DEFAULT '1.0',

    -- Target band 1.0-9.0 (Cambridge convention 0.5 increments — CHECK
    -- not enforced at half-step granularity to keep migration forward-
    -- compatible with future custom bands).
    band_target              NUMERIC(3,1) CHECK (
                                band_target >= 1.0 AND band_target <= 9.0
                             ),

    -- Mixed-accent profile (e.g., ['BrE'] | ['BrE','AusE'] | ['other']).
    -- Empty default supports rows imported before accent detection runs.
    accent_profile           TEXT[] NOT NULL DEFAULT '{}',

    -- Per-section theme map: {"s1": "Cookery class enrolment", ...}.
    -- Loose JSONB shape — Sprint 13.4 reads s1..s4 keys; future versions
    -- may add additional metadata without a schema migration.
    themes                   JSONB NOT NULL DEFAULT '{}'::jsonb,

    total_transcript_words   INTEGER CHECK (total_transcript_words >= 0),

    -- Raw source metadata bag — source_format, created_at_source, raw
    -- parser warnings, etc. Sprint 13.4 stores parser output so admins
    -- can re-derive sections without re-uploading the DOCX bundle.
    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft', 'published', 'archived'
                             )),

    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_tests_status
    ON listening_tests (status);

CREATE INDEX IF NOT EXISTS idx_listening_tests_test_id
    ON listening_tests (test_id);

COMMENT ON TABLE listening_tests IS
    'Sprint 13.4 — Cambridge IELTS test bundle parent. 1 test = 4 sections × 10 '
    'questions. Each section maps to a listening_content row with '
    'source_type=test_section via FK test_id (migration 066).';

COMMENT ON COLUMN listening_tests.test_id IS
    'External identifier (e.g., "ILR-LIS-001"). UNIQUE — duplicate DOCX import '
    'returns 422 "Test đã tồn tại".';

COMMENT ON COLUMN listening_tests.metadata IS
    'Raw parser output (source_format, created_at_source, parse warnings). '
    'Sprint 13.4 stores so admins can re-derive sections without re-upload.';
