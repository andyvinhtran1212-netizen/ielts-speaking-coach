-- 114 — per-user grading-attempt log for a daily rate limit (B5 / Mục 5).
--
-- POST /sessions/{id}/responses runs the expensive Whisper + Claude pipeline and
-- had NO per-user cap, so one account could spam it (re-record the same question
-- 100×, bypassing the per-day SESSION quota). The `responses` table can't be
-- counted for this — it's one row per (session_id, question_id), has no user_id,
-- and re-submits UPDATE in place — so attempts are tracked here instead.
--
-- Fail-open: the counter query returns 0 on error and the insert is best-effort,
-- so a deploy that hasn't applied this migration yet just runs without the cap
-- rather than blocking grading.

CREATE TABLE IF NOT EXISTS grading_attempts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
);

-- Supports the "count this user's attempts since UTC midnight" query.
CREATE INDEX IF NOT EXISTS idx_grading_attempts_user_day
    ON grading_attempts (user_id, attempted_at);

-- RLS: this is a BACKEND-ONLY quota log. Enable RLS with NO policy so service_role
-- (the backend — BYPASSRLS) keeps full access while anon/authenticated fall through
-- to RLS's default deny-all. Without this, a Supabase client could read other
-- users' grading activity AND insert quota rows for arbitrary user_ids — tripping
-- the daily grading cap for the wrong account. (Mirrors the audit-table hardening
-- in migration 108.)
ALTER TABLE public.grading_attempts ENABLE ROW LEVEL SECURITY;
-- Rollback: ALTER TABLE public.grading_attempts DISABLE ROW LEVEL SECURITY;
