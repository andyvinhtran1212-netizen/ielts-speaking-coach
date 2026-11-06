-- Rollback for 367_ai_budget_definer_search_path.sql (PC-J612). Manual
-- only, never run by the migration runner; a rollback is applied as a new
-- forward migration after SA review.
--
-- It restores, verbatim, the 333 bodies of the 18 functions 367 recreated
-- (fn_ai_budget_active_raise, fn_ai_response_revision, fn_ai_patch_row,
-- fn_ai_insert_row, fn_ai_budget_release, fn_ai_budget_expire,
-- fn_ai_budget_close_scope, fn_ai_budget_recompute, fn_ai_deferred_save,
-- fn_ai_deferred_claim, fn_ai_deferred_claim_writing,
-- fn_ai_deferred_aggregate_write, fn_ai_session_bands_write,
-- fn_ai_class_sync, fn_ai_budget_raise_record_end, fn_ai_budget_raise_end,
-- fn_ai_budget_raise_expire_sweep, fn_ai_session_generation_bump), all with
-- search_path = public, pg_temp, and sets that path again on
-- fn_ai_budget_thresholds, fn_ai_budget_lock_counter,
-- fn_ai_budget_alert_crossings and fn_ai_budget_ensure_refresh. 340 never
-- replaced any of them, so this is the 340 state again and 340's
-- postcondition passes after it.
-- That REOPENS SA-2209 for these 22 functions: a typed overload in public
-- (for example to_jsonb(public.ai_deferred_grading_jobs) or array_agg(uuid))
-- runs as the function owner on the next claim or expiry while any role holds
-- CREATE on public. The 340 functions are not touched. Owner, SECURITY
-- DEFINER, volatility and the ACLs are kept (service_role keeps EXECUTE on
-- the 11 RPCs); it grants and revokes nothing. It refuses to run while public
-- already holds a function named like one the restored bodies call, because
-- that code would run at once.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    v_wrong text;
BEGIN
    SELECT pg_catalog.string_agg(DISTINCT p.proname::text, ', ') INTO v_wrong
      FROM pg_catalog.pg_proc p
     WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
       AND p.proname::text OPERATOR(pg_catalog.=) ANY (ARRAY[
           'array_agg', 'btrim', 'cardinality', 'char_length', 'convert_to', 'date_trunc', 'encode', 'format',
           'gen_random_uuid', 'jsonb_agg', 'jsonb_array_length', 'jsonb_build_array', 'jsonb_build_object',
           'jsonb_object_keys', 'jsonb_populate_record', 'jsonb_typeof', 'make_interval', 'now', 'quote_ident',
           'sha256', 'string_agg', 'sum', 'to_jsonb', 'unnest']);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

