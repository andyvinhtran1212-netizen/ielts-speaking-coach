-- ============================================================================
-- Migration 175 — courses (khoá học) + cohorts.course_id
-- Giai đoạn 0 của kế hoạch docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md
-- ============================================================================
--
-- WHY. The centre teaches five named courses (nền tảng tiếng Anh, kỹ năng nền
-- tảng IELTS, kỹ năng nâng cao IELTS, nâng cao từ vựng, luyện đề) but the
-- database has never known that. Today a course exists only as
--   (a) a prefix inside a cohort's code, and
--   (b) `course_level` free text on reading/listening tests and writing prompts
--       (mig 171),
-- neither of which can answer "show me every class of the vocabulary course" or
-- "what does a new class of this course start with". Adding the level the school
-- actually organises around is the prerequisite for both.
--
-- MODEL. A course is the syllabus; a cohort (mig 060) is ONE RUN of it. So the
-- FK lives on cohorts, not the other way round — one course, many classes over
-- time.
--
-- `cohorts.course_id` IS NULLABLE ON PURPOSE. Every cohort that exists today
-- predates courses and cannot be classified by this migration without guessing.
-- A NOT NULL column would force a fabricated backfill, and fabricated admin data
-- is exactly what the project rules forbid. NULL reads as "chưa gán khoá" in the
-- admin UI and is a prompt to classify, not a defect.
--
-- `code` IS THE STABLE KEY. Names get rewritten ("Khóa nền tảng" → "Khóa nền
-- tảng tiếng Anh"); the seed below is therefore idempotent on `code`, and a
-- re-run never duplicates a course nor overwrites a name the admin has edited.
--
-- The seeded codes C1..C5 mirror the ladder already visible in cohort code
-- prefixes so `course_level` (mig 171) can be reconciled against real rows
-- later. That reconciliation is deliberately NOT done here — this migration adds
-- structure only, it does not touch existing content rows.
--
-- TO REVERSE:
--   ALTER TABLE cohorts DROP COLUMN IF EXISTS course_id;
--   DROP TABLE IF EXISTS courses;
--
-- Forward-only + idempotent. Apply by hand (Supabase SQL editor / psql).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS courses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Short stable handle (C1…C5). UNIQUE so the seed below can be re-run and
    -- so admin UI / imports can address a course without knowing its uuid.
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,

    -- Display order in the admin picker. The five courses form a ladder, and
    -- alphabetical order on a Vietnamese name does not reproduce it.
    sort_order  INTEGER NOT NULL DEFAULT 0,

    -- Soft archive, matching cohorts (mig 060) — a retired course must keep its
    -- past classes readable, so there is no DELETE path.
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,

    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_active_order
    ON courses (sort_order) WHERE is_active = TRUE;

-- Shared trigger fn from mig 033. A trigger (rather than the caller stamping
-- updated_at, as cohorts.py does) so a direct SQL edit in the Supabase console
-- cannot leave a stale timestamp behind.
DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
CREATE TRIGGER update_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ── cohorts.course_id ───────────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: deleting a course must never take its
-- classes (and through them every student's cohort membership) with it.
ALTER TABLE cohorts
    ADD COLUMN IF NOT EXISTS course_id UUID
    REFERENCES courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cohorts_course_id
    ON cohorts (course_id) WHERE course_id IS NOT NULL;

-- ── Seed: the five courses currently taught ────────────────────────────────
-- DO NOTHING (not DO UPDATE): a re-run must not clobber a name or description
-- the admin has since edited in the UI.
INSERT INTO courses (code, name, description, sort_order) VALUES
    ('C1', 'Khóa nền tảng tiếng Anh',
           'Nền tảng tiếng Anh tổng quát trước khi vào IELTS.', 1),
    ('C2', 'Khóa kỹ năng nền tảng cho bài thi IELTS',
           'Kỹ năng làm bài IELTS mức nền tảng, cả bốn kỹ năng.', 2),
    ('C3', 'Khóa kỹ năng nâng cao cho bài thi IELTS',
           'Kỹ năng làm bài IELTS mức nâng cao, cả bốn kỹ năng.', 3),
    ('C4', 'Khóa nâng cao từ vựng cho bài thi',
           'Mở rộng và nâng cao vốn từ phục vụ bài thi.', 4),
    ('C5', 'Khóa luyện đề',
           'Luyện đề và thi thử theo định dạng thật.', 5)
ON CONFLICT (code) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Same posture as cohorts (mig 060) and exam_content_cohorts (mig 171):
-- admin-only policies, and every student-facing read goes through a
-- service-role endpoint that filters by the caller's own ids. No student policy
-- is declared because no JWT-scoped client reads this table — an unused policy
-- is surface without a reader.
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courses_admin_all ON courses;
CREATE POLICY courses_admin_all ON courses
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

COMMENT ON TABLE courses IS
'Khoá học của trung tâm (mig 175). Một khoá = giáo trình; một cohort (mig 060) =
một lần mở lớp của khoá đó. Soft archive qua is_active, không có đường xoá cứng.';

COMMENT ON COLUMN cohorts.course_id IS
'Khoá học mà lớp này thuộc về (mig 175). NULL = chưa gán khoá — mọi lớp có
trước mig 175 đều NULL và cần admin phân loại tay; NULL không phải lỗi.';

COMMIT;
