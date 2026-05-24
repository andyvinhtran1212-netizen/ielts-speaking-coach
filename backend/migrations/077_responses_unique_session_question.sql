-- Migration: 077_responses_unique_session_question.sql
-- Sprint 14.8.1 — Codex audit F3 (P1): responses has no DB-level uniqueness.
--
-- grading.py persists responses with a read-then-write upsert keyed on
-- (session_id, question_id). With no UNIQUE constraint a double-submit or a
-- concurrent network retry can interleave the read and create duplicate rows.
-- This migration de-dups any existing duplicates, then adds a partial UNIQUE
-- index so the database enforces one row per (session_id, question_id). A
-- follow-up will switch grading.py to an atomic ON CONFLICT upsert (deferred
-- until this index is live in every environment — Andy decision 2026-05-24).
--
-- Idempotent: the dedup DELETE is a no-op when there are no duplicates;
-- CREATE UNIQUE INDEX IF NOT EXISTS is a no-op when the index already exists.

-- ── Step 1: de-dup existing rows ───────────────────────────────────────────────
-- Keep one row per (session_id, question_id). Prefer a graded row (feedback
-- present) over an ungraded one, then break ties deterministically by id.
-- Only `feedback` and `id` are referenced — both guaranteed columns — so the
-- migration does not depend on created_at/updated_at being present.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY session_id, question_id
               ORDER BY (feedback IS NOT NULL) DESC, id DESC
           ) AS rn
    FROM responses
    WHERE session_id IS NOT NULL
      AND question_id IS NOT NULL
)
DELETE FROM responses
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Step 2: partial UNIQUE index ───────────────────────────────────────────────
-- Partial (WHERE NOT NULL) so legacy rows with a NULL session_id/question_id
-- are not forced unique — defensive against older incomplete rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_responses_session_question
    ON responses (session_id, question_id)
    WHERE session_id IS NOT NULL AND question_id IS NOT NULL;

COMMENT ON INDEX uq_responses_session_question IS
    'Sprint 14.8.1 (Codex F3): one response row per (session_id, question_id). Prevents duplicates from concurrent retries/double-submit. Pairs with the atomic upsert that follows in grading.py.';
