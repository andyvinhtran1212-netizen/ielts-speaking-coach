-- Migration: 073_grading_events.sql
-- Sprint 14.3 — AI provider fallback chain audit trail.
--
-- One row per orchestrator attempt per provider (services/grading_orchestrator.py).
-- Captures the why behind each fallback: which provider failed, with
-- what status, how long it took. Persisted best-effort by
-- services/grading_telemetry.log_fallback_events (never blocks grading).
--
-- Soft foreign keys (no REFERENCES) because:
--   * Failed-grading writes happen *before* the responses row is
--     persisted, so response_id can be NULL.
--   * The audit trail must survive even if the linked session/question/
--     response is later deleted by an admin operation.

CREATE TABLE IF NOT EXISTS grading_events (
    id            UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID,
    question_id   UUID,
    response_id   UUID,
    timestamp     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    provider      TEXT                     NOT NULL,
    attempt       INTEGER                  NOT NULL,
    outcome       TEXT                     NOT NULL
                  CHECK (outcome IN ('success', 'retryable_error', 'non_retryable')),
    error_status  TEXT,
    error_type    TEXT,
    latency_ms    INTEGER                  NOT NULL DEFAULT 0,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Time-series queries (e.g. "fallback rate over the last 24h") + the
-- DESC sort matches the dominant access pattern of "show me the most
-- recent N events".
CREATE INDEX IF NOT EXISTS idx_grading_events_timestamp
    ON grading_events (timestamp DESC);

-- Per-provider analytics (e.g. "what's Haiku's failure rate?").
CREATE INDEX IF NOT EXISTS idx_grading_events_provider_outcome
    ON grading_events (provider, outcome);

-- Per-session lookup — admin "regrade" flow surfaces this in the
-- response-detail panel (Sprint 14.7+).
CREATE INDEX IF NOT EXISTS idx_grading_events_session_id
    ON grading_events (session_id)
    WHERE session_id IS NOT NULL;
