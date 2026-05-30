-- 089_admin_dashboard_grading_minutes_rpc.sql
--
-- admin-dashboard-redesign — perf fix for the Dashboard's cumulative
-- "Phút chấm (tích lũy)" metric.
--
-- Before: compute_dashboard_overview()._grading_minutes() fetched EVERY
-- responses.duration_seconds row over the wire and summed in Python — an
-- unbounded scan that grows forever with usage (a Perf-Phase-2 "slow
-- dashboard-init" cause). This function returns the SUM server-side as a
-- single number, so no rows cross the wire.
--
-- STABLE + admin-only: the backend calls it via the service-role key
-- (supabase_admin). The endpoint behind it (GET /admin/dashboard/overview)
-- already require_admin()s. The python caller falls back to the old in-app
-- sum if this function is absent (pre-apply), so deploy ordering is safe
-- (Lesson 11 — deploy & apply).

CREATE OR REPLACE FUNCTION fn_total_grading_minutes()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
    SELECT ROUND(COALESCE(SUM(duration_seconds), 0) / 60.0, 1)
    FROM responses
$$;
