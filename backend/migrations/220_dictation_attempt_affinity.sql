-- Migration: 220_dictation_attempt_affinity.sql
--
-- Durable in-progress state for test-linked Listening Dictation. Completion
-- receipts (migration 210) only protect the final POST; they cannot resume a
-- learner who reloads after grading sentence 3 of 12, nor pin that active run
-- to the Legacy/Next renderer that first opened it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dictation_attempts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    test_id            UUID NOT NULL REFERENCES public.listening_tests(id) ON DELETE CASCADE,
    section_num        INTEGER NOT NULL CHECK (section_num >= 1),
    status             TEXT NOT NULL DEFAULT 'in_progress'
                       CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    units_snapshot     JSONB NOT NULL
                       CHECK (jsonb_typeof(units_snapshot) = 'array'
                              AND jsonb_array_length(units_snapshot) > 0),
    renderer_affinity  TEXT DEFAULT 'legacy'
                       CHECK (renderer_affinity IN ('legacy', 'next')),
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dictation_attempts_one_active_section
    ON public.dictation_attempts (user_id, test_id, section_num)
    WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS ix_dictation_attempts_user_updated
    ON public.dictation_attempts (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.dictation_attempt_answers (
    attempt_id         UUID NOT NULL REFERENCES public.dictation_attempts(id) ON DELETE CASCADE,
    sentence_idx       INTEGER NOT NULL CHECK (sentence_idx >= 0),
    user_transcript    TEXT NOT NULL DEFAULT '',
    score              NUMERIC(5,4) NOT NULL CHECK (score >= 0 AND score <= 1),
    correct_words      INTEGER NOT NULL CHECK (correct_words >= 0),
    total_words        INTEGER NOT NULL CHECK (total_words >= 0),
    diff               JSONB NOT NULL DEFAULT '[]'::jsonb,
    listen_count       INTEGER NOT NULL DEFAULT 0 CHECK (listen_count >= 0),
    time_seconds       INTEGER CHECK (time_seconds >= 0),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (attempt_id, sentence_idx),
    CHECK (correct_words <= total_words)
);

CREATE OR REPLACE FUNCTION public.fn_guard_dictation_attempt_answer_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    parent_status text;
BEGIN
    -- The row lock serializes a sentence save with finalization. A save that
    -- starts after finalization must not rewrite the canonical completed run.
    SELECT status INTO parent_status
      FROM public.dictation_attempts
     WHERE id = NEW.attempt_id
     FOR UPDATE;

    IF parent_status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'dictation_attempt_not_in_progress'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_dictation_attempt_answer_mutation
    ON public.dictation_attempt_answers;
CREATE TRIGGER trg_guard_dictation_attempt_answer_mutation
    BEFORE INSERT OR UPDATE ON public.dictation_attempt_answers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_dictation_attempt_answer_mutation();

ALTER TABLE public.dictation_sessions
    ADD COLUMN IF NOT EXISTS attempt_id UUID
        REFERENCES public.dictation_attempts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dictation_sessions_attempt
    ON public.dictation_sessions (attempt_id)
    WHERE attempt_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_finalize_dictation_attempt_from_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    attempt_row public.dictation_attempts%ROWTYPE;
    answer_count integer;
    result_count integer;
    distinct_result_count integer;
BEGIN
    IF NEW.attempt_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Lock the parent in the same transaction that inserts the report. This
    -- closes the validate/insert/update race between two browser tabs.
    SELECT * INTO attempt_row
      FROM public.dictation_attempts
     WHERE id = NEW.attempt_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'dictation_attempt_not_found'
            USING ERRCODE = '23503';
    END IF;

    -- A concurrent replay should reach the unique attempt index so the API can
    -- reconcile to the already committed session instead of returning 500.
    IF attempt_row.status = 'completed' AND EXISTS (
        SELECT 1 FROM public.dictation_sessions s
         WHERE s.attempt_id = NEW.attempt_id
    ) THEN
        RETURN NEW;
    END IF;

    IF attempt_row.status <> 'in_progress'
       OR attempt_row.user_id <> NEW.user_id
       OR attempt_row.test_id IS DISTINCT FROM NEW.test_id
       OR attempt_row.section_num IS DISTINCT FROM NEW.section_num THEN
        RAISE EXCEPTION 'dictation_attempt_not_in_progress'
            USING ERRCODE = '55000';
    END IF;
    IF jsonb_typeof(NEW.results) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'dictation_attempt_payload_mismatch'
            USING ERRCODE = '55000';
    END IF;

    SELECT count(*) INTO answer_count
      FROM public.dictation_attempt_answers a
     WHERE a.attempt_id = NEW.attempt_id;
    result_count := jsonb_array_length(NEW.results);
    SELECT count(DISTINCT (item->>'sentence_idx')::integer)
      INTO distinct_result_count
      FROM jsonb_array_elements(NEW.results) AS item;

    IF answer_count <> result_count OR result_count <> distinct_result_count
       OR EXISTS (
            SELECT 1
              FROM public.dictation_attempt_answers a
              LEFT JOIN LATERAL (
                  SELECT item
                    FROM jsonb_array_elements(NEW.results) AS item
                   WHERE (item->>'sentence_idx')::integer = a.sentence_idx
                   LIMIT 1
              ) submitted ON true
             WHERE a.attempt_id = NEW.attempt_id
               AND (
                   submitted.item IS NULL
                   OR a.user_transcript IS DISTINCT FROM submitted.item->>'user_text'
                   OR a.score IS DISTINCT FROM (submitted.item->>'score')::numeric
                   OR a.correct_words IS DISTINCT FROM (submitted.item->>'correct_words')::integer
                   OR a.total_words IS DISTINCT FROM (submitted.item->>'total_words')::integer
                   OR a.diff IS DISTINCT FROM submitted.item->'diff'
                   OR a.listen_count IS DISTINCT FROM (submitted.item->>'listen_count')::integer
                   OR a.time_seconds IS DISTINCT FROM (submitted.item->>'time_seconds')::integer
               )
       ) THEN
        RAISE EXCEPTION 'dictation_attempt_payload_mismatch'
            USING ERRCODE = '55000';
    END IF;

    UPDATE public.dictation_attempts
       SET status = 'completed',
           completed_at = COALESCE(NEW.completed_at, now()),
           updated_at = COALESCE(NEW.completed_at, now())
     WHERE id = NEW.attempt_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finalize_dictation_attempt_from_session
    ON public.dictation_sessions;
CREATE TRIGGER trg_finalize_dictation_attempt_from_session
    BEFORE INSERT ON public.dictation_sessions
    FOR EACH ROW EXECUTE FUNCTION public.fn_finalize_dictation_attempt_from_session();

ALTER TABLE public.dictation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dictation_attempt_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own dictation attempts" ON public.dictation_attempts;
CREATE POLICY "users read own dictation attempts"
    ON public.dictation_attempts FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins read dictation attempts" ON public.dictation_attempts;
CREATE POLICY "admins read dictation attempts"
    ON public.dictation_attempts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = auth.uid() AND u.role = 'admin'
    ));

