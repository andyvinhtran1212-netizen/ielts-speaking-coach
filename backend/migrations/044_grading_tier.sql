-- Migration 044: writing_essays.grading_tier
-- Sprint 2.7a — tier foundation (Quick + Standard).
-- Future tiers (deep, instructor) reserve enum values now to avoid
-- migration churn when Sprint 2.7b/c land. Pricing gating (free vs paid
-- selection of tiers) is Sprint 2.7d.

-- Create the enum type if it doesn't already exist. Wrapped in DO block
-- because Postgres has no `CREATE TYPE IF NOT EXISTS` syntax.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grading_tier_enum') THEN
        CREATE TYPE grading_tier_enum AS ENUM ('quick', 'standard', 'deep', 'instructor');
    END IF;
END$$;

-- Add the column with default 'standard' for backward compat. Existing
-- rows backfill to 'standard' so the pre-2.7a Pro+12-section pipeline
-- behaves identically for all historical essays.
ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS grading_tier grading_tier_enum NOT NULL DEFAULT 'standard';

-- Partial index for tier-based filtering. The default 'standard' covers
-- ~all historical rows so a partial index keeps the index small and
-- only exists to accelerate future admin filters like
-- "show me all Quick essays today" or "instructor queue".
CREATE INDEX IF NOT EXISTS idx_writing_essays_grading_tier
    ON writing_essays(grading_tier)
    WHERE grading_tier != 'standard';

COMMENT ON COLUMN writing_essays.grading_tier IS
'Grading depth tier. quick=Flash 5-section, standard=Pro 12-section (default),
 deep=Pro multi-pass (Sprint 2.7b), instructor=human-reviewed (Sprint 2.7c).
 Existing rows backfilled to standard. Pricing gating: Sprint 2.7d.';
