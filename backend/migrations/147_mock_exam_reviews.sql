-- ============================================================================
-- Migration 147 — mock exam REVIEW (human-review record, one per sitting)
-- ============================================================================
--
-- Clones the instructor_reviews contract (mig 047) but at the SITTING level:
-- one review row per sitting, holding the AI draft (nháp), the admin's final
-- bands (the source of truth for results), the examiner comment, and the
-- release audit. The claim/deliver lifecycle is enforced at the app layer
-- (UPDATE ... WHERE status='queued') by services/mock_review_workflow.py —
-- a copy of the instructor_workflow atomic-claim pattern, kept separate so the
-- essay-level flow (instructor_workflow.py) is untouched.
--
-- Writing inside a sitting still flows through the existing instructor tier
-- (grading_tier='instructor', mig 044) and is graded on the existing
-- admin_writing page; mock_exam_reviews only REFERENCES the essays via the
-- sitting. This review row aggregates the 4-skill final decision.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mock_exam_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sitting_id    UUID NOT NULL REFERENCES mock_exam_sittings(id) ON DELETE CASCADE,

    -- Lifecycle (mirrors instructor_reviews):
    --   queued    → created when the sitting reached all_submitted
    --   claimed   → an admin locked it for review
    --   edited    → final bands saved but not released (optional waypoint)
    --   reviewed  → all 4 skills decided, awaiting release
    --   released  → results delivered to the student (sealed lifted)
    status        TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'claimed', 'edited', 'reviewed', 'released')),

    -- Atomic-claim tracking (NULL until claimed). Contract enforced app-side.
    claimed_by    UUID,
    claimed_at    TIMESTAMPTZ,
    delivered_at  TIMESTAMPTZ,

    -- AI draft — nháp only, never shown as the result:
    --   {listening:{raw,band}, reading:{raw,band},
    --    writing:{t1,t2,band}, speaking:{fc,lr,gra,p,band}}
    ai_draft      JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Admin decision — the SOURCE OF TRUTH for results:
    --   {listening, reading, writing, speaking, overall}
    final_bands   JSONB NOT NULL DEFAULT '{}'::jsonb,

    examiner_comment_vi TEXT,                        -- student-facing overall note
    per_skill_notes JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Release audit.
    released_at   TIMESTAMPTZ,
    released_by   UUID,
    release_channel TEXT CHECK (release_channel IN ('in_app', 'email', 'manual')),

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One review per sitting. Also guards create_review() idempotency —
    -- duplicate inserts hit the constraint and the service selects the existing.
    CONSTRAINT one_review_per_sitting UNIQUE (sitting_id)
);

-- Hot-path: active-queue listing filters on status IN ('queued','claimed').
CREATE INDEX IF NOT EXISTS idx_mock_reviews_active_status
    ON mock_exam_reviews (status)
    WHERE status IN ('queued', 'claimed');

CREATE INDEX IF NOT EXISTS idx_mock_reviews_claimed_by
    ON mock_exam_reviews (claimed_by)
    WHERE claimed_by IS NOT NULL;

CREATE OR REPLACE FUNCTION update_mock_exam_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_mock_reviews_updated_at ON mock_exam_reviews;
CREATE TRIGGER trg_mock_reviews_updated_at
    BEFORE UPDATE ON mock_exam_reviews
    FOR EACH ROW EXECUTE FUNCTION update_mock_exam_reviews_updated_at();

ALTER TABLE mock_exam_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_mock_reviews" ON mock_exam_reviews;
CREATE POLICY "deny_client_roles_mock_reviews" ON mock_exam_reviews
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE mock_exam_reviews IS
'Human-review record, one per sitting (Phase 1). Clones the instructor_reviews
atomic-claim lifecycle at the sitting level. final_bands is the source of truth
for results; ai_draft is nháp only. Any final_bands vs ai_draft gap is a free
human-vs-AI gold-set data point.';
