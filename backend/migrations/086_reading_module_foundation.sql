-- Migration: 086_reading_module_foundation.sql
-- Sprint 20.1 — Reading module foundation (cluster 20.x, content tables).
--
-- Cluster 20.0 Discovery (PR #317) established the Listening module as the
-- clone-grade reuse target for Reading (objective auto-scoring, JSONB answer
-- persistence, attempt lifecycle, band-map). This migration lands the Reading
-- CONTENT tables; the user-scoped attempt table ships in 087 (matching how
-- Listening split content 056 from attempts 068).
--
-- ── Schema partition (Code-authoritative, Pattern #42) ────────────────
-- The Sprint 20.1 commission enumerated SIX tables (reading_content,
-- reading_exercises, reading_tests, reading_passages, reading_questions,
-- reading_test_attempts) but that list is REDUNDANT: reading_content and
-- reading_passages are both "a passage"; reading_exercises and reading_tests
-- are both "a grouping of questions over passages". The commission delegated
-- the partition to Code ("Code authoritative on schema choice"). Consolidated
-- to FOUR non-redundant tables:
--   reading_passages  — every passage (L1 vocab / L2 skill / L3 test) via a
--                       `library` discriminator. Subsumes reading_content +
--                       the commission's reading_passages.
--   reading_questions — every question (separate table, NOT JSONB-embedded,
--                       so the Sprint 20.7 diagnostic engine can index +
--                       aggregate accuracy by skill_tag). Mirrors the
--                       listening_exercises.payload JSONB question/answer shape.
--   reading_tests     — L3 full-test grouping (subsumes reading_exercises: an
--                       L2 "skill exercise" is simply a passage row with
--                       library='l2_skill' + its reading_questions; a separate
--                       exercises table buys nothing for a 1-passage exercise).
--   reading_test_attempts — user attempts (migration 087, RLS).
--
-- ── Conventions (cloned from listening 056/065) ───────────────────────
--   • Enums are TEXT + CHECK, NOT Postgres ENUM types (project convention;
--     also avoids non-transactional ALTER TYPE ADD VALUE for Phase B types).
--   • CONTENT tables are admin-curated + RLS-free; the router enforces
--     status='published' on student reads. Only the user-scoped attempt
--     table (087) gets RLS. Mirrors listening_content (RLS-free) vs
--     listening_test_attempts (RLS).
--   • Cloudinary images: image_url + image_public_id (nullable), app-layer
--     enforced — mirrors writing_prompts (migration 038).
--   • Idempotent (IF NOT EXISTS everywhere). Forward-only, no rollback script.
--   • No backfill (tables are new).

-- ── reading_tests (L3 full-test parent) ───────────────────────────────
-- Created FIRST: reading_passages.test_id FKs into it.
CREATE TABLE IF NOT EXISTS reading_tests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- External test identifier (e.g., "AVR-READ-001"). UNIQUE so a re-import
    -- of the same bundle is rejected at the router (Sprint 20.5).
    test_id             TEXT NOT NULL UNIQUE,

    title               TEXT NOT NULL,
    version             TEXT NOT NULL DEFAULT '1.0',

    -- Academic vs General Training. Phase 1 ships Academic only (D6); the
    -- column + CHECK are forward-ready for GT (Phase B) without a migration.
    module              TEXT NOT NULL DEFAULT 'academic' CHECK (module IN (
                            'academic', 'general_training'
                        )),

    -- D3 timer: server-side limit. The Sprint 20.5 submit path validates
    -- elapsed ≤ time_limit_minutes + grace; the client drives the countdown.
    time_limit_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (time_limit_minutes > 0),

    -- IELTS Reading = 3 passages / 40 questions. CHECKs cap the authored
    -- shape; defaults match the standard test.
    passage_count       INTEGER NOT NULL DEFAULT 3  CHECK (passage_count  BETWEEN 1 AND 3),
    total_questions     INTEGER NOT NULL DEFAULT 40 CHECK (total_questions BETWEEN 1 AND 40),

    -- Optional target band (Cambridge 1.0–9.0).
    band_target         NUMERIC(3,1) CHECK (band_target IS NULL OR (band_target >= 1.0 AND band_target <= 9.0)),

    -- Raw authoring/source metadata bag (import provenance, parser warnings).
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'published', 'archived'
                        )),

    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reading_tests_status  ON reading_tests (status);
