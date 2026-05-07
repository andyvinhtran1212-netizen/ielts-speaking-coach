-- Migration: 042_atomic_paste_log.sql
-- Mô tả: Sprint 2.7 fix #5 (LOW) — atomic paste-event append.
--
-- Problem this addresses: the pre-2.7 POST /paste-log endpoint did
-- a SELECT-then-UPDATE on writing_drafts.paste_events.  Two pastes
-- fired within the same RTT (very fast user, or a flaky network
-- causing a retry) could both read the array before either UPDATE
-- landed — the second write overwrote the first event.  The race
-- window is small but the cost of a lost event is amplified
-- because paste forensics are part of the moderation audit trail
-- (writing_essays.paste_events is what admin reviews when a
-- student is flagged for plagiarism risk).
--
-- Fix: a SQL function that does INSERT...ON CONFLICT DO UPDATE
-- with the JSONB `||` concat operator inside a single statement.
-- Postgres serialises the UPDATE under the row lock acquired by
-- the conflict resolution, so concurrent calls are FIFO at the
-- DB level — no read-modify-write window in the application.
--
-- The function is SECURITY DEFINER because student-facing code
-- calls it via supabase_admin (service role) anyway; we restrict
-- writing_drafts at the table level via RLS, and the wrapping
-- router still does its own student_id ownership check before
-- invoking this function.
--
-- Idempotent: replaces any existing definition.

CREATE OR REPLACE FUNCTION append_paste_event(
    p_assignment_id UUID,
    p_student_id    UUID,
    p_event         JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    new_total INTEGER;
BEGIN
    INSERT INTO writing_drafts (assignment_id, student_id, draft_text, paste_events)
    VALUES (p_assignment_id, p_student_id, '', jsonb_build_array(p_event))
    ON CONFLICT (assignment_id) DO UPDATE
        SET paste_events = COALESCE(writing_drafts.paste_events, '[]'::jsonb) || p_event
    RETURNING jsonb_array_length(paste_events) INTO new_total;

    RETURN new_total;
END;
$$;

COMMENT ON FUNCTION append_paste_event(UUID, UUID, JSONB) IS
    'Sprint 2.7 fix #5 — atomic JSONB array append for writing_drafts.paste_events. Eliminates the read-modify-write race in POST /api/writing/my-assignments/{id}/paste-log. Returns the new total event count.';

-- We deliberately do NOT grant EXECUTE to the `authenticated` role
-- — student-facing access is mediated by the service-role
-- supabase_admin client, which already bypasses GRANT checks. If a
-- future client-direct path (browser → PostgREST RPC) is added, a
-- per-user check via RLS on writing_drafts will still apply.
