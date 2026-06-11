-- 096_drop_unused_094_indexes.sql
--
-- Revert migration 094 (#417): drop the 5 indexes it added. Round-2 review +
-- a live pg_stat_user_indexes check (2026-06-11) show all 5 have idx_scan = 0
-- (never chosen by the planner) and no query path needs them, so they are pure
-- dead weight. The GIN index on analytics_events.event_data is the priority:
-- analytics_events is a hot INSERT table (services/analytics.py fire_event) and
-- a GIN index taxes every write while serving zero reads (no JSONB @> / -> query
-- exists in the app).
--
-- IMPORTANT NAME NOTE (verify-first): the 094 SOURCE FILE created these under
-- the names idx_analytics_events_data_gin and idx_analytics_events_name_user_created,
-- but the LIVE database has them under idx_analytics_event_data_gin and
-- idx_analytics_event_user_time (singular "event"; the file and the deployed DB
-- diverged at apply time). The live names below are the authoritative ones,
-- taken from pg_stat_user_indexes on prod -- dropping the file's names would be a
-- silent no-op and leave the dead GIN in place. The other three names match the
-- file. Live idx_scan at verification: all five = 0.
--
-- KEEP (do NOT drop) -- these analytics_events indexes ARE used:
--   idx_analytics_events_created_at  (idx_scan=93)
--   idx_analytics_events_event_name  (idx_scan=18)
--
-- APPLY FORM: plain DROP INDEX IF EXISTS (no CONCURRENTLY). Same reasoning as
-- migration 094's CREATE: this is applied BY HAND in the Supabase SQL editor,
-- which may wrap the script in a transaction -- and DROP INDEX CONCURRENTLY
-- cannot run inside a transaction block. The target tables are small
-- (analytics_events ~3k rows), so the brief ACCESS EXCLUSIVE lock from a plain
-- DROP is negligible. If you prefer CONCURRENTLY to avoid any lock on the hot
-- table, run EACH statement on its own (one DROP INDEX CONCURRENTLY per editor
-- run, NOT wrapped in BEGIN/COMMIT). Forward-only; migration 094 is NOT edited.
--
-- Apply: run manually (no migration runner; merging this PR does NOT execute SQL).

DROP INDEX IF EXISTS idx_analytics_event_data_gin;
DROP INDEX IF EXISTS idx_analytics_event_user_time;
DROP INDEX IF EXISTS idx_grammar_rec_session;
DROP INDEX IF EXISTS idx_uca_assigned_by;
DROP INDEX IF EXISTS idx_writing_assignments_assigned_by;

-- ROLLBACK (recreate from migration 094's intent; tables are small so plain
-- CREATE is fine). NOTE the live-vs-file name divergence above: recreate under
-- whichever names the consuming queries expect. The original 094 statements:
--   CREATE INDEX IF NOT EXISTS idx_grammar_rec_session
--     ON grammar_recommendations (session_id);
--   CREATE INDEX IF NOT EXISTS idx_analytics_event_user_time
--     ON analytics_events (event_name, user_id, created_at);
--   CREATE INDEX IF NOT EXISTS idx_analytics_event_data_gin
--     ON analytics_events USING GIN (event_data);
--   CREATE INDEX IF NOT EXISTS idx_writing_assignments_assigned_by
--     ON writing_assignments (assigned_by);
--   CREATE INDEX IF NOT EXISTS idx_uca_assigned_by
--     ON user_code_assignments (assigned_by);
