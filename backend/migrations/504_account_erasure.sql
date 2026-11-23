-- ACCOUNTDATA-0100 T005 (G04-T18), amendments 1 and 2 (Andy, 2026-11-23).
-- The erasure step that runs in the database (plan section 5, step 5).
-- No apply on merge: pending_feature account_data_rights, after 500. Staging
-- first under the advisory lock with MIGRATION_FEATURES=account_data_rights
-- after review and Andy's typed approval; production only at an authorised
-- staging-to-main promotion.
--
-- 1. fn_account_erase_learner(request, owner, plan): one transaction that
--    locks the request row FOR UPDATE, checks the lease owner, then deletes,
--    anonymises and scrubs one learner's rows as the backend's plan lists
--    them (services/account_erasure.py builds it from the inventory). Every
--    statement is keyed by that learner's user id or student ids; the plan
--    only chooses tables and columns. SECURITY DEFINER, EXECUTE for
--    service_role only (CR nit on #2501).
-- 2. A narrow pass in the guards that refuse DELETE to keep grading evidence
--    (and in the class_action_log append-only guard, for student_name only).
--    The function sets a transaction-local context naming the learner and
--    its owner; fn_account_erasure_row_allowed is true only for a row of
--    that learner while that learner's request is 'erasing' under that
--    owner. Every other UPDATE or DELETE is refused exactly as before. The
--    pass is injected into the deployed definition (pg_get_functiondef) so
--    it follows whatever the database holds; a guard that does not exist
--    here is skipped.
-- Re-runnable: CREATE OR REPLACE, the injected pass carries a marker and is
-- never added twice. Rollback: rollback/504_account_erasure.sql removes the
-- pass from every guard and drops the three functions.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_account_erasure_user()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    uid uuid;
BEGIN
    uid := NULLIF(current_setting('aver.account_erasure_user', true), '')::uuid;
    IF uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.account_deletion_requests d
         WHERE d.user_id = uid AND d.status = 'erasing'
           AND d.erasing_owner = current_setting('aver.account_erasure_owner', true)
    ) THEN
        RETURN NULL;
    END IF;
    RETURN uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_account_erasure_row_allowed(p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    uid uuid := public.fn_account_erasure_user();
BEGIN
    IF uid IS NULL OR p_row IS NULL THEN
        RETURN false;
    END IF;
    IF p_row ->> 'user_id' = uid::text OR p_row ->> 'learner_id' = uid::text THEN
        RETURN true;
    END IF;
    RETURN p_row ? 'student_id' AND EXISTS (
        SELECT 1 FROM public.students s WHERE s.id::text = p_row ->> 'student_id' AND s.user_id = uid);
END;
$$;

-- class_action_log is append-only (mig 198). Amendment 1: only student_name
-- may change, only to NULL, only on the erased learner's rows.
CREATE OR REPLACE FUNCTION public.fn_account_erasure_scrub_allowed(p_table text, p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN p_table = 'class_action_log'
       AND public.fn_account_erasure_row_allowed(p_old)
       AND p_new = jsonb_set(p_old, '{student_name}', 'null'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_account_erase_learner(p_request uuid, p_owner text, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    req record;
    uid uuid;
    student_ids uuid[];
    login_email text;
    item jsonb;
    tbl text;
    col text;
    ids text[];
    sets text[];
    c record;
    keep text[];
    n bigint;
    counts jsonb := '{}'::jsonb;
    skipped jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO req FROM public.account_deletion_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND OR req.status <> 'erasing' OR req.erasing_owner IS DISTINCT FROM p_owner THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'account_erasure_not_owner';
    END IF;
    uid := req.user_id;
    PERFORM set_config('aver.account_erasure_user', uid::text, true);
    PERFORM set_config('aver.account_erasure_owner', p_owner, true);
    SELECT coalesce(array_agg(s.id), '{}') INTO student_ids FROM public.students s WHERE s.user_id = uid;
    SELECT u.email INTO login_email FROM public.users u WHERE u.id = uid;

    -- Deletes, in the plan's order (rows whose foreign keys do not cascade
    -- first). subject 'student' → students.id of the learner, else user id.
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'delete', '[]'::jsonb)) LOOP
        tbl := item ->> 'table';
        col := item ->> 'column';
        IF to_regclass(format('public.%I', tbl)) IS NULL THEN
            skipped := skipped || jsonb_build_object('table', tbl, 'reason', 'table_not_present');
            CONTINUE;
        END IF;
        ids := CASE WHEN item ->> 'subject' = 'student' THEN student_ids::text[] ELSE ARRAY[uid::text] END;
        IF item ? 'parent' THEN
            EXECUTE format('DELETE FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE %I::text = ANY($1))',
                           tbl, col, item ->> 'parent', item ->> 'parent_column') USING ids;
        ELSE
            EXECUTE format('DELETE FROM public.%I WHERE %I::text = ANY($1)', tbl, col) USING ids;
        END IF;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object(tbl || '.' || col, coalesce((counts ->> (tbl || '.' || col))::bigint, 0) + n);
    END LOOP;

    -- Free-text columns of kept rows → NULL (learner_note, student_name).
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'scrub', '[]'::jsonb)) LOOP
        tbl := item ->> 'table';
        IF to_regclass(format('public.%I', tbl)) IS NULL THEN
            skipped := skipped || jsonb_build_object('table', tbl, 'reason', 'table_not_present');
            CONTINUE;
        END IF;
        ids := CASE WHEN item ->> 'subject' = 'student' THEN student_ids::text[] ELSE ARRAY[uid::text] END;
        EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I::text = ANY($1) AND %I IS NOT NULL',
                       tbl, item ->> 'column', item ->> 'match', item ->> 'column') USING ids;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object('scrub:' || tbl || '.' || (item ->> 'column'), n);
    END LOOP;

    -- JSON keys holding the learner's email in kept logs.
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'json_keys', '[]'::jsonb)) LOOP
        tbl := item ->> 'table';
        IF login_email IS NULL OR to_regclass(format('public.%I', tbl)) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format('UPDATE public.%I SET %I = %I - $1 WHERE lower(%I ->> $1) = lower($2)',
                       tbl, item ->> 'column', item ->> 'column', item ->> 'column')
            USING item ->> 'key', login_email;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object('json:' || tbl || '.' || (item ->> 'column') || '.' || (item ->> 'key'), n);
    END LOOP;

    -- Anonymise (users, students): every column not kept becomes its
    -- tombstone, else NULL when nullable, else its default.
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'anonymize', '[]'::jsonb)) LOOP
        tbl := item ->> 'table';
        IF to_regclass(format('public.%I', tbl)) IS NULL THEN
            CONTINUE;
        END IF;
        keep := ARRAY(SELECT jsonb_array_elements_text(coalesce(item -> 'keep', '[]'::jsonb)));
        sets := '{}';
        FOR c IN
            SELECT a.attname, a.attnotnull, (d.adbin IS NOT NULL) AS has_default
              FROM pg_attribute a
              LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid = format('public.%I', tbl)::regclass AND a.attnum > 0
               AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
             ORDER BY a.attnum
        LOOP
            CONTINUE WHEN c.attname = ANY(keep);
            IF item -> 'tombstones' ? c.attname THEN
                sets := sets || format('%I = %L', c.attname,
                                       replace(item -> 'tombstones' ->> c.attname, '{uid}', uid::text));
            ELSIF item -> 'values' ? c.attname THEN
                sets := sets || format('%I = %L', c.attname, item -> 'values' ->> c.attname);
            ELSIF NOT c.attnotnull THEN
                sets := sets || format('%I = NULL', c.attname);
            ELSIF c.has_default THEN
                sets := sets || format('%I = DEFAULT', c.attname);
            ELSE
                skipped := skipped || jsonb_build_object('table', tbl, 'column', c.attname, 'reason', 'not_null_without_default');
            END IF;
        END LOOP;
        IF cardinality(sets) > 0 THEN
            ids := CASE WHEN item ->> 'subject' = 'student' THEN student_ids::text[] ELSE ARRAY[uid::text] END;
            EXECUTE format('UPDATE public.%I SET %s WHERE %I::text = ANY($1)',
                           tbl, array_to_string(sets, ', '), item ->> 'match') USING ids;
            GET DIAGNOSTICS n = ROW_COUNT;
            counts := counts || jsonb_build_object('anonymize:' || tbl, n);
        END IF;
    END LOOP;

    -- FR-007: assignments only lose is_active; redemption fields never change.
    UPDATE public.user_code_assignments SET is_active = false, revoked_at = coalesce(revoked_at, now())
     WHERE user_id = uid AND is_active;
    GET DIAGNOSTICS n = ROW_COUNT;
    counts := counts || jsonb_build_object('user_code_assignments.is_active', n);
    DELETE FROM public.account_data_exports WHERE user_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT;
    counts := counts || jsonb_build_object('account_data_exports.user_id', n);

    UPDATE public.account_deletion_requests SET step_done = 'database'
     WHERE id = p_request AND erasing_owner = p_owner;
    RETURN jsonb_build_object('counts', counts, 'skipped', skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_account_erasure_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_account_erasure_row_allowed(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_account_erasure_scrub_allowed(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_account_erase_learner(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_account_erase_learner(uuid, text, jsonb) TO service_role;

-- The narrow pass, injected right after each guard's top-level BEGIN.
DO $$
DECLARE
    delete_pass CONSTANT text := ' /* ACCOUNTDATA-0100 erasure pass */ IF TG_OP = ''DELETE'' AND '
        'public.fn_account_erasure_row_allowed(to_jsonb(OLD)) THEN RETURN OLD; END IF;';
    scrub_pass CONSTANT text := ' /* ACCOUNTDATA-0100 erasure pass */ IF TG_OP = ''UPDATE'' AND '
        'public.fn_account_erasure_scrub_allowed(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;';
    guards CONSTANT text[] := ARRAY[
        'advanced_vocab_guard_listening_attempt', 'advanced_vocab_guard_selection',
        'advanced_vocab_guard_question_attempt', 'advanced_vocab_guard_stage_progress',
        'advanced_vocab_guard_course_section', 'protect_advanced_vocab_item_evidence',
        'prevent_grammar_evidence_mutation', 'prevent_completed_grammar_session_mutation',
        'protect_full_grammar_lesson_history', 'fn_learner_goal_events_append_only',
        'grammar_quiz_guard_progress', 'grammar_quiz_guard_session',
        'fn_class_action_log_append_only'];
    g text;
    fn regprocedure;
    def text;
    patched text;
BEGIN
    FOREACH g IN ARRAY guards LOOP
        fn := to_regprocedure(format('public.%I()', g));
        IF fn IS NULL THEN
            RAISE NOTICE '504: guard % not present, skipped', g;
            CONTINUE;
        END IF;
        def := pg_get_functiondef(fn);
        IF position('ACCOUNTDATA-0100 erasure pass' IN def) > 0 THEN
            CONTINUE;
        END IF;
        -- The body's top-level BEGIN: the first BEGIN that opens a line (or
        -- follows the opening dollar quote), so a comment saying "begin"
        -- is never matched.
        patched := regexp_replace(def, '((\$[A-Za-z_]*\$|\n)\s*)BEGIN\M',
            '\1BEGIN' || CASE WHEN g = 'fn_class_action_log_append_only' THEN scrub_pass ELSE delete_pass END, 'i');
        IF patched = def THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = format('504: no BEGIN found in guard %s', g);
        END IF;
        EXECUTE patched;
    END LOOP;
END;
$$;

-- Postconditions.
DO $$
DECLARE
    f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['fn_account_erasure_user()', 'fn_account_erasure_row_allowed(jsonb)',
                             'fn_account_erasure_scrub_allowed(text,jsonb,jsonb)',
                             'fn_account_erase_learner(uuid,text,jsonb)'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || f) AND p.prosecdef
                         AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%')
           OR has_function_privilege('anon', 'public.' || f, 'EXECUTE')
           OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = format('504 function postcondition failed: %s', f);
        END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', 'public.fn_account_erase_learner(uuid,text,jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '504 service_role cannot run the erasure function';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('advanced_vocab_guard_listening_attempt', 'advanced_vocab_guard_selection',
                             'advanced_vocab_guard_question_attempt', 'advanced_vocab_guard_stage_progress',
                             'advanced_vocab_guard_course_section', 'protect_advanced_vocab_item_evidence',
                             'prevent_grammar_evidence_mutation', 'prevent_completed_grammar_session_mutation',
                             'protect_full_grammar_lesson_history', 'fn_learner_goal_events_append_only',
                             'grammar_quiz_guard_progress', 'grammar_quiz_guard_session',
                             'fn_class_action_log_append_only')
           AND p.pronargs = 0
           AND position('ACCOUNTDATA-0100 erasure pass' IN pg_get_functiondef(p.oid)) = 0
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '504 a present guard has no erasure pass';
    END IF;
END;
$$;

COMMIT;