DROP POLICY IF EXISTS "users read own dictation attempt answers"
    ON public.dictation_attempt_answers;
CREATE POLICY "users read own dictation attempt answers"
    ON public.dictation_attempt_answers FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.dictation_attempts a
         WHERE a.id = attempt_id AND a.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "admins read dictation attempt answers"
    ON public.dictation_attempt_answers;
CREATE POLICY "admins read dictation attempt answers"
    ON public.dictation_attempt_answers FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = auth.uid() AND u.role = 'admin'
    ));

CREATE OR REPLACE FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(
    p_attempt_id uuid,
    p_user_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(attempt_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    UPDATE public.dictation_attempts AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity),
           updated_at = now()
     WHERE target.id = p_attempt_id
       AND target.user_id = p_user_id
       AND target.status = 'in_progress'
    RETURNING target.id, target.renderer_affinity;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(
    uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(
    uuid, uuid, text
) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guard_dictation_attempt_answer_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finalize_dictation_attempt_from_session()
    FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.dictation_attempts IS
    'Canonical in-progress test-linked Dictation runs with immutable grading units. Existing/unversioned clients default Legacy; claim-v1 inserts NULL until first stable player boot.';
COMMENT ON TABLE public.dictation_attempt_answers IS
    'Latest server-graded sentence state for a canonical Dictation attempt.';
COMMENT ON COLUMN public.dictation_sessions.attempt_id IS
    'Canonical attempt finalized by this completion report; unique when present.';
COMMENT ON FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(
    uuid, uuid, text
) IS
    'Atomically claim an owned in-progress Dictation renderer, or return its immutable existing claim; service-role backend only.';
COMMENT ON FUNCTION public.fn_finalize_dictation_attempt_from_session() IS
    'Atomically verifies canonical sentence state and completes an attempt inside the session insert transaction.';

NOTIFY pgrst, 'reload schema';

COMMIT;
