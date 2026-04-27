-- 028_user_vocab_topic.sql
-- Phase D Wave 2 prerequisite: add user_vocabulary.topic so the flashcards
-- "Manual Stack" filter can group cards by topic.
--
-- Why a 4th migration in Wave 2 — the original plan listed 025/026/027.
-- During endpoint scaffolding we discovered user_vocabulary has no `topic`
-- column even though §6 of PHASE_D_WAVE_2_PLAN.md and the §8 API contract
-- reference one.  Resolving topic via JOIN (sessions.topic) at query time
-- would (a) cost a round-trip per filter call and (b) leave manual-add
-- entries (session_id NULL) permanently topicless.  Adding the column
-- denormalised here keeps the filter a simple `eq("topic", …)` and lets
-- backfill plus future inserts populate it once.
--
-- Backfill semantics:
--   - Rows with session_id pointing at a session that has a topic → copy
--     sessions.topic into user_vocabulary.topic.
--   - Rows without session_id (manual adds) stay NULL.  The frontend will
--     surface those under a "Chưa phân loại" group.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded UPDATE (only fills NULL
-- rows so re-running won't clobber a manually-set topic later).

ALTER TABLE user_vocabulary
  ADD COLUMN IF NOT EXISTS topic VARCHAR(100);

UPDATE user_vocabulary uv
   SET topic = s.topic
  FROM sessions s
 WHERE uv.session_id = s.id
   AND uv.topic IS NULL
   AND s.topic IS NOT NULL;

-- Partial index — most queries filter by (user_id, topic = X) and the NULL
-- "uncategorised" bucket is browsed without the index anyway.
CREATE INDEX IF NOT EXISTS idx_user_vocab_topic
    ON user_vocabulary (user_id, topic)
 WHERE topic IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_user_vocab_topic;
-- ALTER TABLE user_vocabulary DROP COLUMN IF EXISTS topic;
