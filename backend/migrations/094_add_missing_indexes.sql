-- 094_add_missing_indexes.sql
--
-- P1-3 / C-2.1 audit — add missing FK / GIN indexes.
--
-- PLAIN CREATE INDEX (NO CONCURRENTLY) is intentional: this migration is applied
-- BY HAND via the Supabase SQL editor (this repo has no migration runner), which
-- may wrap statements in a transaction — and CREATE INDEX CONCURRENTLY errors
-- inside a transaction. Every target table is small (measured 2026-06-09:
-- analytics_events 2 854, grammar_recommendations 2 980, user_code_assignments
-- 24, writing_assignments 6), so the brief ACCESS EXCLUSIVE lock is negligible
-- (the audit's accepted fallback). Forward-only + idempotent (IF NOT EXISTS);
-- no BEGIN/COMMIT; no old migration modified.
--
-- Skipped (already indexed): analytics_events(event_name,created_at)/created_at/
-- user_id/name_created; grammar_recommendations(response_id)/(user_id);
-- user_code_assignments(code_id)/(user_id); writing_assignments
-- student/prompt/status/deadline.
--
-- Apply: run manually (no migration runner; merging a PR does NOT execute SQL).

-- FK lookup: grammar recommendations by session (joined per session in review).
CREATE INDEX IF NOT EXISTS idx_grammar_rec_session
  ON grammar_recommendations (session_id);

-- Dashboard: per-user event funnels within a time window.
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_user_created
  ON analytics_events (event_name, user_id, created_at);

-- Ad-hoc filtering inside the JSONB event payload.
CREATE INDEX IF NOT EXISTS idx_analytics_events_data_gin
  ON analytics_events USING GIN (event_data);

-- FK lookup: writing assignments created by a given admin.
CREATE INDEX IF NOT EXISTS idx_writing_assignments_assigned_by
  ON writing_assignments (assigned_by);

-- FK lookup: code assignments performed by a given admin.
CREATE INDEX IF NOT EXISTS idx_uca_assigned_by
  ON user_code_assignments (assigned_by);

-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_grammar_rec_session;
--   DROP INDEX IF EXISTS idx_analytics_events_name_user_created;
--   DROP INDEX IF EXISTS idx_analytics_events_data_gin;
--   DROP INDEX IF EXISTS idx_writing_assignments_assigned_by;
--   DROP INDEX IF EXISTS idx_uca_assigned_by;
