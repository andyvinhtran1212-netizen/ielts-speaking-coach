-- Migration: 137_listening_audit.sql
-- Listening content audit — one row per test tracking the last audit run
-- (structural + audio-bounds + LLM content checks) so admins can review,
-- fix in place, and re-check without re-importing the whole test.
-- Forward-only. The per-test health/issues ride JSONB (no child table);
-- per-question fixes write straight into listening_exercises.payload.

CREATE TABLE IF NOT EXISTS listening_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id     UUID NOT NULL UNIQUE REFERENCES listening_tests(id) ON DELETE CASCADE,

    -- Roll-up state for the audit dashboard.
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending',     -- never audited
                    'passed',      -- last run: no error-severity issues
                    'has_issues',  -- last run: >=1 error-severity issue
                    'fixed'        -- admin marked resolved after fixing
                )),

    -- Last computed report. health = {structural, audio, llm, counts, ran_at}.
    health      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- issues = [{q_num, dimension, severity, code, message, resolved}].
    issues      JSONB NOT NULL DEFAULT '[]'::jsonb,

    auditor     TEXT,                        -- admin id/email who last ran/triaged
    audited_at  TIMESTAMPTZ,                 -- last full run (POST .../audit/run)
    notes       TEXT,                        -- free-form reviewer notes
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listening_audit_status ON listening_audit(status);
