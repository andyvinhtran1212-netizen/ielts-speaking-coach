-- ============================================================================
-- Migration 178 — bài tập và buổi học phải cùng một lớp
-- ============================================================================
--
-- WHY. In mig 177 `class_assignments.cohort_id` and `.lesson_id` are two
-- independent foreign keys, so nothing stops an assignment belonging to class A
-- from being grouped under a lesson belonging to class B. Reproduced on a local
-- Postgres: the cross-cohort INSERT is accepted without complaint.
--
-- That is not a display bug. The class page renders an assignment together with
-- its lesson heading, so a mismatched row shows one class's lesson title — and
-- whatever the teacher wrote in its body — on another class's page. Content
-- leaking between classes is the kind of thing nobody reports as a bug; they
-- just quietly lose trust in what the page says.
--
-- The window is real even with a correct admin UI: a stale request, a bulk
-- import, or a hand-written UPDATE all reach the table directly, and moving an
-- assignment between classes without re-pointing lesson_id produces the same
-- state. A constraint is the only thing that holds under all three.
--
-- ── THE TRAP IN THE OBVIOUS FIX ─────────────────────────────────────────────
--
-- The textbook remedy is a composite FK (lesson_id, cohort_id) → (id,
-- cohort_id). Written the plain way it BREAKS DELETING A LESSON outright:
-- ON DELETE SET NULL nulls EVERY column of the FK, so Postgres emits
--     UPDATE class_assignments SET lesson_id = NULL, cohort_id = NULL
-- and cohort_id is NOT NULL — the delete aborts with a not-null violation.
-- Verified locally; the error surfaces at DELETE time, long after the
-- migration has been signed off as fine.
--
-- So this uses the column-list form, `ON DELETE SET NULL (lesson_id)`, added in
-- PostgreSQL 15 — only lesson_id is cleared and the assignment keeps its class.
-- Production is PostgreSQL 17.6, checked before writing this.
--
-- ── WHY A NEW FILE INSTEAD OF EDITING 177 ───────────────────────────────────
-- 177 is already applied. Editing it would change nothing on any database that
-- has run it (its CREATE TABLE is IF NOT EXISTS, so a re-run skips the table and
-- the new constraint with it) while making the file disagree with the schema it
-- supposedly describes. Forward-only, as the directory README requires.
--
-- MATCH SIMPLE (the default) means a row with lesson_id IS NULL is exempt —
-- which is what we want: an assignment not attached to any lesson stays legal.
--
-- TO REVERSE:
--   ALTER TABLE class_assignments DROP CONSTRAINT IF EXISTS class_assignments_lesson_cohort_fkey;
--   ALTER TABLE class_assignments ADD CONSTRAINT class_assignments_lesson_id_fkey
--       FOREIGN KEY (lesson_id) REFERENCES class_lessons(id) ON DELETE SET NULL;
--   ALTER TABLE class_lessons DROP CONSTRAINT IF EXISTS class_lessons_id_cohort_key;
--
-- Forward-only + idempotent. Apply by hand (Supabase SQL editor / psql).
-- ============================================================================

BEGIN;

-- ORDER MATTERS. The foreign keys go first: on a second run the composite FK
-- already exists and DEPENDS ON the unique index below, so dropping the unique
-- first fails with "other objects depend on it" — which makes the migration
-- non-repeatable, and these are pasted by hand where a double-paste is ordinary.
-- Caught by re-running it locally, not by reading it.
ALTER TABLE class_assignments
    DROP CONSTRAINT IF EXISTS class_assignments_lesson_cohort_fkey;
ALTER TABLE class_assignments
    DROP CONSTRAINT IF EXISTS class_assignments_lesson_id_fkey;   -- the mig 177 single-column FK

-- Target of the composite FK. Redundant with the primary key on its own, but a
-- composite FK can only reference a declared unique constraint covering exactly
-- its columns. (ADD CONSTRAINT has no IF NOT EXISTS form, hence drop-then-add.)
ALTER TABLE class_lessons
    DROP CONSTRAINT IF EXISTS class_lessons_id_cohort_key;
ALTER TABLE class_lessons
    ADD CONSTRAINT class_lessons_id_cohort_key UNIQUE (id, cohort_id);

-- If any cross-cohort row already exists, this ALTER fails and the whole
-- migration rolls back — loudly, which is correct: such a row is corrupt and an
-- admin must decide where it belongs.
ALTER TABLE class_assignments
    ADD CONSTRAINT class_assignments_lesson_cohort_fkey
    FOREIGN KEY (lesson_id, cohort_id)
    REFERENCES class_lessons (id, cohort_id)
    ON DELETE SET NULL (lesson_id);   -- ONLY lesson_id — see the trap note above

COMMENT ON CONSTRAINT class_assignments_lesson_cohort_fkey ON class_assignments IS
'Bài tập chỉ được gắn vào buổi học CÙNG LỚP (mig 178). Khoá ngoại ghép thay cho
khoá đơn ở mig 177, vốn cho phép bài của lớp A gắn vào buổi của lớp B — trang
lớp sẽ hiện nội dung buổi học của lớp khác. SET NULL giới hạn ở lesson_id (dạng
PG15+): nếu để mặc định, Postgres set NULL cả cohort_id và việc xoá buổi học sẽ
hỏng vì cột đó NOT NULL.';

COMMIT;
