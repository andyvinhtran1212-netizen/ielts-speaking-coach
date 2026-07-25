-- ============================================================================
-- Migration 161 — fn_upsert_listening_answer (A4b: atomic answer write)
-- ============================================================================
--
-- routers/listening.py's PATCH /tests/attempts/{id}/answers does a
-- read-modify-write of the WHOLE `answers` JSONB array in Python:
--
--     answers = attempt["answers"]              -- read
--     answers = [a for a in answers if ...]     -- modify
--     .update({"answers": answers})             -- write
--
-- Two answers saved at the same moment (different q_num — the client debounces
-- per question, so this is the normal case, not an edge one) both read the same
-- array and both write their own version back. The second write wins and the
-- first student's answer is GONE, with no error anywhere.
--
-- Reading is immune because it stores one ROW per (attempt, q_num) in
-- reading_attempt_answers (mig 088). Moving Listening to the same shape is the
-- structurally cleaner fix, but it drags a backfill plus every read path
-- (grading, review, audit, admin export) along with it. Doing the whole
-- read-modify-write inside ONE statement closes the race with a diff small
-- enough to review, and matches the precedent already in this repo
-- (fn_upsert_kp_mastery mig 132, the exact-count RPCs in mig 139).
--
-- Also enforces status = 'in_progress' at the DB level, so a submitted attempt
-- cannot be edited even if a caller skips the router's check.
--
-- Returns the new answer count, or NULL when no row matched (missing attempt,
-- or one that is no longer in progress) so the caller can tell the two apart.
--
-- Idempotent: CREATE OR REPLACE. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_upsert_listening_answer(
    p_attempt_id  uuid,
    p_q_num       integer,
    p_user_answer text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE listening_test_attempts a
       SET answers = (
               SELECT COALESCE(
                          jsonb_agg(s.x ORDER BY
                              -- Tolerant sort: real data stores q_num as a JSON
                              -- number, but anything unparseable is parked at
                              -- the end rather than crashing the write or being
                              -- silently dropped.
                              CASE WHEN s.x->>'q_num' ~ '^[0-9]+$'
                                   THEN (s.x->>'q_num')::int
                                   ELSE 2147483647 END),
                          '[]'::jsonb)
                 FROM (
                          -- everything EXCEPT the question being written.
                          -- Compared as text so a number and a string form of
                          -- the same q_num both match, without a cast that
                          -- could throw on malformed data.
                          SELECT e AS x
                            FROM jsonb_array_elements(a.answers) AS e
                           WHERE e->>'q_num' IS DISTINCT FROM p_q_num::text
                          UNION ALL
                          SELECT jsonb_build_object(
                                     'q_num',       p_q_num,
                                     'user_answer', COALESCE(p_user_answer, ''),
                                     'answered_at', to_jsonb(NOW()))
                      ) s
           )
     WHERE a.id = p_attempt_id
       AND a.status = 'in_progress'
    RETURNING jsonb_array_length(a.answers) INTO v_count;

    RETURN v_count;   -- NULL when nothing matched
END;
$$;

COMMENT ON FUNCTION fn_upsert_listening_answer(uuid, integer, text) IS
'Atomically upsert ONE answer into listening_test_attempts.answers (A4b).
Replaces the Python read-modify-write of the whole JSONB array, which lost
answers whenever two questions were saved concurrently. Only touches an
in_progress attempt. Returns the new answer count, NULL if no row matched.';
