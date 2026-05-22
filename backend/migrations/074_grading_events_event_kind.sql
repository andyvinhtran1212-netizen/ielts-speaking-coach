-- Migration: 074_grading_events_event_kind.sql
-- Sprint 14.7 — Off-topic judge telemetry discriminator.
--
-- Sprint 14.3 (migration 073) created `grading_events` for the grading
-- provider fallback chain. Sprint 14.7 introduces a second LLM workflow
-- on the same fallback chain — the off-topic judge — and reuses the same
-- audit table so analytics ("how often does Haiku fail?") see one
-- coherent surface. The `event_kind` column distinguishes the two
-- workflows; future commissions (e.g. cluster 14.8 grammar checker
-- judge) extend the CHECK list rather than forking the schema.
--
-- Default `'grading'` keeps every historical row interpretable without
-- a backfill. The NOT NULL + default pair guarantees new INSERTs land
-- correctly even from older codepaths that haven't been updated yet
-- (e.g. the existing log_fallback_events call in claude_grader's
-- error path).

ALTER TABLE grading_events
    ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'grading'
    CHECK (event_kind IN ('grading', 'off_topic_judge'));

-- Per-kind analytics ("off-topic judge fallback rate over 7d") + the
-- DESC sort matches the existing dominant access pattern.
CREATE INDEX IF NOT EXISTS idx_grading_events_kind_timestamp
    ON grading_events (event_kind, timestamp DESC);

COMMENT ON COLUMN grading_events.event_kind IS
    'Sprint 14.7: distinguishes grading provider events from off-topic '
    'judge events. Future kinds extend the CHECK list.';
