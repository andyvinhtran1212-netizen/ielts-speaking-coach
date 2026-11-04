-- Migration: 367_ai_budget_definer_search_path.sql
--
-- PC-J612 (Security Auditor SA-2209, residual P2; AIBUDGET-0033). 364 is
-- held by PC-J544, 365 by PC-J603 (#2238) and 366 by PC-J611 (#2241), so this
-- takes 367. 333 and 340 are never edited: this forward file pins the
-- search_path of the 22 SECURITY DEFINER functions 333 created and 340 left
-- as they were, the way 363, 365 and 366 pinned their groups.
--
--   SA-2209  These definers run as their owner with
--         search_path = public, pg_temp. A role with CREATE on public
--         (service_role before 357) can add an exact typed overload that
--         beats the catalog's polymorphic version and runs as the owner, for
--         example public.to_jsonb(public.ai_deferred_grading_jobs),
--         public.array_agg(uuid), public.cardinality(uuid[]),
--         public.unnest(uuid[]), public.format(text, text, text, text, text)
--         or public.jsonb_populate_record(public.sessions, jsonb), which
--         fn_ai_patch_row reaches through its dynamic UPDATE:
--           RPCs, EXECUTE for service_role (11):
--             fn_ai_budget_release, fn_ai_budget_expire,
--             fn_ai_budget_close_scope, fn_ai_deferred_save,
--             fn_ai_deferred_claim, fn_ai_deferred_claim_writing,
--             fn_ai_deferred_aggregate_write, fn_ai_session_bands_write,
--             fn_ai_class_sync, fn_ai_budget_raise_end,
--             fn_ai_budget_raise_expire_sweep.
--           Internal, EXECUTE for no API role (11):
--             fn_ai_budget_thresholds, fn_ai_budget_lock_counter,
--             fn_ai_budget_alert_crossings, fn_ai_budget_active_raise,
--             fn_ai_response_revision, fn_ai_patch_row, fn_ai_insert_row,
--             fn_ai_budget_ensure_refresh, fn_ai_budget_raise_record_end,
--             fn_ai_budget_recompute (operator repair) and the trigger
--             fn_ai_session_generation_bump (on public.responses).
--
-- 18 functions are recreated with their 333 bodies (equal to the live
-- staging bodies, read-only md5 check 2026-11-04), unchanged except for
-- SET search_path = pg_catalog, pg_temp and pg_catalog.<fn> for every catalog
-- function they call, including jsonb_populate_record inside the dynamic SQL
-- of fn_ai_patch_row and fn_ai_insert_row. 333 already names every table and
-- row type as public.<name>, so no table name changes; with public off the
-- path an unqualified one would resolve to pg_temp. substring(x FROM y) and
-- AT TIME ZONE are SQL syntax the parser binds to pg_catalog itself, and
-- COALESCE, GREATEST and LEAST are not functions. fn_ai_budget_thresholds,
-- fn_ai_budget_lock_counter, fn_ai_budget_alert_crossings and
-- fn_ai_budget_ensure_refresh call no catalog function and name only public.
-- objects, so their bodies stay as 333 wrote them and only ALTER FUNCTION ...
-- SET search_path changes them. Operators need no qualification: with public
-- off the path no schema but pg_catalog can supply one. Owner, SECURITY
-- DEFINER, volatility and the ACLs stay as they are: CREATE OR REPLACE and
-- ALTER keep them, and this file grants and revokes nothing (service_role
-- keeps EXECUTE on the 11 RPCs, the 11 internal functions stay executable by
-- no API role). The DO blocks run under the same pinned path and also
-- qualify every function and operator.
--
-- Hot path. Every one of these functions already carried a SET search_path,
-- so each call already saved and restored the GUC and none could be inlined;
-- only the value changes. Their cached plans always run under their own
-- pinned path, so nothing is replanned. The 340 RPCs that call them
-- (reserve, settle, commit, commit_writing, raise_grant) are unchanged.
--
-- Triggers. A trigger function without its own search_path inherits the
-- path of the statement that fires it, which inside these functions is now
-- pg_catalog, pg_temp. Every trigger on the tables they write sets its own
-- path today (staging read-only check 2026-11-04); the precondition refuses
-- (`trigger_function_without_search_path`) instead of letting such a
-- trigger fail on its first unqualified table.
--
-- Not in this file (other definers with search_path = public[, pg_temp], see
-- SA-2209): the 340 functions fn_ai_budget_assert_finite,
-- fn_ai_budget_reserve, fn_ai_budget_settle, fn_ai_deferred_commit,
-- fn_ai_deferred_commit_writing and fn_ai_budget_raise_grant, the 337 and
-- 339 groups and the older definers. They need their own ticket, review and
-- migration. fn_ai_budget_raise_events_append_only (333) is SECURITY INVOKER
-- and raises before it reads anything.
--
-- Order and compatibility. Needs 333 and 340 in public._schema_migrations
-- (`migration_367_prerequisite_missing: no ledger row`), the 333 tables and
-- functions and 340's helper (`...: objects`), and no function or operator
-- in public named like one the file or the bodies use
-- (`catalog_name_shadowed_in_public`): a shadow already planted is an
-- incident to remove before this runs. Same forward-policy group as 333 and
-- 340 (pending_feature ai_budget), not the admin_aal2 group of 363/365/366:
-- it depends on 340 only, and 340's postcondition still requires
-- search_path = public, pg_temp on these functions, so 340 must run first.
-- Apply only with MIGRATION_FEATURES=ai_budget through the advisory-locked
-- runner, after 340, staging first after SA review, production only at an
-- explicitly authorised staging -> main promotion after 340. No backend
-- change. One transaction, lock_timeout 5s, re-runnable (a second run changes
-- nothing), runs as the NOSUPERUSER owner, no business data read or written.
-- Re-running 333 after 367 restores search_path = public (and the pre-340
-- bodies): re-run 340 and then 367 after it. Re-running 340 alone after 367
-- aborts on 340's own postcondition (`ai_budget_function_acl_wrong`) and
-- changes nothing.
--
-- ROLLBACK: backend/migrations/rollback/367_ai_budget_definer_search_path.sql
-- restores the 18 bodies of 333 verbatim and the 333 path of the other four,
-- reopens SA-2209 for these 22 functions and grants nothing. It refuses to run
-- while public holds a shadow of a name those bodies call. The 340 ROLLBACK
-- (b) drops these functions with the rest of the group either way.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 333 and 340 are recorded; the 333 tables and the 22
-- functions exist and 340's helper is installed; nothing in public shadows a
-- catalog name this file or the bodies use; every trigger on a table the
-- functions write (other than the generation trigger, pinned here) sets its
-- own search_path. The postcondition checks the generation trigger.
DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY[
        'aclexplode', 'array_agg', 'array_to_string', 'btrim', 'cardinality', 'char_length', 'convert_to',
        'count', 'date_trunc', 'encode', 'format', 'gen_random_uuid', 'has_function_privilege', 'jsonb_agg',
        'jsonb_array_length', 'jsonb_build_array', 'jsonb_build_object', 'jsonb_object_keys',
        'jsonb_populate_record', 'jsonb_typeof', 'make_interval', 'now', 'quote_ident', 'sha256',
        'string_agg', 'sum', 'to_jsonb', 'to_regclass', 'to_regprocedure', 'unnest'];
    catalog_operators CONSTANT text[] := ARRAY[
        '*', '+', '-', '->', '->>', '<', '<=', '<>', '=', '>', '>=', '?', '||', '~', '~*'];
    written_tables CONSTANT text[] := ARRAY[
        'public.ai_budget_alerts', 'public.ai_budget_counters', 'public.ai_budget_raise_events',
        'public.ai_budget_raises', 'public.ai_budget_reservations', 'public.ai_deferred_grading_jobs',
        'public.ai_deferred_session_refresh', 'public.class_assignment_items', 'public.responses',
        'public.sessions', 'public.writing_essays', 'public.writing_feedback', 'public.writing_jobs'];
    functions CONSTANT text[] := ARRAY[
        'public.fn_ai_budget_thresholds(text,text)', 'public.fn_ai_budget_lock_counter(text,text,date)',
        'public.fn_ai_budget_alert_crossings(text,text,date)', 'public.fn_ai_budget_active_raise(text)',
        'public.fn_ai_response_revision(uuid,text)', 'public.fn_ai_patch_row(text,uuid,jsonb,text[])',
        'public.fn_ai_insert_row(text,jsonb,text[])', 'public.fn_ai_budget_ensure_refresh(uuid)',
        'public.fn_ai_budget_release(uuid)', 'public.fn_ai_budget_expire(timestamptz)',
        'public.fn_ai_budget_close_scope(text,date,text)', 'public.fn_ai_budget_recompute(date)',
        'public.fn_ai_deferred_save(jsonb,jsonb)', 'public.fn_ai_deferred_claim(integer,integer)',
        'public.fn_ai_deferred_claim_writing(integer,integer)',
        'public.fn_ai_deferred_aggregate_write(uuid,bigint,jsonb)',
        'public.fn_ai_session_bands_write(uuid,bigint,jsonb,boolean,boolean)', 'public.fn_ai_class_sync(uuid)',
        'public.fn_ai_budget_raise_record_end(uuid,text,uuid,text,text,text)',
        'public.fn_ai_budget_raise_end(uuid,uuid,text,text,text)',
        'public.fn_ai_budget_raise_expire_sweep(timestamptz)', 'public.fn_ai_session_generation_bump()',
        'public.fn_ai_budget_assert_finite(numeric,text)'];
    v_wrong text;
BEGIN
    -- Two statements: PL/pgSQL plans a whole condition, so the ledger
    -- query must not be parsed when the table is missing.
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_367_prerequisite_missing: no ledger row';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM public._schema_migrations m
         WHERE m.filename OPERATOR(pg_catalog.=) ANY (ARRAY[
               '333_ai_budget_hard_cap.sql', '340_ai_budget_hardening.sql']))
       OPERATOR(pg_catalog.<>) 2 THEN
        RAISE EXCEPTION 'migration_367_prerequisite_missing: no ledger row';
    END IF;
    SELECT pg_catalog.string_agg(o.name, ', ' ORDER BY o.name) INTO v_wrong
      FROM (SELECT t.name FROM pg_catalog.unnest(written_tables) t(name)
             WHERE pg_catalog.to_regclass(t.name) IS NULL
            UNION ALL
            SELECT f.name FROM pg_catalog.unnest(functions) f(name)
             WHERE pg_catalog.to_regprocedure(f.name) IS NULL) o;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'migration_367_prerequisite_missing: objects %', v_wrong;
    END IF;
    SELECT pg_catalog.string_agg(k.kind OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) k.name, ', '
                                 ORDER BY k.kind, k.name) INTO v_wrong
      FROM (SELECT 'function'::text, p.proname::text FROM pg_catalog.pg_proc p
             WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND p.proname::text OPERATOR(pg_catalog.=) ANY (catalog_functions)
            UNION
            SELECT 'operator'::text, o.oprname::text FROM pg_catalog.pg_operator o
             WHERE o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND o.oprname::text OPERATOR(pg_catalog.=) ANY (catalog_operators)) k(kind, name);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
    SELECT pg_catalog.string_agg(g.tgrelid::regclass::text OPERATOR(pg_catalog.||) '.'
                                 OPERATOR(pg_catalog.||) g.tgname::text, ', '
                                 ORDER BY g.tgrelid::regclass::text, g.tgname) INTO v_wrong
      FROM pg_catalog.pg_trigger g
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) g.tgfoid
     WHERE NOT g.tgisinternal
       AND g.tgrelid OPERATOR(pg_catalog.=) ANY (
           SELECT pg_catalog.to_regclass(t.name)::oid FROM pg_catalog.unnest(written_tables) t(name))
       -- fn_ai_session_generation_bump is one of the functions pinned below.
       AND NOT g.tgfoid OPERATOR(pg_catalog.=) ANY (
           SELECT pg_catalog.to_regprocedure(f.name)::oid FROM pg_catalog.unnest(functions) f(name))
       AND (p.proconfig IS NULL
            OR NOT pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.~) '(^|[|])search_path=');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'trigger_function_without_search_path: %', v_wrong;
    END IF;
