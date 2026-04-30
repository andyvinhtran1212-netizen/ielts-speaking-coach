-- 030_user_vocab_is_skipped.sql
-- Adds an `is_skipped` flag to user_vocabulary so the triage view's
-- "🗑️ Bỏ qua" action can persist the user's decision.  Pre-PR #25 the
-- skip was local-only — the row would reappear on next visit, which
-- testers reported as broken.
--
-- A separate column (rather than `is_archived = true`) is used because:
--   - is_archived is reused by /report (false-positive flag) and means
--     "this entry is wrong, hide it"; is_skipped means "this entry is
--     correct but I don't want to learn it right now" — a different
--     intent that we may want to surface separately later (e.g. "show
--     skipped" admin view).
--   - The two flags compose: a row can be archived AND skipped without
--     either flag claiming the other's semantics.
--
-- Default false so every existing row stays visible — this migration is
-- backwards-compatible and the "audit every query and add the filter"
-- change happens in the same PR.
--
-- Idempotent: safe to re-apply.

BEGIN;

ALTER TABLE user_vocabulary
    ADD COLUMN IF NOT EXISTS is_skipped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN user_vocabulary.is_skipped IS
    'User explicitly skipped this vocab via the triage view; hidden from '
    'every user-facing listing + flashcard surface.  Distinct from '
    'is_archived (which is reused by /report for false-positive flags).';

-- Partial index: every user-facing query filters is_skipped = false, so
-- only the "alive" subset needs a row in the index.  Saves space and keeps
-- the index lean as skipped rows pile up.
CREATE INDEX IF NOT EXISTS idx_user_vocabulary_alive
    ON user_vocabulary (user_id, created_at DESC)
    WHERE is_skipped = FALSE AND is_archived = FALSE;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX  IF EXISTS idx_user_vocabulary_alive;
-- ALTER TABLE user_vocabulary DROP COLUMN IF EXISTS is_skipped;
-- COMMIT;
