-- Migration 215 — pronunciation/shadowing sets and learner submissions
--
-- A course pronunciation exercise is attached to an existing quiz bank but is
-- not a quiz_attempt: the learner records a fixed set of sentences, the server
-- grades the whole set in a few Azure batches, and the result has continuous
-- scores rather than a binary correct/incorrect value.
--
-- Content lives outside quiz_banks.meta so re-importing the B05 JSONL cannot
-- silently erase the pronunciation set.  Submissions are append-only practice
-- attempts; client_id makes a retried multipart POST idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS course_pronunciation_sets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id         UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    locale          TEXT NOT NULL DEFAULT 'en-GB',
    provider        TEXT NOT NULL DEFAULT 'azure',
    voice_engine    TEXT NOT NULL DEFAULT 'kokoro',
    voice           TEXT NOT NULL DEFAULT 'bf_emma',
    content_hash    TEXT NOT NULL,
    playback_rates  JSONB NOT NULL DEFAULT '[0.85, 1.0]'::jsonb,
    sentences       JSONB NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT course_pronunciation_sets_bank_unique UNIQUE (bank_id),
    CONSTRAINT course_pronunciation_sets_sentences_array
        CHECK (jsonb_typeof(sentences) = 'array'),
    CONSTRAINT course_pronunciation_sets_rates_array
        CHECK (jsonb_typeof(playback_rates) = 'array')
);

CREATE TABLE IF NOT EXISTS course_pronunciation_submissions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                UUID NOT NULL,
    set_id                   UUID
        REFERENCES course_pronunciation_sets(id) ON DELETE SET NULL,
    bank_id                  UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    class_assignment_item_id UUID
        REFERENCES class_assignment_items(id) ON DELETE SET NULL,

    status                   TEXT NOT NULL DEFAULT 'processing',
    provider                 TEXT NOT NULL DEFAULT 'azure',
    locale                   TEXT NOT NULL,
    voice                    TEXT NOT NULL,
    batch_count              INTEGER NOT NULL DEFAULT 0 CHECK (batch_count >= 0),
    pronunciation_score      REAL,
    accuracy_score           REAL,
    fluency_score            REAL,
    completeness_score       REAL,
    results                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message            TEXT,
    graded_at                TIMESTAMP WITH TIME ZONE,
    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT course_pronunciation_submissions_client_user_unique
        UNIQUE (user_id, client_id),
    CONSTRAINT course_pronunciation_submissions_status_check
        CHECK (status IN ('processing', 'completed', 'failed')),
    CONSTRAINT course_pronunciation_submissions_results_object
        CHECK (jsonb_typeof(results) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_course_pronunciation_sets_active
    ON course_pronunciation_sets (bank_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_course_pronunciation_submissions_user_bank
    ON course_pronunciation_submissions (user_id, bank_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_pronunciation_submissions_set
    ON course_pronunciation_submissions (set_id, created_at DESC)
    WHERE set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_pronunciation_submissions_bank
    ON course_pronunciation_submissions (bank_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_pronunciation_submissions_assignment
    ON course_pronunciation_submissions (class_assignment_item_id, created_at DESC)
    WHERE class_assignment_item_id IS NOT NULL;

COMMENT ON TABLE course_pronunciation_sets IS
    'Fixed course shadowing content, reference-audio paths and Azure locale, one active set per quiz bank.';
COMMENT ON TABLE course_pronunciation_submissions IS
    'Append-only learner pronunciation attempts; one UI submit may contain multiple Azure batches.';
COMMENT ON COLUMN course_pronunciation_submissions.results IS
    'Canonical snapshot: authored sentences, per-sentence word feedback, aggregate scores and provider batch payloads.';

-- Learners use authenticated backend endpoints. Direct PostgREST access would
-- bypass the live-assignment gate, so both tables remain service-role only.
ALTER TABLE course_pronunciation_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_pronunciation_submissions ENABLE ROW LEVEL SECURITY;

COMMIT;

-- VERIFY (read-only):
-- SELECT table_name, row_security_active(table_name::regclass)
--   FROM (VALUES ('course_pronunciation_sets'),
--                ('course_pronunciation_submissions')) AS t(table_name);
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid IN ('course_pronunciation_sets'::regclass,
--                     'course_pronunciation_submissions'::regclass)
--  ORDER BY conrelid::regclass::text, conname;
