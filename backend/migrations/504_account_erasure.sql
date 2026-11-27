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
--    fn_account_erasure_row_allowed is true only for a row of the learner
--    whose request the CURRENT TRANSACTION is erasing: the function stamps
--    pg_current_xact_id() into the locked request row (erasing_xact), and
--    no other session can see or forge that value (SA-2 on #2600). The
--    transaction-local GUC aver.account_erasure_user is only a cheap hint:
--    the pass is a nested IF, so ordinary DML never reaches (or needs
--    EXECUTE on) the check functions (SA-1). Every other INSERT, UPDATE or
--    DELETE is handled exactly as before. The pass is injected into the
--    deployed definition (pg_get_functiondef) so it follows whatever the
--    database holds; a guard that does not exist here is skipped.
-- 3. The plan only names tables; its key columns must be the learner's own
--    (user_id, student_id, learner_id, user_feedback.created_by, users.id),
--    and a child delete must follow a real foreign key to its parent (SA-4).
-- Re-runnable: CREATE OR REPLACE, the injected pass carries a marker and is
-- never added twice. Rollback: rollback/504_account_erasure.sql removes the
-- pass from every guard and drops the three functions.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- SA-2: the transaction that is erasing this request (uncommitted, so only
-- that transaction sees it; an xid8 is never reused).
ALTER TABLE public.account_deletion_requests ADD COLUMN IF NOT EXISTS erasing_xact xid8;

-- Only fn_account_erase_learner (running as its owner) may write
-- erasing_xact; service_role updates the table but cannot stamp its own
-- transaction into it to open the narrow pass.
CREATE OR REPLACE FUNCTION public.fn_account_deletion_requests_xact_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.erasing_xact IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.erasing_xact END)
       AND current_user <> (SELECT p.proowner::regrole::name FROM pg_proc p
                             WHERE p.oid = 'public.fn_account_erase_learner(uuid,text,jsonb)'::regprocedure) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'erasing_xact is written by fn_account_erase_learner only';
    END IF;
    RETURN NEW;
END;
$$;

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
           AND d.erasing_xact = pg_current_xact_id_if_assigned()
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