CREATE INDEX IF NOT EXISTS idx_reading_tests_test_id ON reading_tests (test_id);


-- ── reading_passages (unified passage store: L1 / L2 / L3) ────────────
CREATE TABLE IF NOT EXISTS reading_passages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Library discriminator. l1_vocab = vocab reading + glossary; l2_skill =
    -- targeted skill-practice passage; l3_test = a passage inside a full test.
    library             TEXT NOT NULL CHECK (library IN (
                            'l1_vocab', 'l2_skill', 'l3_test'
                        )),

    -- Slug — identity for idempotent markdown import (upsert by slug, L1).
    -- Nullable + UNIQUE: Postgres allows multiple NULLs, so L3 test passages
    -- created via the (future) test-import path need not carry a slug.
    slug                TEXT UNIQUE,

    title               TEXT NOT NULL,
    body_markdown       TEXT NOT NULL,

    -- Difficulty (L1/L2 catalog filter). Distinct from a band target.
    difficulty_level    TEXT CHECK (difficulty_level IS NULL OR difficulty_level IN (
                            'foundation', 'intermediate', 'advanced'
                        )),

    -- Generic tag array (L1 vocab focus, L2/L3 topic tags). GIN-indexed for
    -- `topic_tags @> '{environment}'` catalog queries (cloned from
    -- listening_content.topic_tags). Generalises the commission's L1-only
    -- `vocab_focus_tags`.
    topic_tags          TEXT[] NOT NULL DEFAULT '{}',

    -- Cloudinary image (charts/diagrams). NULL for text-only passages.
    -- public_id kept for asset cleanup on delete/replace (mirrors mig 038).
    image_url           TEXT,
    image_public_id     TEXT,

    -- L1 glossary: array of {term, definition, example?, audio_url?}. Loose
    -- JSONB (the diagnostic engine never aggregates over glossary terms, so
    -- no separate table). Empty for L2/L3.
    glossary            JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- L2 skill focus — one of the D2 skill_tag values (NULL for L1/L3). Kept
    -- as a queryable column (not a tag) since L2 catalogs filter by it.
    skill_focus         TEXT CHECK (skill_focus IS NULL OR skill_focus IN (
                            'skimming', 'scanning', 'detail', 'main_idea',
                            'inference', 'vocabulary_in_context',
                            'reference_cohesion', 'writer_view_TFNG'
                        )),

    -- L3 linkage (NULL for L1/L2). passage_order = 1..3 within the test.
    test_id             UUID REFERENCES reading_tests(id) ON DELETE CASCADE,
    passage_order       INTEGER CHECK (passage_order IS NULL OR passage_order > 0),

    word_count          INTEGER CHECK (word_count IS NULL OR word_count >= 0),
    estimated_minutes   INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),

    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'published', 'archived'
                        )),

    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reading_passages_library_status
    ON reading_passages (library, status);
CREATE INDEX IF NOT EXISTS idx_reading_passages_difficulty
    ON reading_passages (difficulty_level);
CREATE INDEX IF NOT EXISTS idx_reading_passages_skill_focus
    ON reading_passages (skill_focus) WHERE skill_focus IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reading_passages_test
    ON reading_passages (test_id, passage_order) WHERE test_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reading_passages_topic_tags
    ON reading_passages USING GIN (topic_tags);


