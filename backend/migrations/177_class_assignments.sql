-- ============================================================================
-- Migration 177 — class_assignments + class_assignment_items
--                 (+ sessions.class_assignment_item_id)
-- Giai đoạn 0 của kế hoạch docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md
-- ============================================================================
--
-- WHY. Homework given to a class exists today for exactly one skill. Writing has
-- a full lifecycle (writing_assignments, mig 036, plus cohort fan-out); Speaking,
-- Reading and Listening have none — a learner picks their own topic and starts a
-- session, and nothing anywhere says a teacher asked for it. The daily Speaking
-- assignment the centre actually runs (one task per day, due 19:00) cannot be
-- recorded at all, which means "who has not submitted" is a question the system
-- cannot answer and therefore cannot remind anyone about.
--
-- WHAT THIS IS NOT. It is not a replacement for writing_assignments. That table
-- carries a graded pipeline ~2300 lines of router code deep (draft, timer,
-- paste-log, regrade, instructor queue) and rewriting it buys nothing. These two
-- tables sit ABOVE the per-skill machinery as a submission ledger: they record
-- that a class was asked to do something by a deadline, and point at whatever
-- artifact the skill's own pipeline produced. A writing class assignment still
-- creates writing_assignments rows and is still graded by the existing path —
-- it just also has a row here so the class page can show it beside the Speaking
-- task.
--
-- ── DESIGN DECISIONS (the non-obvious ones) ────────────────────────────────
--
-- 1. ONE ASSIGNMENT = ONE DELIVERABLE. No prompt_ids array. Writing Task 1 +
--    Task 2 on the same day is two rows sharing a lesson_id, not one row with
--    two prompts. A row is the unit that gets submitted, timestamped and chased,
--    so a row holding two submittable things would need per-item state inside
--    itself — which is the child table, reinvented worse.
--
-- 2. LATENESS IS DERIVED, NEVER STORED. late = submitted_at > due_at, computed
--    at read time. A stored is_late flag drifts the moment an admin extends a
--    deadline: the students already marked late stay late, and the display
--    disagrees with the data it claims to summarise. Same reasoning kills a
--    stored 'missed' state — missed = (submitted_at IS NULL AND due_at < now()),
--    which is true continuously and needs no background job to stay true. The
--    stored `state` therefore only records things that genuinely HAPPENED.
--
-- 3. DUE_AT IS TIMESTAMPTZ, COMPOSED IN THE BACKEND. The admin picks a date; the
--    backend builds `date 19:00:00+07:00` via ZoneInfo("Asia/Ho_Chi_Minh"). The
--    deadline this exists to model is a wall-clock time in Vietnam, and this
--    repo has already shipped a day-boundary bug from treating a local date as a
--    UTC one — invisible to CI, which runs at UTC. No DEFAULT is declared here
--    precisely so the composition stays in one place instead of being half in
--    SQL and half in Python.
--
-- 4. ITEMS ARE CREATED EAGERLY, one per student, at give time. The whole point
--    is knowing who has NOT submitted; a lazily-created row cannot represent
--    absence. Fan-out is a SNAPSHOT of the roster at that moment: a student who
--    joins the class next week does not retroactively owe last week's homework
--    (that is the right default for a rolling intake), and an admin who does
--    want to catch them up re-gives the task explicitly.
--
-- 5. artifact_kind + artifact_id have NO FK. They point into one of four tables
--    depending on the skill, which the database cannot express — the same
--    polymorphic trade-off mig 171 took, for the same reason. The pairing is
--    enforced by a CHECK (both present or both absent) so a half-linked row
--    cannot exist.
--
-- ── KNOWN BEHAVIOUR, NOT A DEFECT ──────────────────────────────────────────
-- A student row with students.user_id IS NULL has no account yet, so nothing is
-- ever shown to them. Items still get created (they are on the roster and the
-- teacher's list must be complete), but the admin UI is required to surface
-- "N/M học viên chưa kích hoạt tài khoản" at give time. Assigning into silence
-- without saying so is precisely the silent failure the project rules forbid.
--
-- TO REVERSE:
--   ALTER TABLE sessions DROP COLUMN IF EXISTS class_assignment_item_id;
--   DROP TABLE IF EXISTS class_assignment_items;
--   DROP TABLE IF EXISTS class_assignments;
--
-- Forward-only + idempotent. Apply by hand (Supabase SQL editor / psql).
-- ============================================================================

BEGIN;

-- ── class_assignments — một lần giao bài, cấp LỚP ──────────────────────────

CREATE TABLE IF NOT EXISTS class_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,

    -- Optional grouping under a lesson ("bài tập của Buổi 5"). SET NULL, not
    -- CASCADE: deleting a lesson must not delete homework students have already
    -- submitted and been graded on.
    lesson_id   UUID REFERENCES class_lessons(id) ON DELETE SET NULL,

    -- Which skill's pipeline handles the doing of it. CHECK rather than free
    -- text: this set only grows when the platform grows a skill, which is a code
    -- change anyway (contrast courses.code in mig 175, deliberately free).
    skill       TEXT NOT NULL CHECK (skill IN
                    ('speaking', 'writing', 'reading', 'listening', 'vocab', 'grammar')),

    -- Polymorphic content ref. `skill` already says which table content_id
    -- points into, so there is no separate content_kind column. NULL for skills
    -- whose task is not a library row — a Speaking topic is free text, carried
    -- in content_config.
    content_id  UUID,

    -- Per-skill parameters the pipeline needs to start the task.
    --   speaking: {"topic": "…", "mode": "practice_single", "part": 2}
    --   reading/listening: {} (content_id is the test)
    content_config JSONB NOT NULL DEFAULT '{}'::jsonb,

    title        TEXT NOT NULL,
    instructions TEXT,

    -- Wall-clock deadline in Vietnam, composed by the backend (see note 3).
    -- NULL = no deadline; such a row is never late and never missed.
    due_at       TIMESTAMPTZ,

    -- NULL = visible as soon as it is published. A future value schedules the
    -- reveal without a second admin action.
    publish_at   TIMESTAMPTZ,

    status       TEXT NOT NULL DEFAULT 'published'
                     CHECK (status IN ('draft', 'published', 'archived')),

    assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The class page reads "assignments of ONE cohort, newest deadline first".
CREATE INDEX IF NOT EXISTS idx_class_assignments_cohort_due
    ON class_assignments (cohort_id, due_at DESC);

CREATE INDEX IF NOT EXISTS idx_class_assignments_lesson
    ON class_assignments (lesson_id) WHERE lesson_id IS NOT NULL;

-- The reminder job scans "published, has a deadline, deadline near now" across
-- all classes — partial so it never walks draft/archived or deadline-less rows.
CREATE INDEX IF NOT EXISTS idx_class_assignments_due_open
    ON class_assignments (due_at)
    WHERE status = 'published' AND due_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_class_assignments_updated_at ON class_assignments;
CREATE TRIGGER update_class_assignments_updated_at
    BEFORE UPDATE ON class_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ── class_assignment_items — mỗi học viên một dòng ─────────────────────────

CREATE TABLE IF NOT EXISTS class_assignment_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES class_assignments(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES students(id)          ON DELETE CASCADE,

    -- Only states that record something that HAPPENED (see note 2). 'late' and
    -- 'missed' are absent by design — both are derived from timestamps.
    state         TEXT NOT NULL DEFAULT 'assigned'
                      CHECK (state IN ('assigned', 'opened', 'submitted', 'graded')),

    -- Link to whatever the skill's own pipeline produced. No FK (note 5).
    artifact_kind TEXT CHECK (artifact_kind IN
                      ('session', 'writing_assignment', 'reading_attempt', 'listening_attempt')),
    artifact_id   UUID,

    opened_at     TIMESTAMPTZ,
    submitted_at  TIMESTAMPTZ,

    -- Band/score once the skill's grader has produced one. Denormalised on
    -- purpose: the class progress view would otherwise fan out into four
    -- different attempt tables to render one column.
    score         NUMERIC(3,1) CHECK (score IS NULL OR (score >= 0 AND score <= 9)),

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One row per student per assignment. Re-running a fan-out must be a no-op,
    -- not a second copy of the same homework.
    UNIQUE (assignment_id, student_id),

    -- A half-linked artifact (kind without id, or id without kind) is
    -- unresolvable and would read as "submitted but nothing to open".
    CONSTRAINT class_assignment_items_artifact_pairing CHECK (
        (artifact_kind IS NULL AND artifact_id IS NULL)
        OR (artifact_kind IS NOT NULL AND artifact_id IS NOT NULL)
    ),

    -- submitted/graded without a submission timestamp would make lateness
    -- (submitted_at > due_at) silently unanswerable for that row.
    CONSTRAINT class_assignment_items_submitted_at_required CHECK (
        state NOT IN ('submitted', 'graded') OR submitted_at IS NOT NULL
    )
);

-- "Bài tập của tôi" — every student-side read is by student, newest first.
CREATE INDEX IF NOT EXISTS idx_class_assignment_items_student
    ON class_assignment_items (student_id, created_at DESC);

-- Admin roster view + the reminder job both ask "who on this assignment has not
-- submitted": partial index so the scan touches only outstanding rows.
CREATE INDEX IF NOT EXISTS idx_class_assignment_items_outstanding
    ON class_assignment_items (assignment_id)
    WHERE submitted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_class_assignment_items_artifact
    ON class_assignment_items (artifact_kind, artifact_id)
    WHERE artifact_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_class_assignment_items_updated_at ON class_assignment_items;
CREATE TRIGGER update_class_assignment_items_updated_at
    BEFORE UPDATE ON class_assignment_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ── sessions.class_assignment_item_id ──────────────────────────────────────
-- The Speaking path back: a session started from a class assignment carries the
-- item it answers, so PATCH /sessions/{id}/complete can flip that item to
-- submitted without guessing from topic strings. Mirrors sessions.sitting_id,
-- which links a session to a sealed mock sitting the same way.
--
-- ON DELETE SET NULL: purging an assignment must not delete graded sessions.
-- ADD COLUMN with no default is metadata-only on PG 11+ (no table rewrite).
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS class_assignment_item_id UUID
    REFERENCES class_assignment_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_class_assignment_item
    ON sessions (class_assignment_item_id)
    WHERE class_assignment_item_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Admin-only policies. Student reads go through service-role endpoints that
-- filter on the caller's own student_id — the same posture as cohorts (060) and
-- exam_content_cohorts (171); see the mig 175 header for why no student policy
-- is declared.
ALTER TABLE class_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_assignment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS class_assignments_admin_all ON class_assignments;
CREATE POLICY class_assignments_admin_all ON class_assignments
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS class_assignment_items_admin_all ON class_assignment_items;
CREATE POLICY class_assignment_items_admin_all ON class_assignment_items
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

COMMENT ON TABLE class_assignments IS
'Một lần giao bài cho cả lớp, mọi kỹ năng (mig 177). Đứng TRÊN pipeline của
từng kỹ năng: bài Writing vẫn tạo writing_assignments và vẫn chấm bằng đường cũ.
Một dòng = một thứ phải nộp (Task 1 + Task 2 là hai dòng cùng lesson_id).';

COMMENT ON COLUMN class_assignments.due_at IS
'Hạn nộp, giờ Việt Nam, do backend ghép date + 19:00 Asia/Ho_Chi_Minh. NULL =
không có hạn (không bao giờ trễ). Không đặt DEFAULT ở SQL để việc ghép giờ chỉ
nằm một chỗ (mig 177).';

COMMENT ON TABLE class_assignment_items IS
'Sổ cái nộp bài: mỗi học viên một dòng, tạo sẵn lúc giao bài để biết ai CHƯA nộp
(mig 177). Trễ hạn và bỏ bài KHÔNG lưu — suy ra từ submitted_at với due_at.';

COMMENT ON COLUMN class_assignment_items.state IS
'Chỉ ghi những gì ĐÃ xảy ra: assigned/opened/submitted/graded. Không có "late"
hay "missed" — hai trạng thái đó suy ra từ mốc thời gian nên không bao giờ lệch
khi admin dời hạn (mig 177).';

COMMENT ON COLUMN class_assignment_items.artifact_id IS
'Trỏ tới hiện vật của kỹ năng (sessions / writing_assignments / *_test_attempts).
Không có FK vì trỏ vào một trong bốn bảng tuỳ artifact_kind — cùng đánh đổi đa
hình với mig 171. CHECK bắt buộc kind và id đi cùng nhau (mig 177).';

COMMENT ON COLUMN sessions.class_assignment_item_id IS
'Phiên Speaking này trả lời bài tập nào của lớp (mig 177). NULL = học viên tự
luyện. Cùng cách nối như sessions.sitting_id với mock sitting.';

COMMIT;