-- SA-4: the only key columns a plan may use. Not SECURITY DEFINER; only
-- fn_account_erase_learner calls it.
CREATE OR REPLACE FUNCTION public.fn_account_erasure_key_ok(p_table text, p_key text, p_subject text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE
        WHEN p_key = 'student_id' THEN p_subject = 'student'
        WHEN p_key IN ('user_id', 'learner_id') THEN p_subject = 'user'
        WHEN p_table = 'user_feedback' AND p_key = 'created_by' THEN p_subject = 'user'
        WHEN p_table = 'users' AND p_key = 'id' THEN p_subject = 'user'
        ELSE false
    END
$$;

CREATE OR REPLACE FUNCTION public.fn_account_erase_learner(p_request uuid, p_owner text, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    req record;
    uid uuid;
    key_table text;
    key_col text;
    student_ids uuid[];
    login_email text;
    verified_alert_email text;
    deleted_alert_ids uuid[];
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
    -- FR-014 (c): an export worker whose lease is still live may yet upload a
    -- package, and its export row is the only fence against that. Lock the
    -- rows (a renew or complete waits for this transaction) and change nothing
    -- while any lease is live; the job releases and retries after the lease.
    PERFORM 1 FROM public.account_data_exports WHERE user_id = uid FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.account_data_exports WHERE user_id = uid AND lease_until >= now()) THEN
        RETURN jsonb_build_object('waiting_export', true);
    END IF;
    -- SA-4: check every key column before any change.
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'delete', '[]'::jsonb)) LOOP
        key_table := CASE WHEN item ? 'parent' THEN item ->> 'parent' ELSE item ->> 'table' END;
        key_col := CASE WHEN item ? 'parent' THEN item ->> 'parent_column' ELSE item ->> 'column' END;
        IF NOT coalesce(public.fn_account_erasure_key_ok(key_table, key_col, item ->> 'subject'), false)
           OR (item ? 'parent' AND to_regclass(format('public.%I', item ->> 'table')) IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM pg_constraint k
                     JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                     JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
                    WHERE k.contype = 'f' AND cardinality(k.conkey) = 1
                      AND k.conrelid = format('public.%I', item ->> 'table')::regclass
                      AND k.confrelid = to_regclass(format('public.%I', item ->> 'parent'))
                      AND a.attname = item ->> 'column' AND pa.attname = 'id')) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('account_erasure_bad_key: %s', item);
        END IF;
    END LOOP;
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'scrub', '[]'::jsonb))
                UNION ALL SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'anonymize', '[]'::jsonb)) LOOP
        IF NOT coalesce(public.fn_account_erasure_key_ok(item ->> 'table', item ->> 'match', item ->> 'subject'), false) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('account_erasure_bad_key: %s', item);
        END IF;
    END LOOP;

    -- SA-2: bind the narrow pass to this transaction.
    UPDATE public.account_deletion_requests SET erasing_xact = pg_current_xact_id() WHERE id = p_request;
    PERFORM set_config('aver.account_erasure_user', uid::text, true);
    PERFORM set_config('aver.account_erasure_owner', p_owner, true);
    SELECT coalesce(array_agg(s.id), '{}') INTO student_ids FROM public.students s WHERE s.user_id = uid;
    SELECT u.email INTO login_email FROM public.users u WHERE u.id = uid;

    -- Guest alerts belong to this account only when their email matches the
    -- verified Auth address. A different account's rows always stay intact.
    IF to_regclass('public.course_open_alerts') IS NOT NULL THEN
        SELECT lower(u.email) INTO verified_alert_email
          FROM auth.users u
         WHERE u.id = uid AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL;

        WITH deleted_alerts AS (
            DELETE FROM public.course_open_alerts a
             WHERE a.user_id = uid
                OR (a.user_id IS NULL AND lower(a.email) = verified_alert_email)
            RETURNING a.id
        )
        SELECT array_agg(id) INTO deleted_alert_ids FROM deleted_alerts;
        counts := counts || jsonb_build_object('course_open_alerts', coalesce(cardinality(deleted_alert_ids), 0));

        -- Enqueue locks the alert row before writing the outbox. A separate
        -- statement sees any mail committed while the DELETE waited for it.
        DELETE FROM public.learner_email_outbox o
         USING unnest(deleted_alert_ids) AS alert(id)
         WHERE o.template = 'course_open_alert' AND o.status = 'pending'
           AND (o.dedupe_key = 'open_alert:' || alert.id::text OR o.payload ->> 'alert_id' = alert.id::text);
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object('course_open_alert_pending_mail', n);

        DELETE FROM public.course_open_alert_attempts WHERE rate_key = 'user:' || uid::text;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object('course_open_alert_attempts', n);
    END IF;

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
REVOKE ALL ON FUNCTION public.fn_account_erasure_key_ok(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_account_erase_learner(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_account_erase_learner(uuid, text, jsonb) TO service_role;
-- SA-1: the backend's own writes may reach the inner check (only after it
-- set the hint GUC itself); grant it explicitly rather than relying on
-- default privileges. A forged hint still fails: the check needs erasing_xact.
GRANT EXECUTE ON FUNCTION public.fn_account_erasure_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_account_erasure_row_allowed(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_account_erasure_scrub_allowed(text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_account_deletion_requests_xact_guard() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_account_deletion_requests_xact_guard
    BEFORE INSERT OR UPDATE ON public.account_deletion_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_account_deletion_requests_xact_guard();

-- The narrow pass, injected right after each guard's top-level BEGIN.
DO $$
DECLARE
    -- Nested IF (SA-1): PL/pgSQL prepares an expression only when it is
    -- reached, so without the hint GUC no check function is initialised and
    -- no EXECUTE privilege is needed. Keep these strings in step with the
    -- rollback, which removes them verbatim.
    delete_pass CONSTANT text := ' /* ACCOUNTDATA-0100 erasure pass */ IF TG_OP = ''DELETE'' AND '
        'coalesce(current_setting(''aver.account_erasure_user'', true), '''') <> '''' THEN '
        'IF public.fn_account_erasure_row_allowed(to_jsonb(OLD)) THEN RETURN OLD; END IF; END IF;';
    scrub_pass CONSTANT text := ' /* ACCOUNTDATA-0100 erasure pass */ IF TG_OP = ''UPDATE'' AND '
        'coalesce(current_setting(''aver.account_erasure_user'', true), '''') <> '''' THEN '
        'IF public.fn_account_erasure_scrub_allowed(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; END IF;';
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
    FOREACH f IN ARRAY ARRAY['fn_account_erase_learner(uuid,text,jsonb)', 'fn_account_erasure_user()',
                             'fn_account_erasure_row_allowed(jsonb)',
                             'fn_account_erasure_scrub_allowed(text,jsonb,jsonb)'] LOOP
        IF NOT has_function_privilege('service_role', 'public.' || f, 'EXECUTE') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = format('504 service_role cannot run %s', f);
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.fn_account_erasure_key_ok(text,text,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_account_erasure_key_ok(text,text,text)', 'EXECUTE')
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.account_deletion_requests'::regclass
                       AND attname = 'erasing_xact' AND atttypid = 'xid8'::regtype AND NOT attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.account_deletion_requests'::regclass
                       AND tgname = 'trg_account_deletion_requests_xact_guard' AND NOT tgisinternal) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '504 key check or erasing_xact postcondition failed';
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
