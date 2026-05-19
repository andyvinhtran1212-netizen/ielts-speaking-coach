-- Migration: 061_error_logs.sql
-- Sprint 12.3 — DEBT-ADMIN-IA-REFACTOR execution 3/8.
--
-- Custom error log table per Andy 2026-05-18 decision (c): no Sentry,
-- no SaaS, Andy owns the data. Replaces both Sentry-cloud and the
-- self-host Sentry alternatives discussed in Sprint 12.0 §6.2.
--
-- Capture path:
--   1. Backend unhandled exceptions → global FastAPI handler →
--      asyncio.create_task fire-and-forget INSERT (fail-soft: a failed
--      INSERT never escalates a 500 into a hang).
--   2. Frontend window.onerror + unhandledrejection + manual
--      window.aver.reportError() → POST /api/error-logs.
--   3. Admin UI consumes via GET /admin/error-logs with dismissed/level/
--      source/user_id filters.
--
-- Idempotent: re-running is a no-op (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS error_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level         TEXT NOT NULL CHECK (level IN ('error', 'warning', 'info')),
    source        TEXT NOT NULL CHECK (source IN ('frontend', 'backend')),
    message       TEXT NOT NULL,
    stack         TEXT,
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    url           TEXT,
    user_agent    TEXT,
    request_id    TEXT,
    extra         JSONB,
    dismissed_at  TIMESTAMPTZ,
    dismissed_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_error_logs_occurred_at
    ON error_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_undismissed
    ON error_logs (occurred_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id
    ON error_logs (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_logs_level_source
    ON error_logs (level, source);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read all error logs" ON error_logs;
CREATE POLICY "Admins read all error logs" ON error_logs
    FOR SELECT USING (is_current_user_admin());

DROP POLICY IF EXISTS "Admins dismiss error logs" ON error_logs;
CREATE POLICY "Admins dismiss error logs" ON error_logs
    FOR UPDATE USING (is_current_user_admin());

-- Service role bypasses RLS for INSERT — backend uses supabase_admin client.
-- For authenticated user contexts that bypass the service role (e.g. a
-- supabase-js client on a future direct-from-frontend path), permit the
-- INSERT only if source='frontend' AND user_id matches the auth uid
-- (or is NULL for anonymous reporting). Today, both inserts (backend
-- handler + POST /api/error-logs) flow through supabase_admin, so this
-- policy is forward-compat — it doesn't gate any current path.
DROP POLICY IF EXISTS "Authenticated users can report own errors" ON error_logs;
CREATE POLICY "Authenticated users can report own errors" ON error_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        source = 'frontend'
        AND (user_id IS NULL OR user_id = auth.uid())
    );

COMMENT ON COLUMN error_logs.request_id IS
    'Frontend-generated UUID propagated as X-Request-ID header on backend calls. '
    'Used to correlate frontend exception → backend log if the error came from '
    'an API call.';

COMMENT ON COLUMN error_logs.extra IS
    'Free-form JSONB for context: component name, route, props, browser version. '
    'Frontend reporter populates with filename/line/col; backend handler uses for '
    'request method + non-sensitive query params.';

COMMENT ON COLUMN error_logs.dismissed_at IS
    'Sprint 12.3 — admin marks a log dismissed once they''ve triaged it. '
    'Idempotent — re-dismiss is a no-op (admin endpoint just resets the timestamp).';
