-- Migration 031: Codify ai_usage_logs table schema
-- Purpose: Source-control the observability schema that previously lived only
--          as a "run once in the SQL editor" comment block in
--          services/ai_usage_logger.py.  DR-friendly: a fresh staging or
--          recovery DB now reproduces the table without rummaging through
--          source comments.
--
-- Date:    2026-04-30
-- Related: Audit 2026-04-30 MEDIUM-1 finding ("ai_usage_logs schema not in
--          migration history despite being live in production").
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS — the existing production
-- table (~2870 rows at audit time) is preserved untouched.  Verify with
-- `\d ai_usage_logs` before applying to prod that the column types below
-- match the live schema.  The columns mirror the canonical block in
-- services/ai_usage_logger.py:9-26.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        REFERENCES users(id)    ON DELETE SET NULL,
    session_id          uuid        REFERENCES sessions(id) ON DELETE SET NULL,
    service             text        NOT NULL,
    model               text        NOT NULL,
    input_tokens        integer,
    output_tokens       integer,
    cache_read_tokens   integer,
    cache_write_tokens  integer,
    audio_seconds       real,
    text_chars          integer,
    cost_usd_est        real,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts
    ON ai_usage_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_service_ts
    ON ai_usage_logs (service, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created
    ON ai_usage_logs (created_at DESC);

COMMENT ON TABLE ai_usage_logs IS
'AI service usage tracking (cost analytics + observability). Codified into
migration 031 from services/ai_usage_logger.py comment block.  Insert path
swallows errors so logging failures never block primary operations.';

COMMIT;

-- ROLLBACK SCRIPT (commented; run manually only if rollback is intentional —
-- dropping the table loses production cost-tracking data):
--
-- BEGIN;
-- DROP INDEX IF EXISTS idx_ai_usage_user_ts;
-- DROP INDEX IF EXISTS idx_ai_usage_service_ts;
-- DROP INDEX IF EXISTS idx_ai_usage_created;
-- DROP TABLE IF EXISTS ai_usage_logs;
-- COMMIT;
