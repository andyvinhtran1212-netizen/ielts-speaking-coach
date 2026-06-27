-- 113 — atomic session-token accumulation (B5 / Mục 15).
--
-- grading._increment_tokens used a read-then-write (SELECT tokens_used → add →
-- UPDATE), which loses increments when two responses in the same session are
-- graded concurrently. This RPC does the add in a single atomic UPDATE so the
-- accumulation is correct under concurrency.
--
-- Idempotent: CREATE OR REPLACE. Caller (grading.py) treats the call as
-- best-effort, so deploys that haven't applied this migration yet simply skip
-- token tracking rather than erroring.

CREATE OR REPLACE FUNCTION increment_session_tokens(p_session_id uuid, p_delta integer)
RETURNS integer
LANGUAGE sql
-- Pin search_path so a malicious one can't shadow `sessions` (matches the function
-- hardening in migration 108).
SET search_path = public, pg_temp
AS $$
  UPDATE sessions
     SET tokens_used = COALESCE(tokens_used, 0) + p_delta
   WHERE id = p_session_id
  RETURNING tokens_used;
$$;
