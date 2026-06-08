-- 091_add_sessions_tokens_used.sql
--
-- P2 audit fix — sessions.tokens_used is READ + WRITTEN by the grading pipeline
-- (routers/grading.py::_increment_tokens accumulates per-response token usage;
-- routers/admin.py sums it for the admin dashboard) but NO migration ever
-- created the column. Every update silently failed (caught by _increment_tokens'
-- best-effort try/except → "tokens_used update skipped (non-fatal)"), so token
-- tracking has been a no-op and the dashboard sum is always 0. This creates it.
--
-- estimated_cost_usd is added per the audit spec, BUT NOTE: no code currently
-- reads or writes sessions.estimated_cost_usd (the estimated_cost_usd values in
-- routers/listening.py / admin.py / exercises.py are computed API-response
-- fields, not this column). The column will therefore stay 0 until a write path
-- is wired — intentionally out of scope here (flagged in the PR).
--
-- Safety: ADD COLUMN with a CONSTANT default is a metadata-only change on
-- Postgres 11+ (no full-table rewrite; only a brief ACCESS EXCLUSIVE lock), so
-- it is safe with or without a surrounding transaction. No CONCURRENTLY (that
-- applies to CREATE INDEX, not ALTER TABLE ADD COLUMN). Forward-only +
-- idempotent via IF NOT EXISTS — re-runnable.
--
-- Apply: run manually in the Supabase SQL editor / psql (this repo has no
-- migration runner; merging a PR does NOT execute SQL).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,4) DEFAULT 0;

-- ROLLBACK:
--   ALTER TABLE sessions DROP COLUMN tokens_used;
--   ALTER TABLE sessions DROP COLUMN estimated_cost_usd;
