-- ============================================================================
-- Migration 174 — fn_insert_listening_answer_once (first-attempt-wins write)
-- ============================================================================
--
-- The Luyện nhanh runner (POST /tests/attempts/{id}/check) lets a learner
-- answer the SAME question repeatedly, replaying that question's audio window
-- until they get it. Scoring stays honest by recording only the FIRST answer:
-- a question missed on the first listen counts as missed, however many retries
-- follow. That is the same rule dictation has used since Sprint 10.3, and it is
-- the only thing keeping the attempt score — and every report built on it
-- (band_estimate, trap_analytics, the admin attempts screen) — meaningful. With
-- last-answer-wins everyone converges on 100% and "which trap do learners fall
-- for" becomes an empty question.
--
-- fn_upsert_listening_answer (mig 161) cannot express this: it always
-- overwrites. Doing "read answers, write only if q_num absent" in Python
-- reintroduces exactly the race mig 161 was written to kill — two retries of
-- the same question in flight together both read "no answer yet", both write,
-- and the SECOND (a later, likely better-informed guess) becomes the canonical
-- "first" one. Rare, but it silently inflates the score, which is the specific
-- failure this rule exists to prevent. So the read and the write happen inside
-- one statement, with the absence check in the WHERE clause.
--
-- Returns:
--   TRUE   — this call recorded the canonical first answer
--   FALSE  — an answer for that q_num already existed; nothing was written
--   NULL   — no matching attempt, or it is no longer in_progress
-- The caller must distinguish all three: FALSE is a normal retry, NULL is an
-- error worth surfacing.
--
-- Idempotent: CREATE OR REPLACE. Apply by hand (psql / Supabase SQL editor).
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_insert_listening_answer_once(
    p_attempt_id  uuid,
    p_q_num       integer,
    p_user_answer text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exists  boolean;
    v_written boolean;
BEGIN
    -- Guard first so "attempt missing / already submitted" (NULL) stays
    -- distinguishable from "already answered" (FALSE). Without this, both
    -- collapse into a non-matching UPDATE and the caller cannot tell a finished
    -- attempt from an ordinary retry.
    SELECT EXISTS (
               SELECT 1 FROM jsonb_array_elements(a.answers) AS e
                WHERE e->>'q_num' IS NOT DISTINCT FROM p_q_num::text)
      INTO v_exists
      FROM listening_test_attempts a
     WHERE a.id = p_attempt_id
       AND a.status = 'in_progress';

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_exists THEN
        RETURN FALSE;
    END IF;

    -- The absence test is repeated inside the UPDATE, so a concurrent retry
    -- that slipped between the SELECT and here still cannot append a second
    -- answer for the same question.
    UPDATE listening_test_attempts a
       SET answers = COALESCE(a.answers, '[]'::jsonb) || jsonb_build_array(
                         jsonb_build_object(
                             'q_num',       p_q_num,
                             'user_answer', COALESCE(p_user_answer, ''),
                             'answered_at', to_jsonb(NOW())))
     WHERE a.id = p_attempt_id
       AND a.status = 'in_progress'
       AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(COALESCE(a.answers, '[]'::jsonb)) AS e
                WHERE e->>'q_num' IS NOT DISTINCT FROM p_q_num::text)
    RETURNING TRUE INTO v_written;

    -- Lost the race → an answer now exists and it is not ours. Still FALSE:
    -- from the caller's side this is indistinguishable from a plain retry, and
    -- both mean "the canonical answer was not written by this call".
    RETURN COALESCE(v_written, FALSE);
END;
$$;

-- ── Lock it down ────────────────────────────────────────────────────────────
-- Same reasoning as mig 161: PostgreSQL grants EXECUTE to PUBLIC by default,
-- and this SECURITY DEFINER function bypasses RLS plus the router's ownership
-- check. Backend only.
REVOKE EXECUTE ON FUNCTION public.fn_insert_listening_answer_once(uuid, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_insert_listening_answer_once(uuid, integer, text)
    TO service_role;

COMMENT ON FUNCTION fn_insert_listening_answer_once(uuid, integer, text) IS
'Append ONE answer to listening_test_attempts.answers only if that q_num has no
answer yet (first-attempt-wins, Luyện nhanh runner). TRUE = recorded, FALSE =
already answered / lost the race, NULL = no in_progress attempt matched.
service_role ONLY — SECURITY DEFINER, bypasses RLS by design.';
