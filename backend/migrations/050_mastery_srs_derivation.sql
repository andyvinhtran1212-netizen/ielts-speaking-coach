-- Migration: 050_mastery_srs_derivation.sql
-- Sprint 10.2 — Mastery-SRS unification (Area 3A, Issue #6 from Sprint 10.0 discovery)
--
-- Marks user_vocabulary.mastery_status as DEPRECATED. The column stays
-- physically present for one deprecation cycle: the bank GET endpoint
-- now derives mastery on-the-fly from flashcard_reviews (the canonical
-- SRS state), and the backfill script (scripts/backfill_mastery.py)
-- writes the derived value back to the column so admin tools / direct
-- Supabase Table Editor reads don't see stale data during the window.
--
-- Drop scheduled for Sprint 10.6 (UI clarity cleanup), once we've
-- confirmed no remaining reader trusts the column.
--
-- This migration is idempotent: COMMENT ON COLUMN replaces the prior
-- comment text on every run, so re-applying is a no-op semantically.

COMMENT ON COLUMN user_vocabulary.mastery_status IS
  'DEPRECATED Sprint 10.2 (2026-05-15) — derived from flashcard_reviews '
  '(interval_days >= 21 AND lapse_count = 0 AND review_count >= 3). '
  'Read via API only; the column is kept in sync by scripts/backfill_mastery.py '
  'during the deprecation window. Scheduled to be dropped in Sprint 10.6.';
