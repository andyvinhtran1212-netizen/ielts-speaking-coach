-- Migration: 075_grammar_check_infra.sql
-- Sprint 14.8 — Grammar checker integration infrastructure.
--
-- Two related changes that ship together:
--
--   1) Extend the Sprint 14.7 `grading_events.event_kind` CHECK list
--      to allow 'grammar_check' so the new service can persist its
--      fallback/timeout events to the existing audit table.
--
--   2) Create `grammar_check_cache` — a small Supabase-backed cache
--      keyed by SHA256(transcript) with 24h TTL. Mirrors the Sprint
--      14.6.2 cache pattern (question_cache table) but kept in its
--      own namespace because the value shape (list of normalised
--      grammar errors) is unrelated to question_cache rows.
--
-- Idempotent — re-runnable on top of an already-migrated 074 + missing
-- 075 state. The constraint name pattern follows PostgreSQL defaults so
-- existing/repeated migrations stay safe.


-- ── 1) Extend event_kind CHECK ─────────────────────────────────────────────

ALTER TABLE grading_events
    DROP CONSTRAINT IF EXISTS grading_events_event_kind_check;

ALTER TABLE grading_events
    ADD CONSTRAINT grading_events_event_kind_check
    CHECK (event_kind IN ('grading', 'off_topic_judge', 'grammar_check'));


-- ── 2) grammar_check_cache table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grammar_check_cache (
    id             UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_sha TEXT                     NOT NULL UNIQUE,
    payload        JSONB                    NOT NULL,
    error_count    INTEGER                  NOT NULL DEFAULT 0,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- TTL queries hit (created_at < now() - 24h); the timestamp index
-- supports both reads and the eventual cleanup job. DESC matches the
-- "newest first" access pattern the service uses on hash collisions
-- (treat the freshest cache row as canonical).
CREATE INDEX IF NOT EXISTS idx_grammar_check_cache_created_at
    ON grammar_check_cache (created_at DESC);

COMMENT ON TABLE grammar_check_cache IS
    'Sprint 14.8 — caches GrammarCheckService.check() output keyed by '
    'SHA256(transcript). 24h TTL applied at read time. Cleanup is best-'
    'effort; stale rows are harmless beyond row count.';

COMMENT ON COLUMN grammar_check_cache.transcript_sha IS
    'Hex-encoded SHA256 of the normalised (lowercased, stripped) transcript.';

COMMENT ON COLUMN grammar_check_cache.payload IS
    'Serialised GrammarCheckResult — {errors: [...], total_count, displayed_count}.';
