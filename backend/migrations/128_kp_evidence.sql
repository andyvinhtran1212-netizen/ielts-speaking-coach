-- ============================================================================
-- Migration 128 — kp_evidence (Phase 1, unified diagnosis)
-- ============================================================================
--
-- Every learning signal about a Knowledge Point lands here — from ALL skills, in
-- ONE table, so a learner's grammar/vocab profile is unified instead of siloed
-- (grammar_recommendations, quiz_word_stats, flashcard_reviews were parallel).
--
-- Scoring is rule-based, NO AI at runtime (services/kp_evidence.py). Each row is
-- one piece of evidence: a signal (+1 mastery / -1 gap) at a source-determined
-- weight (plan §2.3: microcheck > exam_item > implicit).
--
--   source              signal typical  weight  tier
--   microcheck          ±1              3.0     explicit (Tier 2, highest)
--   exam_right/_wrong   +1 / -1         2.0     direct answer
--   quiz                ±1              2.0     direct answer
--   srs_review          ±1              2.0     direct recall
--   distractor_chosen   -1              1.0     implicit (which gap the wrong pick implies)
--   speaking_feedback   -1              1.0     implicit (a detected error)
--   writing_feedback    -1              1.0     implicit (future)
--
-- kp_id FKs knowledge_points (mig 127) so evidence can never dangle. context
-- carries the originating ids (session_id, response_id, attempt_id, question_id…)
-- for auditability without a join.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor BEFORE merge.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kp_evidence (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    kp_id       UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,

    source      TEXT NOT NULL CHECK (source IN (
                    'exam_wrong', 'exam_right', 'distractor_chosen', 'microcheck',
                    'srs_review', 'speaking_feedback', 'writing_feedback', 'quiz')),
    signal      SMALLINT NOT NULL CHECK (signal IN (-1, 1)),
    weight      NUMERIC  NOT NULL DEFAULT 1,

    context     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mastery recompute reads all evidence for one (user, kp); the age-decay scan
-- filters nothing but orders by recency, so the composite index covers it.
CREATE INDEX IF NOT EXISTS idx_kp_evidence_user_kp  ON kp_evidence (user_id, kp_id);
CREATE INDEX IF NOT EXISTS idx_kp_evidence_created  ON kp_evidence (created_at);
