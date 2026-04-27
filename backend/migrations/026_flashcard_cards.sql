-- 026_flashcard_cards.sql
-- Phase D Wave 2: link table between manual flashcard_stacks and user_vocabulary.
--
-- Auto-stacks bypass this table entirely — the API resolves their cards by
-- querying user_vocabulary directly with the matching filter.
--
-- UNIQUE (stack_id, vocabulary_id) lets the "Add to flashcard" button rely on
-- a constraint violation to detect duplicates instead of doing a pre-check.
--
-- RLS: rather than mirroring user_id here, every policy delegates ownership
-- to flashcard_stacks via EXISTS — so a renamed/transferred stack only needs
-- one source of truth and we can never drift.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS flashcard_cards (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    stack_id       UUID         NOT NULL REFERENCES flashcard_stacks(id) ON DELETE CASCADE,
    vocabulary_id  UUID         NOT NULL REFERENCES user_vocabulary(id)  ON DELETE CASCADE,
    added_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (stack_id, vocabulary_id)
);

CREATE INDEX IF NOT EXISTS idx_flashcard_cards_stack
    ON flashcard_cards (stack_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE flashcard_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flashcard_cards_select ON flashcard_cards;
CREATE POLICY flashcard_cards_select ON flashcard_cards
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM flashcard_stacks s
             WHERE s.id = flashcard_cards.stack_id
               AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS flashcard_cards_insert ON flashcard_cards;
CREATE POLICY flashcard_cards_insert ON flashcard_cards
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM flashcard_stacks s
             WHERE s.id = flashcard_cards.stack_id
               AND s.user_id = auth.uid()
        )
        AND EXISTS (
            -- Only let the caller add their OWN vocabulary entries.
            -- Without this an authenticated user could otherwise drop a
            -- foreign user_vocabulary row id into their own stack.
            SELECT 1 FROM user_vocabulary v
             WHERE v.id = flashcard_cards.vocabulary_id
               AND v.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS flashcard_cards_update ON flashcard_cards;
CREATE POLICY flashcard_cards_update ON flashcard_cards
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM flashcard_stacks s
             WHERE s.id = flashcard_cards.stack_id
               AND s.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM flashcard_stacks s
             WHERE s.id = flashcard_cards.stack_id
               AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS flashcard_cards_delete ON flashcard_cards;
CREATE POLICY flashcard_cards_delete ON flashcard_cards
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM flashcard_stacks s
             WHERE s.id = flashcard_cards.stack_id
               AND s.user_id = auth.uid()
        )
    );


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS flashcard_cards_delete ON flashcard_cards;
-- DROP POLICY IF EXISTS flashcard_cards_update ON flashcard_cards;
-- DROP POLICY IF EXISTS flashcard_cards_insert ON flashcard_cards;
-- DROP POLICY IF EXISTS flashcard_cards_select ON flashcard_cards;
-- DROP INDEX  IF EXISTS idx_flashcard_cards_stack;
-- DROP TABLE  IF EXISTS flashcard_cards CASCADE;
