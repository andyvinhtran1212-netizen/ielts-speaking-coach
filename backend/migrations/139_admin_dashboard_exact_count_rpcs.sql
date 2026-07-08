-- 139_admin_dashboard_exact_count_rpcs.sql
--
-- dashboard-counter-audit — the admin Dashboard (GET /admin/dashboard/overview
-- + /trends) computed several metrics by fetching rows and counting/summing in
-- Python. PostgREST caps a select at 1000 rows by default, so once these tables
-- grew past 1000 the numbers silently truncated:
--   • "Người xem"  — fetched page_view rows → len(distinct)+sum (capped)
--   • "Token đã gọi" — fetched ai_usage_logs → sum (capped)
--   • all 3 trend series (visitors/practices/tokens) — fetched → bucket (capped)
--
-- These functions push the COUNT(DISTINCT) / SUM / GROUP-BY-day server-side so
-- no rows cross the wire and the counts are exact regardless of table size.
-- STABLE + called via the service-role key (supabase_admin); the endpoint
-- (GET /admin/dashboard/*) already require_admin()s. The python caller falls
-- back to the old in-app aggregation if a function is absent (pre-apply), so
-- deploy ordering is safe (Lesson 11 — deploy & apply).
--
-- Each function pins `SET search_path = public, pg_temp` — these reference
-- unqualified tables, so an unpinned/mutable search_path could resolve them to
-- shadowed objects (Supabase hardening requirement — see 108/113 + README).
--
-- Day bucketing uses (ts AT TIME ZONE 'UTC')::date to match the Python
-- `created_at[:10]` UTC-date bucketing exactly.

-- 1) Visitors tile — authenticated distinct users + anonymous hits, one window.
CREATE OR REPLACE FUNCTION fn_dashboard_visitors(p_since timestamptz)
RETURNS TABLE(authenticated bigint, anonymous bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS authenticated,
        COUNT(*)               FILTER (WHERE user_id IS NULL)      AS anonymous
    FROM analytics_events
    WHERE event_name = 'page_view'
      AND created_at >= p_since
$$;

-- 2) Tokens-called tile — SUM(input+output) over the window.
CREATE OR REPLACE FUNCTION fn_dashboard_tokens_called(p_since timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint
    FROM ai_usage_logs
    WHERE created_at >= p_since
$$;

-- 3) Daily visitors series — per-day (auth distinct + anon hits).
CREATE OR REPLACE FUNCTION fn_dashboard_daily_visitors(p_since timestamptz)
RETURNS TABLE(day date, value bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        (created_at AT TIME ZONE 'UTC')::date AS day,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)
          + COUNT(*)            FILTER (WHERE user_id IS NULL) AS value
    FROM analytics_events
    WHERE event_name = 'page_view'
      AND created_at >= p_since
    GROUP BY 1
$$;

-- 4) Daily completed-practices series.
CREATE OR REPLACE FUNCTION fn_dashboard_daily_practices(p_since timestamptz)
RETURNS TABLE(day date, value bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        (completed_at AT TIME ZONE 'UTC')::date AS day,
        COUNT(*) AS value
    FROM sessions
    WHERE status = 'completed'
      AND completed_at >= p_since
    GROUP BY 1
$$;

-- 5) Daily tokens-called series.
CREATE OR REPLACE FUNCTION fn_dashboard_daily_tokens(p_since timestamptz)
RETURNS TABLE(day date, value bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        (created_at AT TIME ZONE 'UTC')::date AS day,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS value
    FROM ai_usage_logs
    WHERE created_at >= p_since
    GROUP BY 1
$$;
