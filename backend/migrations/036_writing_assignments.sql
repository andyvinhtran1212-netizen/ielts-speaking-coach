-- Migration: 036_writing_assignments.sql
-- Mô tả: Phase 2.3a-2 — Writing assignments (admin → student).
--
-- Links a library prompt (writing_prompts.id, migration 035) to a
-- student (students.id, migration 033) with an optional deadline +
-- instructions + status workflow. The grader essay row joins back
-- via essay_id once the student submits in Phase 2.3b.
--
-- Status workflow (5 states):
--   pending      → assigned, student hasn't started
--   in_progress  → student has opened/started but not submitted
--   submitted    → essay submitted, grading in flight
--   graded       → AI grading complete, admin review pending
--   delivered    → admin marked delivered to student
--
-- Reuses the shared `update_updated_at_column()` trigger function from
-- migration 033 (no duplicate function declared here).

CREATE TABLE IF NOT EXISTS writing_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core links
    -- Restrict prompt deletion when assignments reference it — admin must
    -- soft-delete the prompt first (via writing_prompts.is_active=false)
    -- and resolve outstanding assignments before any hard delete.
    prompt_id  UUID NOT NULL REFERENCES writing_prompts(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES students(id)        ON DELETE CASCADE,
    -- Populated by the student-submission flow (Phase 2.3b). When the
    -- essay row is later removed, the assignment stays put — keep the
    -- audit trail of "this prompt was assigned" intact.
    essay_id   UUID REFERENCES writing_essays(id)           ON DELETE SET NULL,

    -- Workflow
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'in_progress', 'submitted', 'graded', 'delivered')
    ),

    -- Optional deadline (admin's choice).
    deadline TIMESTAMP WITH TIME ZONE,

    -- Audit
    assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    instructions TEXT,                                  -- Admin's optional note to student

    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE,
    graded_at    TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE
);

-- Filter axes the admin UI uses most: by student, by prompt, by status.
CREATE INDEX IF NOT EXISTS idx_writing_assignments_student
    ON writing_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_writing_assignments_prompt
    ON writing_assignments(prompt_id);
CREATE INDEX IF NOT EXISTS idx_writing_assignments_status
    ON writing_assignments(status);
-- Partial index — most rows have NULL deadline and the "upcoming
-- deadlines" admin view only cares about the ones that have one.
CREATE INDEX IF NOT EXISTS idx_writing_assignments_deadline
    ON writing_assignments(deadline)
    WHERE deadline IS NOT NULL;

-- RLS: admin full-access (matches writing_prompts policy from
-- migration 035), plus student SELECT on own rows so Phase 2.3b's
-- student dashboard can list them under a JWT-scoped client.
ALTER TABLE writing_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS writing_assignments_admin_all ON writing_assignments;
CREATE POLICY writing_assignments_admin_all ON writing_assignments
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS writing_assignments_student_read ON writing_assignments;
CREATE POLICY writing_assignments_student_read ON writing_assignments
    FOR SELECT TO authenticated
    USING (
        student_id IN (
            SELECT id FROM students WHERE user_id = auth.uid()
        )
    );

-- Auto-update updated_at on every UPDATE — reuses the function
-- declared in migration 033.
DROP TRIGGER IF EXISTS update_writing_assignments_updated_at ON writing_assignments;
CREATE TRIGGER update_writing_assignments_updated_at
    BEFORE UPDATE ON writing_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
