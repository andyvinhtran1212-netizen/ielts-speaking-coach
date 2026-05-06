-- Migration: 037_writing_drafts.sql
-- Mô tả: Phase 2.3b — Writing drafts (auto-save before submission).
--
-- One draft per writing_assignments row. The student dashboard
-- writes the textarea content here as they type (3-second debounce
-- + manual "Save draft" button); the row is hard-deleted on submit
-- so an assignment never has both a live draft AND a submitted
-- essay at the same time.
--
-- Reuses the shared `update_updated_at_column()` trigger function
-- from migration 033 — no duplicate function declared here.

CREATE TABLE IF NOT EXISTS writing_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core
    assignment_id UUID NOT NULL REFERENCES writing_assignments(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES students(id)            ON DELETE CASCADE,

    -- Content. Generated word_count gives the dashboard a cheap
    -- live-progress indicator without re-parsing draft_text per row.
    -- Empty-string short-circuit avoids array_length(NULL,1) → NULL
    -- when the student has just opened a fresh card.
    draft_text TEXT NOT NULL DEFAULT '',
    word_count INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN draft_text IS NULL OR btrim(draft_text) = '' THEN 0
            ELSE coalesce(
                array_length(regexp_split_to_array(btrim(draft_text), '\s+'), 1),
                0
            )
        END
    ) STORED,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One draft per assignment — upserts target this conflict key.
    UNIQUE (assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_writing_drafts_student
    ON writing_drafts(student_id);
-- Note: the UNIQUE(assignment_id) constraint already creates a
-- supporting index; no need for a duplicate idx_..._assignment.

-- RLS: student owns their drafts; admin has full visibility for
-- support / debugging.
ALTER TABLE writing_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS writing_drafts_admin_all ON writing_drafts;
CREATE POLICY writing_drafts_admin_all ON writing_drafts
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS writing_drafts_student_own ON writing_drafts;
CREATE POLICY writing_drafts_student_own ON writing_drafts
    FOR ALL TO authenticated
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    )
    WITH CHECK (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    );

-- Auto-update updated_at on every UPDATE — reuses the function
-- declared in migration 033.
DROP TRIGGER IF EXISTS update_writing_drafts_updated_at ON writing_drafts;
CREATE TRIGGER update_writing_drafts_updated_at
    BEFORE UPDATE ON writing_drafts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
