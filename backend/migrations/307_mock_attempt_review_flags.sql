-- Spec0016 FR-012. Canonical flags never replace answers/grades/timers.
-- Apply after306 (private immutable admission snapshots), before clients use
-- question-cas-v1. No backfill, historical regrade or production execution.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mock_attempt_review_flags (
    skill text NOT NULL CHECK (skill IN ('reading', 'listening')),
    attempt_id uuid NOT NULL,
    q_num integer NOT NULL CHECK (q_num BETWEEN 1 AND 40),
    question_id text NOT NULL CHECK (length(question_id) BETWEEN 1 AND 160),
    flagged boolean NOT NULL,
    revision bigint NOT NULL CHECK (revision >0),
    last_operation_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (skill, attempt_id, q_num)
);
ALTER TABLE public.mock_attempt_review_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_attempt_review_flags FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mock_attempt_review_flags TO service_role;
COMMENT ON TABLE public.mock_attempt_review_flags IS
    'Private backend-only per-attempt/question CAS flags, including false tombstones. No answers or grades. Polymorphic parent ownership and lifetime are checked under the parent row lock by the only client-facing write RPC.';

CREATE OR REPLACE FUNCTION public.fn_patch_mock_attempt_review_flag(
    p_skill text, p_attempt_id uuid, p_user_id uuid, p_anon_id text,
    p_q_num integer, p_flagged boolean, p_expected_revision bigint,
    p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    parent jsonb;
    snapshot jsonb;
    identity text;
    item_count integer;
    paper_id uuid;
    current_flag public.mock_attempt_review_flags%ROWTYPE;
    current_revision bigint :=0;
BEGIN
    IF p_skill IS NULL OR p_skill NOT IN ('reading', 'listening')
       OR p_q_num IS NULL OR p_q_num NOT BETWEEN 1 AND 40
       OR p_flagged IS NULL OR p_expected_revision IS NULL
       OR p_expected_revision <0 OR p_expected_revision >=9223372036854775807
       OR p_operation_id IS NULL THEN
        RAISE EXCEPTION 'review_flag_invalid_request' USING ERRCODE='22023';
    END IF;
    -- Match306's lock order: paper first, then the attempt. NOWAIT fails with
    -- a retryable error if an answer/finalization UPDATE already owns the row
    -- and its trigger is waiting for this paper lock; it never deadlocks or
    -- acknowledges a flag that did not commit. Recheck its paper
    -- identity under the row lock rather than trusting an unlocked lookup.
    IF p_skill='reading' THEN
        SELECT test_id INTO paper_id FROM public.reading_test_attempts WHERE id=p_attempt_id;
    ELSE
        SELECT test_id INTO paper_id FROM public.listening_test_attempts WHERE id=p_attempt_id;
    END IF;
    IF paper_id IS NOT NULL THEN
        PERFORM public.fn_lock_mock_paper(p_skill,paper_id);
    END IF;
    IF p_skill='reading' THEN
        SELECT to_jsonb(a) INTO parent FROM public.reading_test_attempts a
          WHERE a.id=p_attempt_id FOR UPDATE NOWAIT;
    ELSE
        SELECT to_jsonb(a) INTO parent FROM public.listening_test_attempts a
          WHERE a.id=p_attempt_id FOR UPDATE NOWAIT;
    END IF;
    IF parent IS NULL THEN
        RAISE EXCEPTION 'review_flag_attempt_missing' USING ERRCODE='P0002';
    END IF;
    IF parent->>'test_id' IS DISTINCT FROM paper_id::text THEN
        RAISE EXCEPTION 'review_flag_question_changed' USING ERRCODE='55000';
    END IF;
    IF NOT COALESCE(
        (p_user_id IS NOT NULL AND parent->>'user_id'=p_user_id::text)
        OR (p_skill='reading' AND p_user_id IS NULL AND p_anon_id IS NOT NULL
            AND parent->>'user_id' IS NULL AND parent->>'anon_id'=p_anon_id),false) THEN
        RAISE EXCEPTION 'review_flag_owner_mismatch' USING ERRCODE='42501';
    END IF;
    IF parent->>'status' IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'review_flag_attempt_closed' USING ERRCODE='55000';
    END IF;
    IF parent->>'resume_expires_at' IS NULL
       OR (parent->>'resume_expires_at')::timestamptz <=clock_timestamp() THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE='55000';
    END IF;
    -- Repeat the authenticated HTTP purpose decision in the same transaction:
    -- section changes/protected-reference mutations cannot race a CAS write.
    PERFORM public.fn_guard_owned_mock_attempt(p_skill,parent,'flags_write');

    -- New attempts use the source identity frozen in306. Legacy attempts are
    -- not captured/backfilled: their existing current-source identity is used
    -- only for flags, never claimed to reconstruct historic grading/context.
    IF parent->>'paper_revision' IS NOT NULL THEN
        SELECT to_jsonb(s) INTO snapshot FROM public.mock_paper_attempt_snapshots s
          WHERE s.skill=p_skill AND s.attempt_id=p_attempt_id;
        IF snapshot IS NULL THEN
            RAISE EXCEPTION 'review_flag_snapshot_missing' USING ERRCODE='55000';
        END IF;
        IF p_skill='reading' THEN
            SELECT count(*),min(r->>'id') INTO item_count,identity
              FROM jsonb_array_elements(snapshot->'marking_rows') r
              WHERE r->>'q_num'=p_q_num::text;
        ELSE
            SELECT count(*),min(COALESCE(q->>'id', q->>'question_id', (r->>'id')||':'||p_q_num::text))
              INTO item_count,identity FROM jsonb_array_elements(snapshot->'marking_rows') r
              CROSS JOIN LATERAL jsonb_array_elements(r->'payload'->'questions') q
              WHERE q->>'q_num'=p_q_num::text;
        END IF;
    ELSIF p_skill='reading' THEN
        SELECT count(*),min(q.id::text) INTO item_count,identity FROM public.reading_questions q
          JOIN public.reading_passages p ON p.id=q.passage_id
          WHERE p.test_id=(parent->>'test_id')::uuid AND p.library='l3_test' AND q.q_num=p_q_num;
    ELSE
        SELECT count(*),min(COALESCE(q->>'id', q->>'question_id', e.id::text||':'||p_q_num::text))
          INTO item_count,identity FROM public.listening_exercises e
          JOIN public.listening_content c ON c.id=e.content_id
          CROSS JOIN LATERAL jsonb_array_elements(e.payload->'questions') q
          WHERE c.test_id=(parent->>'test_id')::uuid AND q->>'q_num'=p_q_num::text;
    END IF;
    IF item_count<>1 OR identity IS NULL OR length(identity) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'review_flag_question_missing' USING ERRCODE='22023';
    END IF;

    SELECT * INTO current_flag FROM public.mock_attempt_review_flags f
      WHERE f.skill=p_skill AND f.attempt_id=p_attempt_id AND f.q_num=p_q_num;
    IF FOUND THEN
        current_revision:=current_flag.revision;
        IF current_flag.question_id IS DISTINCT FROM identity THEN
            RAISE EXCEPTION 'review_flag_question_changed' USING ERRCODE='55000';
        END IF;
        IF current_flag.last_operation_id=p_operation_id THEN
            IF current_flag.flagged IS DISTINCT FROM p_flagged THEN
                RAISE EXCEPTION 'review_flag_operation_reused' USING ERRCODE='22023';
            END IF;
            RETURN jsonb_build_object('attempt_id',p_attempt_id,'protocol','question-cas-v1',
                'q_num',p_q_num,'question_id',identity,'flagged',current_flag.flagged,
                'revision',current_revision,'updated_at',current_flag.updated_at,
                'operation_id',current_flag.last_operation_id,'accepted',true,'reason','replayed');
        END IF;
    END IF;
    IF p_expected_revision<>current_revision THEN
        RETURN jsonb_build_object('attempt_id',p_attempt_id,'protocol','question-cas-v1',
            'q_num',p_q_num,'question_id',identity,'flagged',COALESCE(current_flag.flagged,false),
            'revision',current_revision,'updated_at',current_flag.updated_at,
            'operation_id',COALESCE(current_flag.last_operation_id,p_operation_id),
            'accepted',false,'reason','conflict');
    END IF;
    INSERT INTO public.mock_attempt_review_flags(skill,attempt_id,q_num,question_id,
        flagged,revision,last_operation_id,updated_at)
      VALUES(p_skill,p_attempt_id,p_q_num,identity,p_flagged,current_revision+1,
        p_operation_id,clock_timestamp())
      ON CONFLICT(skill,attempt_id,q_num) DO UPDATE SET flagged=EXCLUDED.flagged,
        revision=EXCLUDED.revision,last_operation_id=EXCLUDED.last_operation_id,
        updated_at=EXCLUDED.updated_at RETURNING * INTO current_flag;
    RETURN jsonb_build_object('attempt_id',p_attempt_id,'protocol','question-cas-v1',
        'q_num',p_q_num,'question_id',identity,'flagged',current_flag.flagged,
        'revision',current_flag.revision,'updated_at',current_flag.updated_at,
        'operation_id',p_operation_id,'accepted',true,'reason','applied');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_patch_mock_attempt_review_flag(text,uuid,uuid,text,integer,boolean,bigint,uuid)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_patch_mock_attempt_review_flag(text,uuid,uuid,text,integer,boolean,bigint,uuid)
    TO service_role;
COMMIT;
