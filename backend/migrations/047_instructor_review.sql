-- Migration: 047_instructor_review.sql
-- Mô tả: Sprint 2.7d.1 — Instructor tier human-review queue.
--
-- One review row per Instructor-tier essay, created after AI Pass 1
-- (Standard grading) finishes. Admin queue UI claims rows atomically
-- (UPDATE WHERE status='queued') so two instructors clicking Claim
-- simultaneously won't double-edit. Delivery flips writing_essays
-- status to 'delivered' AND mirrors the instructor_note onto
-- writing_essays.instructor_note (the existing student-facing note
-- column from migration 043) so the existing student-result-page
-- display path keeps working unchanged.
--
-- Why a separate table (not columns on writing_essays):
--   - Multiple status transitions (queued/claimed/edited/delivered/released)
--     cleaner as a discriminated row than 5 nullable columns
--   - Audit trail of claim/release events fits naturally as a row, not
--     a column-history nightmare
--   - Future multi-instructor: per-review claim_history can grow as a
--     child table without migrating writing_essays
--
-- The `delivered` status on writing_essays already exists (migration
-- 033). The Instructor flow flips it directly from 'graded' (after
-- AI Pass 1) to 'delivered' on instructor deliver — bypassing the
-- non-instructor 'reviewed' intermediate. That's intentional: the
-- Instructor tier review IS the human-review step the 'reviewed'
-- state was originally for, just tracked separately.

CREATE TABLE IF NOT EXISTS instructor_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    essay_id UUID NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE,

    -- Workflow state. Lifecycle:
    --   queued     → created post-Pass 1, awaiting an instructor
    --   claimed    → an instructor locked it for editing
    --   edited     → instructor saved feedback edits but hasn't delivered
    --                (optional waypoint — deliver from claimed is also fine)
    --   delivered  → student can see; final state for the happy path
    --   released   → instructor abandoned claim; effectively returns to queue
    --                via a NULL claimed_by + status='queued' transition
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'claimed', 'edited', 'delivered', 'released')),

    -- Claim tracking. NULL when status='queued'; populated when an
    -- instructor claims. The atomic-claim contract is enforced at the
    -- application layer (UPDATE ... WHERE status='queued' returning
    -- changed-rows count) — no DB-level lock needed.
    claimed_by UUID REFERENCES users(id),
    claimed_at TIMESTAMPTZ,

    -- Delivery tracking. NULL until status='delivered'.
    delivered_at TIMESTAMPTZ,

    -- Internal queue note from the instructor (audit trail). The
    -- student-facing note is mirrored onto writing_essays.instructor_note
    -- by the deliver action — see services/instructor_workflow.py.
    -- Kept here so a regrade that resets writing_essays.instructor_note
    -- still leaves the original instructor's audit note intact.
    instructor_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One review per essay. The unique constraint also guards
    -- create_review() idempotency — duplicate inserts hit the
    -- constraint and the service falls back to selecting the existing
    -- row.
    CONSTRAINT one_review_per_essay UNIQUE (essay_id)
);

-- Hot-path index: queue listing filters on status IN ('queued',
-- 'claimed') most of the time. Partial index keeps it small (delivered
-- rows accumulate forever and don't need to be in the active-queue
-- index).
CREATE INDEX IF NOT EXISTS idx_instructor_reviews_active_status
    ON instructor_reviews(status)
    WHERE status IN ('queued', 'claimed');

-- Per-instructor "my claims" lookup.
CREATE INDEX IF NOT EXISTS idx_instructor_reviews_claimed_by
    ON instructor_reviews(claimed_by)
    WHERE claimed_by IS NOT NULL;

-- updated_at trigger — copies the pattern from existing tables.
CREATE OR REPLACE FUNCTION update_instructor_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_instructor_reviews_updated_at ON instructor_reviews;
CREATE TRIGGER trg_instructor_reviews_updated_at
    BEFORE UPDATE ON instructor_reviews
    FOR EACH ROW EXECUTE FUNCTION update_instructor_reviews_updated_at();

COMMENT ON TABLE instructor_reviews IS
'Instructor tier human-review queue (Sprint 2.7d.1). One row per
Instructor-tier essay, created after AI Standard Pass 1 finishes.
Status: queued → claimed → [edited] → delivered (or released to
return to queue). Atomic claim is enforced at the app layer via
UPDATE ... WHERE status=''queued''. Deliver action mirrors
instructor_note onto writing_essays.instructor_note (the existing
student-visible note column from migration 043).';

COMMENT ON COLUMN instructor_reviews.instructor_note IS
'Internal audit-trail note from the instructor at delivery time.
The student-facing copy is mirrored to writing_essays.instructor_note
on deliver — kept separately here so a later regrade that resets the
student-facing column doesn''t lose the original audit text.';
