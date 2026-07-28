-- ============================================================================
-- Migration 171 — cấp khoá học + gán lớp cho nội dung kỳ thi (Đợt 3)
--
-- WHY. Choosing which paper to give which class is currently done from memory:
-- nothing on a reading/listening test or a writing prompt says what course
-- level it targets, and nothing links it to a class. With three content types
-- and a growing library that does not scale, and picking the wrong paper for a
-- class is a mistake nobody notices until the exam is under way.
--
-- TWO PIECES
--
--   course_level TEXT — free text ON PURPOSE, no CHECK. The values are the
--   centre's own course ladder (C1, C2, C4…), visible today only as a prefix in
--   cohort codes. A CHECK would mean a migration every time a course is added,
--   which guarantees the column stops being maintained. The admin UI offers the
--   values already in use as suggestions; anything else is still allowed.
--
--   exam_content_cohorts — one POLYMORPHIC join table for all three content
--   kinds rather than three near-identical tables. A paper is reused across
--   classes (that was the explicit decision), so this is many-to-many. The repo
--   already carries polymorphic precedent (mig 054).
--
--   No FK on content_id: it points into one of three tables depending on
--   content_kind, so the database cannot express it. Deletion is handled by the
--   cleanup below plus the app; the cohort side DOES get a real FK with
--   ON DELETE CASCADE, because deleting a class must never leave rows pointing
--   at a class that is gone.
--
-- TO REVERSE:
--   DROP TABLE IF EXISTS exam_content_cohorts;
--   ALTER TABLE reading_tests   DROP COLUMN IF EXISTS course_level;
--   ALTER TABLE listening_tests DROP COLUMN IF EXISTS course_level;
--   ALTER TABLE writing_prompts DROP COLUMN IF EXISTS course_level;
--
-- Apply by hand in the Supabase SQL editor.
-- ============================================================================

BEGIN;

ALTER TABLE reading_tests
    ADD COLUMN IF NOT EXISTS course_level TEXT;
ALTER TABLE listening_tests
    ADD COLUMN IF NOT EXISTS course_level TEXT;
ALTER TABLE writing_prompts
    ADD COLUMN IF NOT EXISTS course_level TEXT;

CREATE TABLE IF NOT EXISTS exam_content_cohorts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which library the id points into. Kept as a CHECK, not free text: unlike
    -- course_level this set only changes when the platform grows a new skill,
    -- which is a code change anyway.
    content_kind  TEXT NOT NULL CHECK (content_kind IN ('reading', 'listening', 'writing')),
    content_id    UUID NOT NULL,          -- no FK — see the header

    cohort_id     UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,

    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Assigning the same paper to the same class twice is a no-op, not a second
    -- row: the admin UI toggles this, and a double-click must not create a
    -- duplicate that then needs two clicks to undo.
    UNIQUE (content_kind, content_id, cohort_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_content_cohorts_content
    ON exam_content_cohorts (content_kind, content_id);
CREATE INDEX IF NOT EXISTS idx_exam_content_cohorts_cohort
    ON exam_content_cohorts (cohort_id);

-- Backend-only, like every other admin-managed table here: the student side
-- never reads it, and RLS with no policy denies anon/authenticated outright
-- while service_role keeps full access.
ALTER TABLE exam_content_cohorts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE exam_content_cohorts IS
'Which classes a mock-exam paper (reading/listening test or writing prompt) is
meant for. Many-to-many: a paper is reused across classes. Polymorphic
content_id has no FK — it points into one of three tables (mig 171).';
COMMENT ON COLUMN reading_tests.course_level IS
'Cấp khoá học đề này nhắm tới (C1/C2/C4…). Free text on purpose — a CHECK would
need a migration per new course (mig 171).';

COMMIT;
