-- Migration: 054_attempts_polymorphic_source.sql
-- Sprint 10.5 Phase 2 — make vocabulary_exercise_attempts.exercise_id
-- polymorphic so attempts on personalized questions (user_d1_questions)
-- can be logged alongside admin-pool attempts (vocabulary_exercises).
--
-- Phase 1 (Sprint 10.5 PR #204) introduced user_d1_questions but didn't
-- yet land an attempt path. Phase 2 wires the session + attempt flow,
-- which means the existing FK constraint on exercise_id (added by
-- migration 022) blocks INSERTs whose exercise_id comes from
-- user_d1_questions.
--
-- Two changes:
--   1. DROP the FK constraint vocabulary_exercise_attempts_exercise_id_fkey.
--      Referential integrity is preserved at the application layer: the
--      attempt handler looks up the exercise_id in user_d1_questions first
--      (when exercise_source='personalized') and admin pool otherwise.
--      Hard FK enforcement was the simplest pre-Sprint-10.5 design, but
--      personalized questions live in a separate table by design, so a
--      single-table FK can't hold.
--
--   2. ADD an exercise_source TEXT column with a CHECK constraint —
--      'admin' (existing behaviour) or 'personalized' (new). DEFAULT 'admin'
--      so the existing 1000+ rows grandfather in without a backfill step.
--      Future admin-pool deprecation (Sprint 10.6 candidate) can drop the
--      column once all attempts route through personalized.
--
-- The Sprint 10.3 D1→SRS wire (target_vocab_id on vocabulary_exercises
-- + flashcard_reviews upsert) is unaffected. For personalized attempts,
-- target_vocab_id comes from user_d1_questions.vocabulary_id and feeds
-- _apply_d1_srs_update directly.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD COLUMN IF NOT EXISTS.

ALTER TABLE vocabulary_exercise_attempts
    DROP CONSTRAINT IF EXISTS vocabulary_exercise_attempts_exercise_id_fkey;

ALTER TABLE vocabulary_exercise_attempts
    ADD COLUMN IF NOT EXISTS exercise_source TEXT NOT NULL DEFAULT 'admin';

-- Drop + recreate the CHECK so this migration is idempotent without
-- branching on whether the constraint already exists.
ALTER TABLE vocabulary_exercise_attempts
    DROP CONSTRAINT IF EXISTS vocabulary_exercise_attempts_exercise_source_check;
ALTER TABLE vocabulary_exercise_attempts
    ADD CONSTRAINT vocabulary_exercise_attempts_exercise_source_check
        CHECK (exercise_source IN ('admin', 'personalized'));

COMMENT ON COLUMN vocabulary_exercise_attempts.exercise_source IS
    'Sprint 10.5 Phase 2 — polymorphic discriminator for exercise_id. '
    '''admin'' = vocabulary_exercises.id (legacy pool); '
    '''personalized'' = user_d1_questions.id (per-user pool).';
