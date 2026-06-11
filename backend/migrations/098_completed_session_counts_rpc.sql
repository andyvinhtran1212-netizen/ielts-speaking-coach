-- Migration: 098_completed_session_counts_rpc.sql
-- Mã kích hoạt — FIX session-count: admin ≠ enforcement (students locked unfairly).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- The admin codes list shows a per-user session quota. It counted "used" with a
-- single batched `sessions.select(user_id).in_(all_uids)` query — but PostgREST
-- caps results at db-max-rows (1000), so with >1000 sessions the count was
-- TRUNCATED → admin under-reported "used" → inflated "remaining" (a student
-- showing 60+ left while enforcement, which counts accurately per-user, blocked
-- them). It also counted ALL sessions including abandoned in_progress.
--
-- This GROUP BY runs server-side and returns one row per user — no 1000-row cap,
-- no N+1 — counting only status='completed' (the canonical "used" unit, matching
-- get_user_session_quota / create_session enforcement). Mirrors mig 089's RPC
-- pattern. The Python caller (get_completed_session_counts) falls back to a
-- per-user count='exact' if this function is absent, so deploy ordering is safe
-- (Lesson 11 — deploy & apply).

CREATE OR REPLACE FUNCTION fn_completed_session_counts(p_uids uuid[])
RETURNS TABLE(user_id uuid, n bigint)
LANGUAGE sql
STABLE
AS $$
    SELECT s.user_id, COUNT(*)::bigint
    FROM sessions s
    WHERE s.user_id = ANY(p_uids)
      AND s.status = 'completed'
    GROUP BY s.user_id
$$;

-- ── Reverse (run manually if needed) ──────────────────────────────────────────
-- DROP FUNCTION IF EXISTS fn_completed_session_counts(uuid[]);
