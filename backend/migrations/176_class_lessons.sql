-- ============================================================================
-- Migration 176 — class_lessons (nội dung buổi học của lớp)
-- Giai đoạn 0 của kế hoạch docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md
-- ============================================================================
--
-- WHY. A class has content — what was covered on buổi 5, the handout, the link
-- to the recording — and today there is nowhere to put it. The only thing
-- resembling it is the free-text `name` on writing_assignments ("Buổi 5"), which
-- is a label on a batch of homework, not the lesson itself: it cannot hold a
-- body, cannot be edited without touching assignment rows, and disappears
-- entirely for a class that gets no writing that day.
--
-- This table is the surface the admin types into and the student class page
-- reads back. It is deliberately the FIRST thing in the class model that is
-- purely content, with no submission workflow attached — homework hangs off it
-- (mig 177) rather than being it.
--
-- SHAPE NOTES
--
--   lesson_no IS NOT UNIQUE per cohort. Two "Buổi 5" in one class is a visible
--   mistake — the admin sees both cards side by side and fixes it — while a
--   UNIQUE index would block the ordinary act of renumbering (swapping buổi 4
--   and 5 needs a temporary value, which no admin UI should have to model). A
--   cosmetic duplicate is not worth a constraint that makes reordering fail.
--
--   lesson_no AND lesson_date are both nullable and both indexed. Some classes
--   number their sessions, some go purely by date, and a class created
--   mid-course may know the date before the number. Ordering is
--   (lesson_no NULLS LAST, lesson_date) at the query layer.
--
--   attachments IS JSONB, not a child table. An attachment here is a link with a
--   label ([{"label": "...", "url": "..."}]) — the app never queries across
--   attachments, only renders the list belonging to one lesson, so a child table
--   would buy a join and nothing else.
--
--   is_published gates student visibility. Default FALSE so a half-typed lesson
--   is never shown to a class; the admin publishes deliberately. This mirrors
--   the status gate every content table here already uses.
--
-- ON DELETE CASCADE from cohorts: a lesson has no meaning without its class, and
-- deleting a class must not leave orphan rows the admin can no longer reach.
--
-- TO REVERSE:
--   DROP TABLE IF EXISTS class_lessons;
--
-- Forward-only + idempotent. Apply by hand (Supabase SQL editor / psql).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS class_lessons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,

    -- "Buổi 5". Nullable + non-unique on purpose (see header).
    lesson_no   INTEGER CHECK (lesson_no IS NULL OR lesson_no > 0),
    lesson_date DATE,

    title       TEXT NOT NULL,

    -- Markdown. The student page renders it with the same marked pipeline the
    -- reading passage body already uses, so tables/emphasis work.
    body_md     TEXT,

    -- [{"label": "Handout buổi 5", "url": "https://…"}, …]
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,

    is_published BOOLEAN NOT NULL DEFAULT FALSE,

    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The class page always reads "lessons of ONE cohort, in order", so the index
-- carries the sort keys and no query needs a separate sort step.
CREATE INDEX IF NOT EXISTS idx_class_lessons_cohort_order
    ON class_lessons (cohort_id, lesson_no, lesson_date);

-- Student-facing read is always filtered to published.
CREATE INDEX IF NOT EXISTS idx_class_lessons_published
    ON class_lessons (cohort_id) WHERE is_published = TRUE;

DROP TRIGGER IF EXISTS update_class_lessons_updated_at ON class_lessons;
CREATE TRIGGER update_class_lessons_updated_at
    BEFORE UPDATE ON class_lessons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Admin-only policies; the student class page reads through a service-role
-- endpoint that filters by the caller's own cohort AND is_published. Same
-- posture as cohorts (060) / exam_content_cohorts (171) — see mig 175 header.
ALTER TABLE class_lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS class_lessons_admin_all ON class_lessons;
CREATE POLICY class_lessons_admin_all ON class_lessons
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

COMMENT ON TABLE class_lessons IS
'Nội dung buổi học của một lớp (mig 176): admin nhập, trang lớp phía học viên
đọc lại. is_published=false thì học viên không thấy.';

COMMENT ON COLUMN class_lessons.lesson_no IS
'Số buổi ("Buổi 5"). KHÔNG unique theo lớp — trùng số là lỗi nhìn thấy được
ngay trên UI, trong khi ràng buộc unique sẽ chặn thao tác đánh số lại (mig 176).';

COMMENT ON COLUMN class_lessons.attachments IS
'JSONB [{"label": …, "url": …}]. Không tách bảng con vì app chỉ render danh sách
tài liệu của MỘT buổi, không bao giờ truy vấn ngang qua các buổi (mig 176).';

COMMIT;
