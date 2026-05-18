-- Migration: 059_listening_session_composition.sql
-- Sprint 11.5 — Listening session composition (DEBT-LISTENING-MODULE 5/5
-- CLUSTER FINAL). Mini Test as composite exercise sequences.
--
-- Migration 056 modeled listening_sessions for the classic IELTS layout:
-- 4 whole `listening_content` rows, one per section. Sprint 11.5 reframes
-- Mini Test as an arbitrary ordered set of any exercise types (dictation,
-- gist, true_false, mcq, in any mix) — admins author the question lineup
-- explicitly. The new columns coexist with `section_content_ids` so the
-- legacy shape stays valid for content-driven mini tests; Sprint 11.5
-- builds exclusively against the exercise_ids array.
--
-- Schema delta:
--   listening_sessions.session_type      TEXT     — discriminator. Default
--                                                  'free_practice' so the
--                                                  existing skill-exercise
--                                                  rows (none use sessions
--                                                  yet, but defensive) get
--                                                  a non-NULL value.
--   listening_sessions.exercise_ids      UUID[]   — ordered list of
--                                                  listening_exercises.id
--                                                  for the mini test. Empty
--                                                  array for free_practice.
--   listening_sessions.ordered_position  JSONB    — per-exercise scaffold
--                                                  (section label, est
--                                                  time). Shape:
--                                                    [{exercise_id, section,
--                                                      label}, ...]
--
-- listening_attempts.listening_session_id already exists (migration 056) —
-- no DDL change there. Sprint 11.5's user runner sets that field when an
-- attempt is part of a mini-test session.
--
-- Idempotent. Forward-only — no rollback script.


ALTER TABLE listening_sessions
    ADD COLUMN IF NOT EXISTS session_type      TEXT NOT NULL DEFAULT 'free_practice',
    ADD COLUMN IF NOT EXISTS exercise_ids      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    ADD COLUMN IF NOT EXISTS ordered_position  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Constrain session_type to the values the router accepts. Done via
-- ALTER + DROP/ADD CONSTRAINT (vs CHECK in CREATE TABLE) so re-runs are
-- safe: drop-if-exists then re-add.
ALTER TABLE listening_sessions
    DROP CONSTRAINT IF EXISTS listening_sessions_session_type_check;
ALTER TABLE listening_sessions
    ADD CONSTRAINT listening_sessions_session_type_check
    CHECK (session_type IN ('free_practice', 'mini_test'));


COMMENT ON COLUMN listening_sessions.session_type IS
    'Sprint 11.5 — discriminator. ''mini_test'' rows carry an authored '
    'exercise_ids array; ''free_practice'' rows are placeholders for future '
    'skill-mode session grouping.';

COMMENT ON COLUMN listening_sessions.exercise_ids IS
    'Sprint 11.5 — ordered list of listening_exercises.id forming the mini '
    'test lineup. UUID[] preserves Postgres-native ordering vs serializing '
    'to JSONB; admin reorder mutates the array in place.';

COMMENT ON COLUMN listening_sessions.ordered_position IS
    'Sprint 11.5 — per-exercise scaffold metadata (section label, etc.) '
    'parallel to exercise_ids by index. Shape: [{exercise_id, section, '
    'label}, ...]. JSONB lets the builder UI evolve without DDL.';
