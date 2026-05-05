-- 034_writing_student_access.sql
--
-- Phase 2.1 — extend writing_essays + writing_feedback RLS so an
-- authenticated student can SELECT their own essays + feedback.
--
-- Linking model:
--   • students.user_id (already declared in 033) is set by the
--     /activate endpoint when the access_code matches a
--     students.student_code (Phase 2.1 backend logic).
--   • RLS policies below grant SELECT to rows whose student belongs
--     to auth.uid() (which == users.id == backend's `user_id` per
--     /activate insert convention).
--
-- Additive: the existing admin-all policies (writing_essays_admin_all,
-- writing_feedback_admin_all) STAY — service role + admin users keep
-- full access. Students get an additional SELECT path scoped by
-- ownership.
--
-- Not granting INSERT/UPDATE/DELETE here — student write access is
-- Phase 2.3 scope (submission endpoints).
--
-- Index reuse: idx_students_user_id (declared in 033) already covers
-- the auth.uid() lookup, no new index needed.

-- ── writing_essays: student can read own ──────────────────────────

DROP POLICY IF EXISTS writing_essays_student_read ON writing_essays;

CREATE POLICY writing_essays_student_read ON writing_essays
    FOR SELECT
    TO authenticated
    USING (
        student_id IN (
            SELECT id FROM students WHERE user_id = auth.uid()
        )
    );

-- ── writing_feedback: student can read own (via essay join) ───────

DROP POLICY IF EXISTS writing_feedback_student_read ON writing_feedback;

CREATE POLICY writing_feedback_student_read ON writing_feedback
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM writing_essays we
            JOIN students s ON s.id = we.student_id
            WHERE we.id = writing_feedback.essay_id
              AND s.user_id = auth.uid()
        )
    );

-- ── students: student can read own profile ────────────────────────
-- Useful so the my-essays endpoint's get_current_student() lookup
-- works even when a future client query goes through user-JWT path
-- instead of supabase_admin (defense-in-depth).

DROP POLICY IF EXISTS students_self_read ON students;

CREATE POLICY students_self_read ON students
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