-- 333 section 7: fn_ai_budget_active_raise, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_active_raise(p_scope text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(sum(amount_usd), 0) FROM public.ai_budget_raises
     WHERE scope = p_scope AND ended_at IS NULL AND expires_at > now();
$$;

-- 333 section 7: fn_ai_response_revision, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_response_revision(p_response_id uuid, p_audio_storage_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_response_id IS NULL THEN 'absent'
                ELSE encode(sha256(convert_to(p_response_id::text || ':' || COALESCE(p_audio_storage_path, ''),
                                              'UTF8')), 'hex') END;
$$;

-- 333 section 7: fn_ai_patch_row, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_patch_row(p_table text, p_id uuid, p_patch jsonb, p_allowed text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bad text;
    v_cols text;
    v_vals text;
BEGIN
    IF p_table NOT IN ('responses', 'sessions', 'writing_essays', 'writing_feedback') THEN
        RAISE EXCEPTION 'ai_budget_patch_table_not_allowed: %', p_table USING ERRCODE = '22023';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'ai_budget_patch_not_object' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (p_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(quote_ident(k), ', ' ORDER BY k), string_agg('x.' || quote_ident(k), ', ' ORDER BY k)
      INTO v_cols, v_vals
      FROM jsonb_object_keys(p_patch) k;
    IF v_cols IS NULL THEN
        RETURN;
    END IF;
    EXECUTE format('UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) x) '
                   'WHERE t.id = $2', p_table, v_cols, v_vals, p_table)
        USING p_patch, p_id;
END;
$$;

-- 333 section 7: fn_ai_insert_row, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_insert_row(p_table text, p_row jsonb, p_allowed text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bad text;
    v_cols text;
    v_vals text;
    v_id uuid;
BEGIN
    IF p_table NOT IN ('responses', 'writing_feedback') THEN
        RAISE EXCEPTION 'ai_budget_patch_table_not_allowed: %', p_table USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM jsonb_object_keys(p_row) k WHERE NOT (k = ANY (p_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(quote_ident(k), ', ' ORDER BY k), string_agg('x.' || quote_ident(k), ', ' ORDER BY k)
      INTO v_cols, v_vals
      FROM jsonb_object_keys(p_row) k;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) x '
                   'RETURNING id', p_table, v_cols, v_vals, p_table)
        INTO v_id USING p_row;
    RETURN v_id;
END;
$$;

-- 333 section 7c: fn_ai_budget_release, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_release(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res public.ai_budget_reservations;
    v_key record;
BEGIN
    SELECT * INTO v_res FROM public.ai_budget_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_res.status <> 'reserved' THEN
        RETURN jsonb_build_object('status', 'noop', 'reservation_status', v_res.status);
    END IF;
    FOR v_key IN
        SELECT s AS scope, k AS kind, CASE k WHEN 'month' THEN v_res.month_start ELSE v_res.day_start END AS start
          FROM unnest(ARRAY[v_res.provider, 'total']) s CROSS JOIN (VALUES ('day'), ('month')) p(k)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters
           SET reserved_usd = GREATEST(reserved_usd - v_res.estimate_usd, 0), updated_at = now()
         WHERE scope = v_key.scope AND period_kind = v_key.kind AND period_start = v_key.start;
    END LOOP;
    UPDATE public.ai_budget_reservations SET status = 'released', settled_at = now() WHERE id = p_reservation_id;
    RETURN jsonb_build_object('status', 'released');
END;
$$;

-- 333 section 7d: fn_ai_budget_expire, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_expire(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now timestamptz := LEAST(COALESCE(p_now, now()), now());
    v_ids uuid[];
    v_key record;
BEGIN
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
        SELECT id FROM public.ai_budget_reservations
         WHERE status = 'reserved' AND expires_at <= v_now
         ORDER BY id FOR UPDATE SKIP LOCKED) c;
    IF v_ids IS NULL THEN
        RETURN 0;
    END IF;
    FOR v_key IN
        SELECT DISTINCT s AS scope, k AS kind, CASE k WHEN 'month' THEN r.month_start ELSE r.day_start END AS start
          FROM public.ai_budget_reservations r
         CROSS JOIN LATERAL unnest(ARRAY[r.provider, 'total']) s
         CROSS JOIN (VALUES ('day'), ('month')) p(k)
         WHERE r.id = ANY (v_ids)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters c
           SET reserved_usd = GREATEST(c.reserved_usd - x.amount, 0),
               settled_usd = c.settled_usd + x.amount, updated_at = now()
          FROM (SELECT sum(r.estimate_usd) AS amount FROM public.ai_budget_reservations r
                 WHERE r.id = ANY (v_ids) AND (v_key.scope = 'total' OR r.provider = v_key.scope)
                   AND CASE v_key.kind WHEN 'month' THEN r.month_start ELSE r.day_start END = v_key.start) x
         WHERE c.scope = v_key.scope AND c.period_kind = v_key.kind AND c.period_start = v_key.start;
    END LOOP;
    UPDATE public.ai_budget_reservations SET status = 'expired', settled_at = now() WHERE id = ANY (v_ids);
    RETURN cardinality(v_ids);
END;
$$;

-- 333 section 7e: fn_ai_budget_close_scope, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_close_scope(p_scope text, p_day date, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_day date := COALESCE(p_day, (now() AT TIME ZONE 'UTC')::date);
    v_row public.ai_budget_counters;
BEGIN
    IF p_scope IS NULL OR p_scope NOT IN ('anthropic', 'google', 'openai', 'elevenlabs', 'azure') THEN
        RAISE EXCEPTION 'ai_budget_invalid_scope: %', p_scope USING ERRCODE = '22023';
    END IF;
    IF p_reason IS DISTINCT FROM 'provider_spend_limit' THEN
        RAISE EXCEPTION 'ai_budget_invalid_close_reason: %', p_reason USING ERRCODE = '22023';
    END IF;
    v_row := public.fn_ai_budget_lock_counter(p_scope, 'day', v_day);
    IF v_row.closed_reason IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_closed', 'scope', p_scope, 'day', v_day);
    END IF;
    UPDATE public.ai_budget_counters SET closed_reason = p_reason, updated_at = now()
     WHERE scope = p_scope AND period_kind = 'day' AND period_start = v_day;
    INSERT INTO public.ai_budget_alerts
        (kind, scope, period_kind, period_start, threshold, trigger, committed_usd, cap_usd)
    VALUES ('threshold', p_scope, 'day', v_day, 100, 'provider_spend_limit',
            v_row.settled_usd + v_row.reserved_usd, v_row.cap_usd)
    ON CONFLICT (scope, period_kind, period_start, threshold) WHERE kind = 'threshold' DO NOTHING;
    RETURN jsonb_build_object('status', 'closed', 'scope', p_scope, 'day', v_day);
END;
$$;

-- 333 section 7f: fn_ai_budget_recompute, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_recompute(p_period_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_key record;
    v_count integer := 0;
BEGIN
    IF p_period_start IS NULL THEN
        RAISE EXCEPTION 'ai_budget_invalid_period' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN
        SELECT scope, period_kind, period_start FROM public.ai_budget_counters
         WHERE period_start = p_period_start
         ORDER BY scope, period_kind, period_start
           FOR UPDATE
    LOOP
        UPDATE public.ai_budget_counters c
           SET settled_usd = x.settled, reserved_usd = x.reserved, updated_at = now()
          FROM (SELECT COALESCE(sum(r.actual_usd) FILTER (WHERE r.status = 'settled'), 0)
                       + COALESCE(sum(r.estimate_usd) FILTER (WHERE r.status = 'expired'), 0) AS settled,
                       COALESCE(sum(r.estimate_usd) FILTER (WHERE r.status = 'reserved'), 0) AS reserved
                  FROM public.ai_budget_reservations r
                 WHERE (v_key.scope = 'total' OR r.provider = v_key.scope)
                   AND CASE v_key.period_kind WHEN 'month' THEN r.month_start ELSE r.day_start END
                       = v_key.period_start) x
         WHERE c.scope = v_key.scope AND c.period_kind = v_key.period_kind
           AND c.period_start = v_key.period_start;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- 333 section 7g: fn_ai_deferred_save, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_save(p_response jsonb, p_job jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_token_re CONSTANT text := '/[^/]+\.([0-9a-f-]{36})\.[0-9a-f]{64}\.[a-z0-9]+$';
    c_allowed CONSTANT text[] := ARRAY['audio_url', 'audio_storage_path', 'duration_seconds', 'transcript',
                                       'raw_transcript_text', 'transcript_model', 'transcript_reliability',
                                       'stt_status', 'feedback'];
    v_session  uuid := (p_response->>'session_id')::uuid;
    v_question uuid := (p_response->>'question_id')::uuid;
    v_token    text := p_response->>'submission_token';
    v_path     text := p_response->>'audio_storage_path';
    v_expected text := p_response->>'expected_revision';
    v_row      jsonb := COALESCE(p_response->'row', '{}'::jsonb);
    v_user     uuid := (p_job->>'user_id')::uuid;
    v_found    boolean;
    v_cur_id   uuid;
    v_cur_path text;
    v_id       uuid;
    v_revision text;
    v_job      uuid;
    v_attempt  integer := 0;
BEGIN
    IF v_session IS NULL OR v_question IS NULL OR v_user IS NULL OR v_expected IS NULL
       OR v_token IS NULL OR v_path IS NULL OR substring(v_path FROM c_token_re) IS DISTINCT FROM v_token
       OR jsonb_typeof(v_row) <> 'object'
       OR (v_row ? 'audio_storage_path' AND v_row->>'audio_storage_path' IS DISTINCT FROM v_path) THEN
        RAISE EXCEPTION 'ai_deferred_save_invalid_input' USING ERRCODE = '22023';
    END IF;
    v_row := v_row || jsonb_build_object('audio_storage_path', v_path);

    LOOP
        v_attempt := v_attempt + 1;
        v_cur_id := NULL;
        v_cur_path := NULL;
        SELECT id, audio_storage_path INTO v_cur_id, v_cur_path FROM public.responses
         WHERE session_id = v_session AND question_id = v_question
         LIMIT 1 FOR UPDATE;
        v_found := FOUND;
        IF v_found AND substring(COALESCE(v_cur_path, '') FROM c_token_re) = v_token THEN
            IF v_cur_path IS DISTINCT FROM v_path THEN
                RETURN jsonb_build_object('status', 'audio_changed', 'response_id', v_cur_id);
            END IF;
            SELECT id INTO v_job FROM public.ai_deferred_grading_jobs
             WHERE kind = 'speaking_response' AND resource_id = v_cur_id
               AND submission_revision = public.fn_ai_response_revision(v_cur_id, v_cur_path);
            RETURN jsonb_build_object('status', 'replay', 'response_id', v_cur_id, 'job_id', v_job);
        END IF;
        IF public.fn_ai_response_revision(v_cur_id, v_cur_path) IS DISTINCT FROM v_expected THEN
            RETURN jsonb_build_object('status', 'superseded', 'response_id', v_cur_id);
        END IF;
        IF v_found THEN
            v_id := v_cur_id;
            PERFORM public.fn_ai_patch_row('responses', v_id, v_row, c_allowed);
            EXIT;
        END IF;
        BEGIN
            v_id := public.fn_ai_insert_row('responses',
                        v_row || jsonb_build_object('session_id', v_session, 'question_id', v_question),
                        c_allowed || ARRAY['session_id', 'question_id']);
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            -- The unique (session_id, question_id) index arbitrates an insert
            -- race; re-read and re-check against the winner.
            IF v_attempt >= 2 THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    UPDATE public.responses
       SET grading_status = 'awaiting_budget', overall_band = NULL, final_overall_band = NULL, final_band_p = NULL
     WHERE id = v_id;
    v_revision := public.fn_ai_response_revision(v_id, v_path);
    -- Earlier revisions still queued are superseded, so they are never graded.
    UPDATE public.ai_deferred_grading_jobs
       SET status = 'superseded', finished_at = now()
     WHERE kind = 'speaking_response' AND resource_id = v_id AND status = 'queued'
       AND submission_revision <> v_revision;
    INSERT INTO public.ai_deferred_grading_jobs
        (kind, resource_id, submission_revision, user_id, reason, grading_attempt_id)
    VALUES ('speaking_response', v_id, v_revision, v_user, p_job->>'reason',
            (p_job->>'grading_attempt_id')::uuid)
    ON CONFLICT (kind, resource_id, submission_revision) DO NOTHING
    RETURNING id INTO v_job;
    IF v_job IS NULL THEN
        SELECT id INTO v_job FROM public.ai_deferred_grading_jobs
         WHERE kind = 'speaking_response' AND resource_id = v_id AND submission_revision = v_revision;
    END IF;
    RETURN jsonb_build_object('status', 'saved', 'response_id', v_id, 'job_id', v_job,
                              'submission_revision', v_revision);
END;
$$;

-- 333 section 7h: fn_ai_deferred_claim, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_claim(p_limit integer, p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job public.ai_deferred_grading_jobs;
    v_out jsonb := '[]'::jsonb;
    v_current text;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
        RAISE EXCEPTION 'ai_deferred_claim_invalid_input' USING ERRCODE = '22023';
    END IF;
    FOR v_job IN
        SELECT * FROM public.ai_deferred_grading_jobs
         WHERE status = 'queued' OR (status = 'running' AND lease_until < now())
         ORDER BY enqueued_at, id
           FOR UPDATE SKIP LOCKED
    LOOP
        SELECT public.fn_ai_response_revision(r.id, r.audio_storage_path) INTO v_current
          FROM public.responses r WHERE r.id = v_job.resource_id;
        IF v_current IS DISTINCT FROM v_job.submission_revision THEN
            UPDATE public.ai_deferred_grading_jobs
               SET status = 'superseded', finished_at = now(), lease_until = NULL
             WHERE id = v_job.id;
            CONTINUE;
        END IF;
        UPDATE public.ai_deferred_grading_jobs
           SET status = 'running', lease_token = gen_random_uuid(),
               lease_until = now() + make_interval(secs => p_lease_seconds), attempts = attempts + 1
         WHERE id = v_job.id
        RETURNING * INTO v_job;
        v_out := v_out || jsonb_build_array(to_jsonb(v_job));
        EXIT WHEN jsonb_array_length(v_out) >= p_limit;
    END LOOP;
    RETURN v_out;
END;
$$;

-- 333 section 7j: fn_ai_deferred_claim_writing, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_claim_writing(p_limit integer, p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out jsonb;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
        RAISE EXCEPTION 'ai_deferred_claim_invalid_input' USING ERRCODE = '22023';
    END IF;
    WITH c AS (
        SELECT id FROM public.writing_jobs
         WHERE budget_deferred_at IS NOT NULL
           AND (status = 'queued' OR (status = 'running' AND budget_lease_until < now()))
         ORDER BY budget_deferred_at, id
         LIMIT p_limit
           FOR UPDATE SKIP LOCKED
    ), u AS (
        UPDATE public.writing_jobs w
           SET status = 'running', budget_lease_token = gen_random_uuid(),
               budget_lease_until = now() + make_interval(secs => p_lease_seconds),
               budget_drain_count = w.budget_drain_count + 1
          FROM c WHERE w.id = c.id
        RETURNING w.id, w.essay_id, w.budget_lease_token, w.budget_lease_until, w.budget_drain_count,
                  w.budget_deferred_at
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.budget_deferred_at, u.id), '[]'::jsonb) INTO v_out FROM u;
    RETURN v_out;
END;
$$;

-- 333 section 7l: fn_ai_deferred_aggregate_write, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_aggregate_write(
    p_session_id uuid, p_generation bigint, p_bands jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_allowed CONSTANT text[] := ARRAY['overall_band', 'band_fc', 'band_lr', 'band_gra', 'band_p'];
    v_status text;
    v_refresh public.ai_deferred_session_refresh;
    v_bad text;
BEGIN
    IF p_generation IS NULL OR p_bands IS NULL OR jsonb_typeof(p_bands) <> 'object' THEN
        RAISE EXCEPTION 'ai_deferred_aggregate_invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(p_bands) k WHERE NOT (k = ANY (c_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT status INTO v_status FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF v_refresh.generation <> p_generation THEN
        RETURN jsonb_build_object('status', 'stale', 'generation', v_refresh.generation);
    END IF;
    IF v_status IS DISTINCT FROM 'completed' THEN
        RETURN jsonb_build_object('status', 'not_completed');
    END IF;
    PERFORM public.fn_ai_patch_row('sessions', p_session_id, p_bands, c_allowed);
    UPDATE public.ai_deferred_session_refresh
       SET refreshed_generation = p_generation, updated_at = now()
     WHERE session_id = p_session_id;
    RETURN jsonb_build_object('status', 'written', 'generation', p_generation);
END;
$$;

-- 333 section 7m: fn_ai_session_bands_write, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_session_bands_write(
    p_session_id uuid, p_generation bigint, p_patch jsonb, p_from_in_progress boolean, p_acknowledge boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_allowed CONSTANT text[] := ARRAY['overall_band', 'band_fc', 'band_lr', 'band_gra', 'band_p', 'status',
                                       'completed_at', 'error_code', 'error_message', 'failed_step',
                                       'last_error_at', 'last_regraded_at', 'last_regraded_by', 'regrade_count'];
    v_session record;
    v_refresh public.ai_deferred_session_refresh;
    v_patch jsonb := p_patch;
    v_row jsonb;
    v_bad text;
BEGIN
    IF p_generation IS NULL OR p_generation < 0 OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
       OR p_from_in_progress IS NULL OR p_acknowledge IS NULL THEN
        RAISE EXCEPTION 'ai_session_bands_invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (c_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    IF v_patch ? 'status' AND v_patch->>'status' IS DISTINCT FROM 'completed'
       AND v_patch->>'status' IS DISTINCT FROM 'grading_failed' THEN
        RAISE EXCEPTION 'ai_session_bands_invalid_status: %', v_patch->>'status' USING ERRCODE = '22023';
    END IF;
    SELECT id, status, resume_expires_at, completed_at INTO v_session
      FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF p_acknowledge AND v_refresh.generation <> p_generation THEN
        RETURN jsonb_build_object('status', 'stale', 'generation', v_refresh.generation);
    END IF;
    IF p_from_in_progress AND NOT (v_session.status = 'in_progress' AND v_session.resume_expires_at > now()) THEN
        RETURN jsonb_build_object('status', 'not_applied');
    END IF;
    -- completed_at is written only while unset (the original completion time).
    IF v_session.completed_at IS NOT NULL THEN
        v_patch := v_patch - 'completed_at';
    END IF;
    PERFORM public.fn_ai_patch_row('sessions', p_session_id, v_patch, c_allowed);
    UPDATE public.ai_deferred_session_refresh
       SET refreshed_generation = LEAST(p_generation, generation), updated_at = now()
     WHERE session_id = p_session_id;
    SELECT to_jsonb(s) INTO v_row FROM public.sessions s WHERE s.id = p_session_id;
    RETURN jsonb_build_object('status', 'written', 'acknowledged',
                              p_acknowledge OR v_refresh.generation = p_generation,
                              'generation', v_refresh.generation, 'session', v_row);
END;
$$;

-- 333 section 7n: fn_ai_class_sync, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_class_sync(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_band numeric;
    v_item_id uuid;
    v_found_item uuid;
    v_kind text;
    v_artifact uuid;
    v_submitted timestamptz;
    v_refresh public.ai_deferred_session_refresh;
    v_result text;
BEGIN
    SELECT overall_band, class_assignment_item_id INTO v_band, v_item_id
      FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF v_item_id IS NOT NULL THEN
        SELECT id, artifact_kind, artifact_id, submitted_at INTO v_found_item, v_kind, v_artifact, v_submitted
          FROM public.class_assignment_items WHERE id = v_item_id FOR UPDATE;
    END IF;
    IF v_found_item IS NULL
       OR (v_submitted IS NOT NULL
           AND (v_kind IS DISTINCT FROM 'session' OR v_artifact IS DISTINCT FROM p_session_id)) THEN
        v_result := 'no_item';
    ELSIF v_submitted IS NULL THEN
        -- The hand-in is not recorded yet: the sync stays owed.
        RETURN jsonb_build_object('status', 'pending_handin');
    ELSIF v_band IS NULL THEN
        -- Nothing to reflect (sync_class_item_score never writes a null score).
        v_result := 'no_band';
    ELSE
        UPDATE public.class_assignment_items
           SET score = v_band
         WHERE id = v_found_item AND artifact_kind = 'session' AND artifact_id = p_session_id
           AND submitted_at IS NOT NULL;
        v_result := 'synced';
    END IF;
    UPDATE public.ai_deferred_session_refresh
       SET class_synced_generation = refreshed_generation, updated_at = now()
     WHERE session_id = p_session_id;
    RETURN jsonb_build_object('status', v_result, 'class_synced_generation', v_refresh.refreshed_generation);
END;
$$;

-- 333 section 10a: fn_ai_budget_raise_record_end, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_record_end(
    p_raise_id uuid, p_end_kind text, p_actor uuid, p_actor_aal text, p_reason text, p_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raise public.ai_budget_raises;
    v_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_counter public.ai_budget_counters;
BEGIN
    UPDATE public.ai_budget_raises
       SET ended_at = now(), end_kind = p_end_kind, ended_by = p_actor, end_reason = p_reason
     WHERE id = p_raise_id AND ended_at IS NULL
    RETURNING * INTO v_raise;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO v_counter FROM public.ai_budget_counters
     WHERE scope = v_raise.scope AND period_kind = 'month' AND period_start = v_month;
    -- effective_month_cap_usd is the cap in force after the event.
    INSERT INTO public.ai_budget_raise_events
        (raise_id, event, scope, amount_usd, base_month_cap_usd, effective_month_cap_usd, expires_at,
         actor_id, actor_aal, request_id, reason)
    VALUES (v_raise.id, p_end_kind, v_raise.scope, v_raise.amount_usd, v_raise.base_month_cap_usd,
            v_raise.base_month_cap_usd, v_raise.expires_at, p_actor, p_actor_aal, p_request_id, p_reason);
    INSERT INTO public.ai_budget_alerts (kind, raise_id, scope, period_kind, period_start, committed_usd, cap_usd)
    VALUES (CASE p_end_kind WHEN 'expired' THEN 'raise_expired' ELSE 'raise_ended' END, v_raise.id,
            v_raise.scope, 'month', v_month, v_counter.settled_usd + v_counter.reserved_usd,
            v_raise.base_month_cap_usd);
END;
$$;

-- 333 section 10c: fn_ai_budget_raise_end, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_end(
    p_raise_id uuid, p_actor uuid, p_actor_aal text, p_reason text, p_request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raise public.ai_budget_raises;
BEGIN
    IF p_actor_aal IS DISTINCT FROM 'aal2' THEN
        RETURN jsonb_build_object('ended', false, 'error_code', 'mfa_required');
    END IF;
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'ai_budget_raise_actor_required' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ended', false, 'error_code', 'reason_invalid');
    END IF;
    SELECT * INTO v_raise FROM public.ai_budget_raises WHERE id = p_raise_id FOR UPDATE;
    IF NOT FOUND OR v_raise.ended_at IS NOT NULL OR v_raise.expires_at <= now() THEN
        RETURN jsonb_build_object('ended', false, 'error_code', 'not_active');
    END IF;
    PERFORM public.fn_ai_budget_raise_record_end(p_raise_id, 'ended_early', p_actor, p_actor_aal,
                                                 btrim(p_reason), p_request_id);
    RETURN jsonb_build_object('ended', true, 'raise_id', p_raise_id, 'scope', v_raise.scope,
                              'effective_month_cap_usd', v_raise.base_month_cap_usd);
END;
$$;

-- 333 section 10d: fn_ai_budget_raise_expire_sweep, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_expire_sweep(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now timestamptz := LEAST(COALESCE(p_now, now()), now());
    v_id uuid;
    v_count integer := 0;
BEGIN
    FOR v_id IN
        SELECT id FROM public.ai_budget_raises
         WHERE ended_at IS NULL AND expires_at <= v_now
         ORDER BY id FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.fn_ai_budget_raise_record_end(v_id, 'expired', NULL, NULL, NULL, NULL);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- 333 section 11: fn_ai_session_generation_bump, verbatim.
CREATE OR REPLACE FUNCTION public.fn_ai_session_generation_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sessions uuid[];
    v_session uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_sessions := ARRAY[NEW.session_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_sessions := ARRAY[OLD.session_id];
    ELSE
        IF NEW.overall_band IS NOT DISTINCT FROM OLD.overall_band
           AND NEW.final_band_p IS NOT DISTINCT FROM OLD.final_band_p
           AND NEW.final_overall_band IS NOT DISTINCT FROM OLD.final_overall_band
           AND NEW.feedback::text IS NOT DISTINCT FROM OLD.feedback::text
           AND NEW.grading_status IS NOT DISTINCT FROM OLD.grading_status THEN
            RETURN NULL;
        END IF;
        v_sessions := ARRAY[OLD.session_id, NEW.session_id];
    END IF;
    FOR v_session IN SELECT DISTINCT s FROM unnest(v_sessions) s WHERE s IS NOT NULL ORDER BY s LOOP
        PERFORM 1 FROM public.sessions WHERE id = v_session FOR UPDATE;
        CONTINUE WHEN NOT FOUND;
        INSERT INTO public.ai_deferred_session_refresh AS r (session_id, generation, updated_at)
        VALUES (v_session, 1, now())
        ON CONFLICT (session_id) DO UPDATE SET generation = r.generation + 1, updated_at = now();
    END LOOP;
    RETURN NULL;
END;
$$;

ALTER FUNCTION public.fn_ai_budget_thresholds(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_ai_budget_lock_counter(text, text, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_ai_budget_alert_crossings(text, text, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_ai_budget_ensure_refresh(uuid) SET search_path = public, pg_temp;

COMMIT;
