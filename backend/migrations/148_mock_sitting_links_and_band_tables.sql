-- ============================================================================
-- Migration 148 — sitting_id enforcement columns + raw→band conversion tables
-- ============================================================================
--
-- Two things a 4-skill sealed mock needs on top of the mock_* tables:
--
-- 1. SEALED enforcement hook. When a domain attempt is taken as part of a
--    sitting, its submit/review endpoints must suppress scores until release.
--    The cheapest, canonical way to know that is a nullable `sitting_id` on each
--    domain attempt table: submit handlers do
--       if attempt.sitting_id: sealed = get_sitting(sitting_id).sealed
--    with the sitting row as the single source of truth for `sealed` (not cached
--    on the attempt, so it can't drift after release).
--
-- 2. raw→band conversion as DATA, not hardcode. Listening/Reading bands are
--    tables the admin can tune per module. Seeded separately (or via admin UI).
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

-- ── 1. sitting_id on domain attempt tables (nullable → zero impact on non-mock) ──
ALTER TABLE reading_test_attempts   ADD COLUMN IF NOT EXISTS sitting_id UUID;
ALTER TABLE listening_test_attempts ADD COLUMN IF NOT EXISTS sitting_id UUID;
ALTER TABLE writing_essays          ADD COLUMN IF NOT EXISTS sitting_id UUID;
ALTER TABLE sessions                ADD COLUMN IF NOT EXISTS sitting_id UUID;

CREATE INDEX IF NOT EXISTS idx_reading_attempt_sitting
    ON reading_test_attempts (sitting_id)   WHERE sitting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_attempt_sitting
    ON listening_test_attempts (sitting_id) WHERE sitting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_writing_essays_sitting
    ON writing_essays (sitting_id)          WHERE sitting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_sitting
    ON sessions (sitting_id)                WHERE sitting_id IS NOT NULL;

-- ── 2. raw→band conversion tables (admin-tunable data) ───────────────────────
CREATE TABLE IF NOT EXISTS band_conversion_tables (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill    TEXT NOT NULL CHECK (skill IN ('listening', 'reading')),
    module   TEXT NOT NULL DEFAULT 'academic'
                 CHECK (module IN ('academic', 'general')),   -- reading has both; listening = academic
    raw_min  INTEGER NOT NULL CHECK (raw_min >= 0),
    raw_max  INTEGER NOT NULL CHECK (raw_max >= raw_min),
    band     NUMERIC(2,1) NOT NULL CHECK (band >= 0 AND band <= 9),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One row per raw range per skill/module. Guards seed idempotency.
    CONSTRAINT uq_band_range UNIQUE (skill, module, raw_min, raw_max)
);

CREATE INDEX IF NOT EXISTS idx_band_conversion_lookup
    ON band_conversion_tables (skill, module);

CREATE OR REPLACE FUNCTION update_band_conversion_tables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_band_conversion_updated_at ON band_conversion_tables;
CREATE TRIGGER trg_band_conversion_updated_at
    BEFORE UPDATE ON band_conversion_tables
    FOR EACH ROW EXECUTE FUNCTION update_band_conversion_tables_updated_at();

ALTER TABLE band_conversion_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_band_conversion" ON band_conversion_tables;
CREATE POLICY "deny_client_roles_band_conversion" ON band_conversion_tables
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON COLUMN reading_test_attempts.sitting_id IS
'Non-null when this attempt is part of a 4-skill mock sitting (mig 146). The
submit/review endpoints suppress scores while the sitting is sealed.';
COMMENT ON COLUMN listening_test_attempts.sitting_id IS
'Non-null when this attempt is part of a 4-skill mock sitting (mig 146).';
COMMENT ON COLUMN writing_essays.sitting_id IS
'Non-null when this essay is a 4-skill mock Writing task (mig 146).';
COMMENT ON COLUMN sessions.sitting_id IS
'Non-null when this speaking session belongs to a 4-skill mock sitting (mig 146).';
COMMENT ON TABLE band_conversion_tables IS
'Admin-tunable raw→band conversion for Listening/Reading (Phase 1). Data, not
hardcode, so bands can be corrected without a deploy.';
