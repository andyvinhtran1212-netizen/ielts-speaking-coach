-- ============================================================================
-- Migration 146 — mock exam SITTING (one student's attempt at a 4-skill mock)
-- ============================================================================
--
-- A sitting is the cross-skill coordinator: it binds the domain attempts
-- (reading/listening/writing/speaking), records SERVER-AUTHORITATIVE timestamps
-- for each section start/submit, tracks a one-way status lifecycle, and carries
-- the `sealed` flag that suppresses score exposure until an admin releases.
--
-- The bound work stays canonical in its own table. The *_attempt_id / essay_*_id
-- columns here are plain UUIDs (no FK) — the sitting points AT them; it does not
-- own them, and voiding a sitting must not cascade-delete real attempts.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mock_exam_sittings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mock_exam_id  UUID NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL,                    -- no FK (matches exam_attempts precedent)

    -- One-way status machine. LRW runs as one seated flow; Speaking is decoupled
    -- (may be taken before or after LRW, anytime within the exam window).
    --   registered      → sitting created, nothing started
    --   lrw_in_progress → all three sections (L+R+W) open under one countdown
    --   lrw_submitted   → LRW block submitted (speaking may still be pending)
    --   speaking_pending→ LRW done, speaking not yet complete
    --   all_submitted   → LRW + speaking both in → auto-creates a review row
    --   under_review    → an admin has claimed the review
    --   reviewed        → final bands entered, not yet released
    --   released        → results visible to the student (sealed lifted)
    --   void            → cancelled (tech failure / retake granted); audit kept
    status        TEXT NOT NULL DEFAULT 'registered' CHECK (status IN (
                      'registered', 'lrw_in_progress',
                      'lrw_submitted', 'speaking_pending', 'all_submitted',
                      'under_review', 'reviewed', 'released', 'void')),

    -- server-authoritative timestamps (never trust the client clock):
    lrw_started_at        TIMESTAMPTZ,
    listening_started_at  TIMESTAMPTZ, listening_submitted_at TIMESTAMPTZ,
    reading_started_at    TIMESTAMPTZ, reading_submitted_at   TIMESTAMPTZ,
    writing_started_at    TIMESTAMPTZ, writing_submitted_at   TIMESTAMPTZ,
    speaking_completed_at TIMESTAMPTZ,

    -- links to canonical work (plain UUIDs, no FK — see header):
    listening_attempt_id  UUID,
    reading_attempt_id    UUID,
    essay_task1_id        UUID,
    essay_task2_id        UUID,
    speaking_session_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [p1, p2, p3]

    -- soft integrity signals for the reviewer (informational, never auto-penalise):
    integrity     JSONB NOT NULL DEFAULT '{}'::jsonb,           -- {blur_count, late_ms, resumes, incomplete}
    sealed        BOOLEAN NOT NULL DEFAULT true,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active sitting per (exam, user). A released/void sitting no longer blocks
-- a fresh one (e.g. admin voids a tech-failed run and grants a retake).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_sitting_active
    ON mock_exam_sittings (mock_exam_id, user_id)
    WHERE status NOT IN ('released', 'void');

-- Reviewer queue + "my sittings" lookups.
CREATE INDEX IF NOT EXISTS idx_mock_sittings_user ON mock_exam_sittings (user_id);
CREATE INDEX IF NOT EXISTS idx_mock_sittings_review_status
    ON mock_exam_sittings (status)
    WHERE status IN ('all_submitted', 'under_review', 'reviewed');

CREATE OR REPLACE FUNCTION update_mock_exam_sittings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_mock_sittings_updated_at ON mock_exam_sittings;
CREATE TRIGGER trg_mock_sittings_updated_at
    BEFORE UPDATE ON mock_exam_sittings
    FOR EACH ROW EXECUTE FUNCTION update_mock_exam_sittings_updated_at();

ALTER TABLE mock_exam_sittings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_mock_sittings" ON mock_exam_sittings;
CREATE POLICY "deny_client_roles_mock_sittings" ON mock_exam_sittings
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE mock_exam_sittings IS
'One student attempt at a 4-skill mock (Phase 1). Binds domain attempts,
records server-authoritative section timestamps, runs a one-way status machine,
and carries `sealed` (scores suppressed until released). Speaking is decoupled
from the LRW flow. uq_mock_sitting_active blocks two concurrent live sittings
per (exam, user).';
