-- ============================================================================
-- Migration 129 — user_kp_mastery (Phase 1, aggregate with time-decay)
-- ============================================================================
--
-- The per-(user, KP) rollup of kp_evidence (mig 128). Recomputed on every new
-- evidence row by services/kp_evidence.py — rule-based, canonical at the backend
-- (no optimistic frontend state). `score` is the time-decayed weighted sum of
-- evidence (recent evidence counts more; the decay half-life reuses the spirit
-- of services/retention.py's time-based model). `status` buckets the score:
--   score <= -STRONG_THRESHOLD → 'weak'   (needs work; feeds the roadmap)
--   score >=  STRONG_THRESHOLD → 'strong' (mastered)
--   otherwise                  → 'learning'
--
-- A missing row = "unseen" (no evidence yet) — the roadmap treats that distinctly
-- from 'weak'. The stored score is a snapshot at updated_at; because decay is
-- monotonic in time, a read can re-decay from updated_at for display precision,
-- but the bucket is stable enough for roadmap ordering between recomputes.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor BEFORE merge,
-- AFTER migration 128.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_kp_mastery (
    user_id          UUID NOT NULL,
    kp_id            UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,

    score            NUMERIC NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'learning'
                        CHECK (status IN ('weak', 'learning', 'strong')),
    evidence_count   INT NOT NULL DEFAULT 0,
    last_evidence_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, kp_id)
);

-- The roadmap query is "my weak KPs" → filter by (user_id, status).
CREATE INDEX IF NOT EXISTS idx_user_kp_mastery_user_status
    ON user_kp_mastery (user_id, status);