-- ── reading_questions (every question; FK → passage) ──────────────────
-- Separate table (NOT JSONB-embedded in the passage) so the Sprint 20.7
-- diagnostic engine can GROUP BY skill_tag across passages/tests cheaply.
-- The per-question payload (options/template) mirrors listening_exercises.
CREATE TABLE IF NOT EXISTS reading_questions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passage_id          UUID NOT NULL REFERENCES reading_passages(id) ON DELETE CASCADE,

    -- Question number within its test/exercise (1..40 for L3).
    q_num               INTEGER NOT NULL CHECK (q_num > 0),

    -- Full IELTS Academic Reading type set in the CHECK (Phase B types
    -- author-able without a migration); the content spec restricts the
    -- AUTHORING subset to Phase 1 at the API layer.
    question_type       TEXT NOT NULL CHECK (question_type IN (
                            'mcq_single', 'mcq_multi',
                            'true_false_not_given', 'yes_no_not_given',
                            'sentence_completion', 'summary_completion',
                            'notes_completion', 'table_completion',
                            'form_completion', 'flow_chart_completion',
                            'diagram_label_completion', 'short_answer',
                            'matching_headings', 'matching_information',
                            'matching_features', 'matching_sentence_endings'
                        )),

    prompt              TEXT NOT NULL,

    -- Per-type render payload: {options:[{label,text}], template:{...}, ...}.
    -- Shape differs per question_type — see reading_content_format_v1.md.
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Answer key: {answer: <str|array>, alternatives:[<str>...]}. Kept in a
    -- DEDICATED column (not inside payload) so the Sprint 20.6 student fetch
    -- can SELECT-without-answer to strip the key (strip_answer_keys precedent
    -- from listening). Never ship this column to a student client.
    answer              JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Diagnostic tag (D2 enum, required) + optional free-form specificity.
    skill_tag           TEXT NOT NULL CHECK (skill_tag IN (
                            'skimming', 'scanning', 'detail', 'main_idea',
                            'inference', 'vocabulary_in_context',
                            'reference_cohesion', 'writer_view_TFNG'
                        )),
    sub_skill           TEXT,

    -- Shown on the result page (Sprint 20.7 diagnostic). Optional.
    explanation         TEXT,

    order_num           INTEGER NOT NULL DEFAULT 1,

    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- One row per (passage, q_num).
    UNIQUE (passage_id, q_num)
);

CREATE INDEX IF NOT EXISTS idx_reading_questions_passage
    ON reading_questions (passage_id, order_num);
CREATE INDEX IF NOT EXISTS idx_reading_questions_skill_tag
    ON reading_questions (skill_tag);
CREATE INDEX IF NOT EXISTS idx_reading_questions_type
    ON reading_questions (question_type);


-- ── Documentation comments ────────────────────────────────────────────
COMMENT ON TABLE reading_tests IS
    'Sprint 20.1 — L3 full-test parent (3 passages / 40 questions, timed). '
    'Admin-curated, RLS-free; router enforces status=published on student '
    'reads. Mirrors listening_tests (migration 065).';
COMMENT ON TABLE reading_passages IS
    'Sprint 20.1 — unified passage store across L1 vocab / L2 skill / L3 test '
    'via the library discriminator. Admin-curated, RLS-free. Consolidates the '
    'commission''s reading_content + reading_passages (Pattern #42).';
COMMENT ON TABLE reading_questions IS
    'Sprint 20.1 — every question, FK to a passage. Separate table (not '
    'JSONB-embedded) so the Sprint 20.7 diagnostic can aggregate accuracy by '
    'skill_tag. answer column is the key — strip before any student fetch.';
COMMENT ON COLUMN reading_questions.answer IS
    'Answer key {answer, alternatives[]}. DEDICATED column so student reads '
    'SELECT-without-answer (strip_answer_keys precedent, listening). Never '
    'expose to a student client.';
COMMENT ON COLUMN reading_passages.skill_focus IS
    'L2 only — one of the D2 skill_tag values. NULL for L1/L3. Queryable '
    'column (L2 catalog filters by skill).';
COMMENT ON COLUMN reading_passages.image_public_id IS
    'Cloudinary public_id — kept for asset cleanup on delete/replace '
    '(mirrors writing_prompts.prompt_image_public_id, migration 038).';
