-- Migration: 124_questions_unique_session_part_order.sql
-- Audit 2026-07-03 L6 (MEDIUM): duplicate question generation on a concurrent race.
--
-- questions.py generates via check-then-insert (SELECT existing; if none, INSERT
-- the full set). Two concurrent POST /sessions/{id}/questions/generate calls
-- (double-click / retry) both see 0 rows and both insert → a session ends up with
-- two rows per question slot. There is no DB-level uniqueness backing the check.
--
-- This migration de-dups any existing duplicates, then adds a partial UNIQUE
-- index so the database enforces one row per (session_id, part, order_num). The
-- code side (questions.py) is updated in the same change to treat the resulting
-- unique-violation as "a concurrent caller won" and return that winner's set.
--
-- Keyed on (session_id, part, order_num) rather than (session_id, order_num):
-- strictly safer (never rejects a legitimate slot if a session ever mixed parts)
-- while still catching the same-part regeneration race.
--
-- Idempotent: the dedup steps are no-ops when there are no duplicates;
-- CREATE UNIQUE INDEX IF NOT EXISTS is a no-op when the index already exists.

-- ── Keeper selection ───────────────────────────────────────────────────────────
-- Within each (session_id, part, order_num) group the KEEPER (rn = 1) is the row
-- that already has responses, tie-broken by the lowest id. Because the sort is
-- `has-response DESC`, the keeper is GUARANTEED to carry a response whenever ANY
-- row in the group has one — so a response left on a *loser* (rn > 1) is always a
-- redundant same-slot answer (the student answered the duplicated slot twice, e.g.
-- across tabs/retries). That lets us drop loser responses safely: the student's
-- answer for the slot is preserved on the keeper.

-- ── Step 1: delete responses tied to loser questions ───────────────────────────
-- Do this EXPLICITLY (not via FK cascade, whose ON DELETE behaviour on
-- responses.question_id is not defined in these migrations) so Step 2's delete
-- can neither cascade away a kept answer nor be blocked by a RESTRICT FK.
WITH ranked AS (
    SELECT q.id,
           ROW_NUMBER() OVER (
               PARTITION BY q.session_id, q.part, q.order_num
               ORDER BY (EXISTS (
                            SELECT 1 FROM responses r WHERE r.question_id = q.id
                        )) DESC,
                        q.id ASC
           ) AS rn
    FROM questions q
    WHERE q.session_id IS NOT NULL
      AND q.order_num IS NOT NULL
)
DELETE FROM responses r
USING ranked
WHERE ranked.rn > 1
  AND r.question_id = ranked.id;

-- ── Step 2: delete the loser question rows ─────────────────────────────────────
WITH ranked AS (
    SELECT q.id,
           ROW_NUMBER() OVER (
               PARTITION BY q.session_id, q.part, q.order_num
               ORDER BY (EXISTS (
                            SELECT 1 FROM responses r WHERE r.question_id = q.id
                        )) DESC,
                        q.id ASC
           ) AS rn
    FROM questions q
    WHERE q.session_id IS NOT NULL
      AND q.order_num IS NOT NULL
)
DELETE FROM questions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Step 3: partial UNIQUE index ───────────────────────────────────────────────
-- Partial (WHERE NOT NULL) so any legacy row with a NULL session_id/order_num is
-- not forced unique — defensive against older incomplete rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_session_part_order
    ON questions (session_id, part, order_num)
    WHERE session_id IS NOT NULL AND order_num IS NOT NULL;

COMMENT ON INDEX uq_questions_session_part_order IS
    'Audit 2026-07-03 L6: one question row per (session_id, part, order_num). Prevents duplicate question sets from concurrent generate calls. Pairs with the conflict-aware insert in questions.py.';
