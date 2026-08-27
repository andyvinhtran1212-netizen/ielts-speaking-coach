-- ============================================================================
-- Migration 236 — Curated vocab recommendations and default-off rollout flags
-- ============================================================================

CREATE TABLE IF NOT EXISTS vocab_unit_recommendations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    unit_id        UUID NOT NULL REFERENCES vocab_learning_units(id) ON DELETE CASCADE,
    source_kind    TEXT NOT NULL CHECK (source_kind IN (
                         'speaking_feedback', 'writing_feedback', 'manual', 'diagnostic'
                     )),
    source_id      TEXT NOT NULL,
    reason_vi      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'opened', 'completed', 'dismissed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_unit_recommendations_source_key
        UNIQUE (user_id, unit_id, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_vocab_unit_recommendations_user_status
    ON vocab_unit_recommendations(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vocab_unit_recommendations_unit
    ON vocab_unit_recommendations(unit_id);

DROP TRIGGER IF EXISTS trg_vocab_unit_recommendations_updated_at
    ON vocab_unit_recommendations;
CREATE TRIGGER trg_vocab_unit_recommendations_updated_at
    BEFORE UPDATE ON vocab_unit_recommendations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vocab_unit_recommendations ENABLE ROW LEVEL SECURITY;

-- Missing runtime rows resolve to the caller's default. Explicit rows make the
-- rollout posture auditable and guarantee that every new capability starts off.
INSERT INTO runtime_flags (key, enabled, note)
VALUES
    ('vocab_units_read', FALSE, 'Curated Vocab Wiki public/authenticated reads'),
    ('vocab_unit_attempts_write', FALSE, 'Curated Vocab Wiki server-graded attempts'),
    ('vocab_unit_recommendations', FALSE, 'Post-feedback curated unit recommendations'),
    ('vocab_ai_scoring', FALSE, 'Reserved; deterministic grading remains canonical')
ON CONFLICT (key) DO NOTHING;
