-- Migration 048: archive existing needs_review vocabulary entries
-- Sprint 6.0 — Speaking grading no longer auto-adds error phrases
-- (`source_type='needs_review'`) as vocabulary. Existing rows are
-- preserved (is_archived=true) but hidden from every UI surface that
-- already filters on is_archived (my-vocabulary list, flashcard auto
-- stacks, homepage word count). The data stays addressable so an
-- admin can un-archive selectively if a user disputes a decision.
--
-- Idempotent: the WHERE clause makes a re-run a no-op (already-archived
-- rows are skipped).
--
-- Deliberately NOT removing 'needs_review' from the source_type CHECK
-- constraint — legacy rows still need a valid value, and Sprint 6.1
-- may revive the classification under a different surfacing strategy
-- (e.g., error-tracking panel separate from vocabulary).

UPDATE user_vocabulary
SET    is_archived = true,
       reason = COALESCE(reason, '') ||
                ' [auto-archived 2026-05-09: needs_review deprecated, Sprint 6.0]'
WHERE  source_type = 'needs_review'
  AND  is_archived = false;