END $$;

-- 1. 333 section 7: fn_ai_budget_active_raise.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_active_raise(p_scope text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT COALESCE(pg_catalog.sum(amount_usd), 0) FROM public.ai_budget_raises
     WHERE scope = p_scope AND ended_at IS NULL AND expires_at > pg_catalog.now();
$$;

-- 2. 333 section 7: fn_ai_response_revision.
CREATE OR REPLACE FUNCTION public.fn_ai_response_revision(p_response_id uuid, p_audio_storage_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE WHEN p_response_id IS NULL THEN 'absent'
                ELSE pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_response_id::text || ':'
                         || COALESCE(p_audio_storage_path, ''),
                                              'UTF8')), 'hex') END;
$$;

-- 3. 333 section 7: fn_ai_patch_row.
CREATE OR REPLACE FUNCTION public.fn_ai_patch_row(p_table text, p_id uuid, p_patch jsonb, p_allowed text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_bad text;
    v_cols text;
    v_vals text;
BEGIN
    IF p_table NOT IN ('responses', 'sessions', 'writing_essays', 'writing_feedback') THEN
        RAISE EXCEPTION 'ai_budget_patch_table_not_allowed: %', p_table USING ERRCODE = '22023';
    END IF;
    IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'ai_budget_patch_not_object' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM pg_catalog.jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (p_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(k), ', ' ORDER BY k),
           pg_catalog.string_agg('x.' || pg_catalog.quote_ident(k), ', ' ORDER BY k)
      INTO v_cols, v_vals
      FROM pg_catalog.jsonb_object_keys(p_patch) k;
    IF v_cols IS NULL THEN
        RETURN;
    END IF;
    EXECUTE pg_catalog.format('UPDATE public.%I t SET (%s) = (SELECT %s FROM pg_catalog.jsonb_populate_record(NULL::public.%I, $1) x) '
                   'WHERE t.id = $2', p_table, v_cols, v_vals, p_table)
        USING p_patch, p_id;
END;
$$;

-- 4. 333 section 7: fn_ai_insert_row.
CREATE OR REPLACE FUNCTION public.fn_ai_insert_row(p_table text, p_row jsonb, p_allowed text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
    SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM pg_catalog.jsonb_object_keys(p_row) k WHERE NOT (k = ANY (p_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(k), ', ' ORDER BY k),
           pg_catalog.string_agg('x.' || pg_catalog.quote_ident(k), ', ' ORDER BY k)
      INTO v_cols, v_vals
      FROM pg_catalog.jsonb_object_keys(p_row) k;
    EXECUTE pg_catalog.format('INSERT INTO public.%I (%s) SELECT %s FROM pg_catalog.jsonb_populate_record(NULL::public.%I, $1) x '
                   'RETURNING id', p_table, v_cols, v_vals, p_table)
        INTO v_id USING p_row;
    RETURN v_id;
END;
$$;

-- 5. 333 section 7c: fn_ai_budget_release.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_release(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res public.ai_budget_reservations;
    v_key record;
BEGIN
    SELECT * INTO v_res FROM public.ai_budget_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;
    IF v_res.status <> 'reserved' THEN
        RETURN pg_catalog.jsonb_build_object('status', 'noop', 'reservation_status', v_res.status);
    END IF;
    FOR v_key IN
        SELECT s AS scope, k AS kind, CASE k WHEN 'month' THEN v_res.month_start ELSE v_res.day_start END AS start
          FROM pg_catalog.unnest(ARRAY[v_res.provider, 'total']) s CROSS JOIN (VALUES ('day'), ('month')) p(k)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters
           SET reserved_usd = GREATEST(reserved_usd - v_res.estimate_usd, 0), updated_at = pg_catalog.now()
         WHERE scope = v_key.scope AND period_kind = v_key.kind AND period_start = v_key.start;
    END LOOP;
    UPDATE public.ai_budget_reservations SET status = 'released', settled_at = pg_catalog.now()
     WHERE id = p_reservation_id;
    RETURN pg_catalog.jsonb_build_object('status', 'released');
END;
$$;

-- 6. 333 section 7d: fn_ai_budget_expire.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_expire(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_now timestamptz := LEAST(COALESCE(p_now, pg_catalog.now()), pg_catalog.now());
    v_ids uuid[];
    v_key record;
BEGIN
    SELECT pg_catalog.array_agg(id ORDER BY id) INTO v_ids FROM (
        SELECT id FROM public.ai_budget_reservations
         WHERE status = 'reserved' AND expires_at <= v_now
         ORDER BY id FOR UPDATE SKIP LOCKED) c;
    IF v_ids IS NULL THEN
        RETURN 0;
    END IF;
    FOR v_key IN
        SELECT DISTINCT s AS scope, k AS kind, CASE k WHEN 'month' THEN r.month_start ELSE r.day_start END AS start
          FROM public.ai_budget_reservations r
         CROSS JOIN LATERAL pg_catalog.unnest(ARRAY[r.provider, 'total']) s
         CROSS JOIN (VALUES ('day'), ('month')) p(k)
         WHERE r.id = ANY (v_ids)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters c
           SET reserved_usd = GREATEST(c.reserved_usd - x.amount, 0),
               settled_usd = c.settled_usd + x.amount, updated_at = pg_catalog.now()
          FROM (SELECT pg_catalog.sum(r.estimate_usd) AS amount FROM public.ai_budget_reservations r
                 WHERE r.id = ANY (v_ids) AND (v_key.scope = 'total' OR r.provider = v_key.scope)
                   AND CASE v_key.kind WHEN 'month' THEN r.month_start ELSE r.day_start END = v_key.start) x
         WHERE c.scope = v_key.scope AND c.period_kind = v_key.kind AND c.period_start = v_key.start;
    END LOOP;
    UPDATE public.ai_budget_reservations SET status = 'expired', settled_at = pg_catalog.now()
     WHERE id = ANY (v_ids);
    RETURN pg_catalog.cardinality(v_ids);
END;
$$;

-- 7. 333 section 7e: fn_ai_budget_close_scope.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_close_scope(p_scope text, p_day date, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_day date := COALESCE(p_day, (pg_catalog.now() AT TIME ZONE 'UTC')::date);
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
        RETURN pg_catalog.jsonb_build_object('status', 'already_closed', 'scope', p_scope, 'day', v_day);
    END IF;
    UPDATE public.ai_budget_counters SET closed_reason = p_reason, updated_at = pg_catalog.now()
     WHERE scope = p_scope AND period_kind = 'day' AND period_start = v_day;
    INSERT INTO public.ai_budget_alerts
        (kind, scope, period_kind, period_start, threshold, trigger, committed_usd, cap_usd)
    VALUES ('threshold', p_scope, 'day', v_day, 100, 'provider_spend_limit',
            v_row.settled_usd + v_row.reserved_usd, v_row.cap_usd)
    ON CONFLICT (scope, period_kind, period_start, threshold) WHERE kind = 'threshold' DO NOTHING;
    RETURN pg_catalog.jsonb_build_object('status', 'closed', 'scope', p_scope, 'day', v_day);
END;
$$;

-- 8. 333 section 7f: fn_ai_budget_recompute.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_recompute(p_period_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
           SET settled_usd = x.settled, reserved_usd = x.reserved, updated_at = pg_catalog.now()
          FROM (SELECT COALESCE(pg_catalog.sum(r.actual_usd) FILTER (WHERE r.status = 'settled'), 0)
                       + COALESCE(pg_catalog.sum(r.estimate_usd) FILTER (WHERE r.status = 'expired'), 0) AS settled,
                       COALESCE(pg_catalog.sum(r.estimate_usd) FILTER (WHERE r.status = 'reserved'), 0) AS reserved
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

-- 9. 333 section 7g: fn_ai_deferred_save.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_save(p_response jsonb, p_job jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
       OR pg_catalog.jsonb_typeof(v_row) <> 'object'
       OR (v_row ? 'audio_storage_path' AND v_row->>'audio_storage_path' IS DISTINCT FROM v_path) THEN
        RAISE EXCEPTION 'ai_deferred_save_invalid_input' USING ERRCODE = '22023';
    END IF;
    v_row := v_row || pg_catalog.jsonb_build_object('audio_storage_path', v_path);

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
                RETURN pg_catalog.jsonb_build_object('status', 'audio_changed', 'response_id', v_cur_id);
            END IF;
            SELECT id INTO v_job FROM public.ai_deferred_grading_jobs
             WHERE kind = 'speaking_response' AND resource_id = v_cur_id
               AND submission_revision = public.fn_ai_response_revision(v_cur_id, v_cur_path);
            RETURN pg_catalog.jsonb_build_object('status', 'replay', 'response_id', v_cur_id, 'job_id', v_job);
        END IF;
        IF public.fn_ai_response_revision(v_cur_id, v_cur_path) IS DISTINCT FROM v_expected THEN
            RETURN pg_catalog.jsonb_build_object('status', 'superseded', 'response_id', v_cur_id);
        END IF;
        IF v_found THEN
            v_id := v_cur_id;
            PERFORM public.fn_ai_patch_row('responses', v_id, v_row, c_allowed);
            EXIT;
        END IF;
        BEGIN
            v_id := public.fn_ai_insert_row('responses',
                        v_row || pg_catalog.jsonb_build_object('session_id', v_session, 'question_id', v_question),
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
       SET status = 'superseded', finished_at = pg_catalog.now()
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
    RETURN pg_catalog.jsonb_build_object('status', 'saved', 'response_id', v_id, 'job_id', v_job,
                              'submission_revision', v_revision);
END;
$$;

-- 10. 333 section 7h: fn_ai_deferred_claim.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_claim(p_limit integer, p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
         WHERE status = 'queued' OR (status = 'running' AND lease_until < pg_catalog.now())
         ORDER BY enqueued_at, id
           FOR UPDATE SKIP LOCKED
    LOOP
        SELECT public.fn_ai_response_revision(r.id, r.audio_storage_path) INTO v_current
          FROM public.responses r WHERE r.id = v_job.resource_id;
        IF v_current IS DISTINCT FROM v_job.submission_revision THEN
            UPDATE public.ai_deferred_grading_jobs
               SET status = 'superseded', finished_at = pg_catalog.now(), lease_until = NULL
             WHERE id = v_job.id;
            CONTINUE;
        END IF;
        UPDATE public.ai_deferred_grading_jobs
           SET status = 'running', lease_token = pg_catalog.gen_random_uuid(),
               lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
               attempts = attempts + 1
         WHERE id = v_job.id
        RETURNING * INTO v_job;
        v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_job));
        EXIT WHEN pg_catalog.jsonb_array_length(v_out) >= p_limit;
    END LOOP;
    RETURN v_out;
END;
$$;

-- 11. 333 section 7j: fn_ai_deferred_claim_writing.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_claim_writing(p_limit integer, p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
           AND (status = 'queued' OR (status = 'running' AND budget_lease_until < pg_catalog.now()))
         ORDER BY budget_deferred_at, id
         LIMIT p_limit
           FOR UPDATE SKIP LOCKED
    ), u AS (
        UPDATE public.writing_jobs w
           SET status = 'running', budget_lease_token = pg_catalog.gen_random_uuid(),
               budget_lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
               budget_drain_count = w.budget_drain_count + 1
          FROM c WHERE w.id = c.id
        RETURNING w.id, w.essay_id, w.budget_lease_token, w.budget_lease_until, w.budget_drain_count,
                  w.budget_deferred_at
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(u) ORDER BY u.budget_deferred_at, u.id), '[]'::jsonb)
      INTO v_out FROM u;
    RETURN v_out;
END;
$$;

-- 12. 333 section 7l: fn_ai_deferred_aggregate_write.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_aggregate_write(
    p_session_id uuid, p_generation bigint, p_bands jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c_allowed CONSTANT text[] := ARRAY['overall_band', 'band_fc', 'band_lr', 'band_gra', 'band_p'];
    v_status text;
    v_refresh public.ai_deferred_session_refresh;
    v_bad text;
BEGIN
    IF p_generation IS NULL OR p_bands IS NULL OR pg_catalog.jsonb_typeof(p_bands) <> 'object' THEN
        RAISE EXCEPTION 'ai_deferred_aggregate_invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM pg_catalog.jsonb_object_keys(p_bands) k WHERE NOT (k = ANY (c_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT status INTO v_status FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF v_refresh.generation <> p_generation THEN
        RETURN pg_catalog.jsonb_build_object('status', 'stale', 'generation', v_refresh.generation);
    END IF;
    IF v_status IS DISTINCT FROM 'completed' THEN
        RETURN pg_catalog.jsonb_build_object('status', 'not_completed');
    END IF;
    PERFORM public.fn_ai_patch_row('sessions', p_session_id, p_bands, c_allowed);
    UPDATE public.ai_deferred_session_refresh
       SET refreshed_generation = p_generation, updated_at = pg_catalog.now()
     WHERE session_id = p_session_id;
    RETURN pg_catalog.jsonb_build_object('status', 'written', 'generation', p_generation);
END;
$$;

-- 13. 333 section 7m: fn_ai_session_bands_write.
CREATE OR REPLACE FUNCTION public.fn_ai_session_bands_write(
    p_session_id uuid, p_generation bigint, p_patch jsonb, p_from_in_progress boolean, p_acknowledge boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
    IF p_generation IS NULL OR p_generation < 0 OR p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
       OR p_from_in_progress IS NULL OR p_acknowledge IS NULL THEN
        RAISE EXCEPTION 'ai_session_bands_invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM pg_catalog.jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (c_allowed));
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
        RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF p_acknowledge AND v_refresh.generation <> p_generation THEN
        RETURN pg_catalog.jsonb_build_object('status', 'stale', 'generation', v_refresh.generation);
    END IF;
    IF p_from_in_progress
       AND NOT (v_session.status = 'in_progress' AND v_session.resume_expires_at > pg_catalog.now()) THEN
        RETURN pg_catalog.jsonb_build_object('status', 'not_applied');
    END IF;
    -- completed_at is written only while unset (the original completion time).
    IF v_session.completed_at IS NOT NULL THEN
        v_patch := v_patch - 'completed_at';
    END IF;
    PERFORM public.fn_ai_patch_row('sessions', p_session_id, v_patch, c_allowed);
    UPDATE public.ai_deferred_session_refresh
       SET refreshed_generation = LEAST(p_generation, generation), updated_at = pg_catalog.now()
     WHERE session_id = p_session_id;
    SELECT pg_catalog.to_jsonb(s) INTO v_row FROM public.sessions s WHERE s.id = p_session_id;
    RETURN pg_catalog.jsonb_build_object('status', 'written', 'acknowledged',
                              p_acknowledge OR v_refresh.generation = p_generation,
                              'generation', v_refresh.generation, 'session', v_row);
END;
$$;

-- 14. 333 section 7n: fn_ai_class_sync.
CREATE OR REPLACE FUNCTION public.fn_ai_class_sync(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
        RETURN pg_catalog.jsonb_build_object('status', 'not_found');
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
        RETURN pg_catalog.jsonb_build_object('status', 'pending_handin');
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
       SET class_synced_generation = refreshed_generation, updated_at = pg_catalog.now()
     WHERE session_id = p_session_id;
    RETURN pg_catalog.jsonb_build_object('status', v_result,
                                         'class_synced_generation', v_refresh.refreshed_generation);
END;
$$;

-- 15. 333 section 10a: fn_ai_budget_raise_record_end.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_record_end(
    p_raise_id uuid, p_end_kind text, p_actor uuid, p_actor_aal text, p_reason text, p_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_raise public.ai_budget_raises;
    v_month date := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC')::date;
    v_counter public.ai_budget_counters;
BEGIN
    UPDATE public.ai_budget_raises
       SET ended_at = pg_catalog.now(), end_kind = p_end_kind, ended_by = p_actor, end_reason = p_reason
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

-- 16. 333 section 10c: fn_ai_budget_raise_end.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_end(
    p_raise_id uuid, p_actor uuid, p_actor_aal text, p_reason text, p_request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_raise public.ai_budget_raises;
BEGIN
    IF p_actor_aal IS DISTINCT FROM 'aal2' THEN
        RETURN pg_catalog.jsonb_build_object('ended', false, 'error_code', 'mfa_required');
    END IF;
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'ai_budget_raise_actor_required' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN pg_catalog.jsonb_build_object('ended', false, 'error_code', 'reason_invalid');
    END IF;
    SELECT * INTO v_raise FROM public.ai_budget_raises WHERE id = p_raise_id FOR UPDATE;
    IF NOT FOUND OR v_raise.ended_at IS NOT NULL OR v_raise.expires_at <= pg_catalog.now() THEN
        RETURN pg_catalog.jsonb_build_object('ended', false, 'error_code', 'not_active');
    END IF;
    PERFORM public.fn_ai_budget_raise_record_end(p_raise_id, 'ended_early', p_actor, p_actor_aal,
                                                 pg_catalog.btrim(p_reason), p_request_id);
    RETURN pg_catalog.jsonb_build_object('ended', true, 'raise_id', p_raise_id, 'scope', v_raise.scope,
                              'effective_month_cap_usd', v_raise.base_month_cap_usd);
END;
$$;

-- 17. 333 section 10d: fn_ai_budget_raise_expire_sweep.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_expire_sweep(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_now timestamptz := LEAST(COALESCE(p_now, pg_catalog.now()), pg_catalog.now());
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

-- 18. 333 section 11: fn_ai_session_generation_bump.
CREATE OR REPLACE FUNCTION public.fn_ai_session_generation_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
    FOR v_session IN SELECT DISTINCT s FROM pg_catalog.unnest(v_sessions) s WHERE s IS NOT NULL ORDER BY s LOOP
        PERFORM 1 FROM public.sessions WHERE id = v_session FOR UPDATE;
        CONTINUE WHEN NOT FOUND;
        INSERT INTO public.ai_deferred_session_refresh AS r (session_id, generation, updated_at)
        VALUES (v_session, 1, pg_catalog.now())
        ON CONFLICT (session_id) DO UPDATE SET generation = r.generation + 1, updated_at = pg_catalog.now();
    END LOOP;
    RETURN NULL;
END;
$$;

-- 19. 333 section 7: these four call no catalog function and name
-- only public. objects; only their path changes.
ALTER FUNCTION public.fn_ai_budget_thresholds(text, text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.fn_ai_budget_lock_counter(text, text, date) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.fn_ai_budget_alert_crossings(text, text, date) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.fn_ai_budget_ensure_refresh(uuid) SET search_path = pg_catalog, pg_temp;

-- 20. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    v_wrong text;
BEGIN
    -- Exactly the pinned path, no unqualified catalog call or table left in a
    -- body, SECURITY DEFINER, the owner of the table each writes or reads, no
    -- EXECUTE for PUBLIC (grantee 0) or a client role, and EXECUTE for
    -- service_role on exactly the 11 RPCs (the 333 contract).
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_ai_budget_thresholds(text,text)', false, 'public.ai_budget_counters'),
                   ('public.fn_ai_budget_lock_counter(text,text,date)', false, 'public.ai_budget_counters'),
                   ('public.fn_ai_budget_alert_crossings(text,text,date)', false, 'public.ai_budget_alerts'),
                   ('public.fn_ai_budget_active_raise(text)', false, 'public.ai_budget_raises'),
                   ('public.fn_ai_response_revision(uuid,text)', false, 'public.responses'),
                   ('public.fn_ai_patch_row(text,uuid,jsonb,text[])', false, 'public.responses'),
                   ('public.fn_ai_insert_row(text,jsonb,text[])', false, 'public.responses'),
                   ('public.fn_ai_budget_ensure_refresh(uuid)', false, 'public.ai_deferred_session_refresh'),
                   ('public.fn_ai_budget_release(uuid)', true, 'public.ai_budget_reservations'),
                   ('public.fn_ai_budget_expire(timestamptz)', true, 'public.ai_budget_reservations'),
                   ('public.fn_ai_budget_close_scope(text,date,text)', true, 'public.ai_budget_counters'),
                   ('public.fn_ai_budget_recompute(date)', false, 'public.ai_budget_counters'),
                   ('public.fn_ai_deferred_save(jsonb,jsonb)', true, 'public.ai_deferred_grading_jobs'),
                   ('public.fn_ai_deferred_claim(integer,integer)', true, 'public.ai_deferred_grading_jobs'),
                   ('public.fn_ai_deferred_claim_writing(integer,integer)', true, 'public.writing_jobs'),
                   ('public.fn_ai_deferred_aggregate_write(uuid,bigint,jsonb)', true, 'public.sessions'),
                   ('public.fn_ai_session_bands_write(uuid,bigint,jsonb,boolean,boolean)', true, 'public.sessions'),
                   ('public.fn_ai_class_sync(uuid)', true, 'public.class_assignment_items'),
                   ('public.fn_ai_budget_raise_record_end(uuid,text,uuid,text,text,text)', false,
                    'public.ai_budget_raise_events'),
                   ('public.fn_ai_budget_raise_end(uuid,uuid,text,text,text)', true, 'public.ai_budget_raises'),
                   ('public.fn_ai_budget_raise_expire_sweep(timestamptz)', true, 'public.ai_budget_raises'),
                   ('public.fn_ai_session_generation_bump()', false, 'public.ai_deferred_session_refresh')
           ) f(sig, service_exec, tbl)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
      JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) f.tbl::regclass
     WHERE NOT p.prosecdef
        OR p.proconfig IS NULL
        OR pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.<>) 'search_path=pg_catalog, pg_temp'
        OR p.prosrc OPERATOR(pg_catalog.~)
           ('(^|[^.[:alnum:]_])(array_agg|btrim|cardinality|char_length|convert_to|date_trunc|encode|format'
            '|gen_random_uuid|jsonb_agg|jsonb_array_length|jsonb_build_array|jsonb_build_object'
            '|jsonb_object_keys|jsonb_populate_record|jsonb_typeof|make_interval|now|quote_ident|sha256'
            '|string_agg|sum|to_jsonb|unnest)\s*\(')
        OR p.prosrc OPERATOR(pg_catalog.~*)
           ('(from|join|into|update)\s+(ai_budget_alerts|ai_budget_counters|ai_budget_raise_events'
            '|ai_budget_raises|ai_budget_reservations|ai_deferred_grading_jobs|ai_deferred_session_refresh'
            '|class_assignment_items|responses|sessions|writing_essays|writing_feedback|writing_jobs)'
            '([^.[:alnum:]_]|$)')
        OR p.proowner OPERATOR(pg_catalog.<>) c.relowner
        OR p.proacl IS NULL   -- NULL = default ACL, which includes PUBLIC EXECUTE
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee OPERATOR(pg_catalog.=) 0::oid)
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM f.service_exec;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_search_path_wrong: %', v_wrong;
    END IF;

    -- The generation trigger is on and calls the function above.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                    WHERE g.tgrelid OPERATOR(pg_catalog.=) 'public.responses'::regclass
                      AND g.tgname OPERATOR(pg_catalog.=) 'trg_ai_session_generation'
                      AND g.tgfoid OPERATOR(pg_catalog.=) 'public.fn_ai_session_generation_bump()'::regprocedure
                      AND g.tgenabled OPERATOR(pg_catalog.<>) 'D'
                      AND g.tgenabled OPERATOR(pg_catalog.<>) 'R') THEN
        RAISE EXCEPTION 'ai_budget_trigger_missing: public.responses.trg_ai_session_generation';
    END IF;
END $$;

COMMIT;
