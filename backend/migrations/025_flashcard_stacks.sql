-- 025_flashcard_stacks.sql
-- Phase D Wave 2: Flashcard system — manual (persisted) stacks.
--
-- Auto-stacks (all_vocab / recent / needs_review) are virtual: generated
-- on-the-fly by GET /api/flashcards/stacks and never written here.  Only
-- user-curated "manual" stacks live in this table.  type='manual' is
-- pinned by a CHECK constraint so a future stack kind requires an explicit
-- migration rather than slipping in via a stray INSERT.
--
-- RLS: owner-scoped USING + WITH CHECK on every mutating policy so a
-- caller cannot reassign user_id to another account (lesson from Phase B
-- migration 019b and Phase D Wave 1 022b/023).
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS flashcard_stacks (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name          VARCHAR(50)  NOT NULL CHECK (length(trim(name)) >= 3),
    type          TEXT         NOT NULL DEFAULT 'manual' CHECK (type = 'manual'),
    filter_config JSONB,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flashcard_stacks_user
    ON flashcard_stacks (user_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE flashcard_stacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flashcard_stacks_select ON flashcard_stacks;
CREATE POLICY flashcard_stacks_select ON flashcard_stacks
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_stacks_insert ON flashcard_stacks;
CREATE POLICY flashcard_stacks_insert ON flashcard_stacks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_stacks_update ON flashcard_stacks;
CREATE POLICY flashcard_stacks_update ON flashcard_stacks
    FOR UPDATE
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_stacks_delete ON flashcard_stacks;
CREATE POLICY flashcard_stacks_delete ON flashcard_stacks
    FOR DELETE USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS flashcard_stacks_delete ON flashcard_stacks;
-- DROP POLICY IF EXISTS flashcard_stacks_update ON flashcard_stacks;
-- DROP POLICY IF EXISTS flashcard_stacks_insert ON flashcard_stacks;
-- DROP POLICY IF EXISTS flashcard_stacks_select ON flashcard_stacks;
-- DROP INDEX  IF EXISTS idx_flashcard_stacks_user;
-- DROP TABLE  IF EXISTS flashcard_stacks CASCADE;
