-- Migration 353: PAPERUPDATEDAT-0037 FR-006 + FR-007 (PC-J252 / PC-J512).
-- A Listening package publish/archive (set_listening_content_package_status,
-- 295) failed with 55000 listening_package_child_immutable once 306/308 were
-- active, so POST /admin/listening/packages/{id}/publish returned 503:
--   * FR-006: 306's trg_mock_paper_policy raises listening_tests.policy_revision
--     on the status/is_public change, which 295's package guard refused. 295's
--     guard now also accepts exactly that +1 step, only while the 306 contract
--     is active and status or is_public changes in the same UPDATE.
--   * FR-007: 306's trg_mock_paper_source raised mock_content_revision when the
--     RPC set listening_content/listening_exercises.status, and that nested
--     listening_tests UPDATE was refused by 295 as well. An UPDATE of those two
--     tables that changes only status (and optionally updated_at) no longer
--     bumps it; any other column change, INSERT and DELETE behave as before.
-- Only the two function bodies change (search_path pinned to
-- pg_catalog, public, pg_temp). No data, trigger, owner or RLS change; the
-- source guard's 306 ACL is re-asserted. One transaction, re-runnable.
-- Not covered (Q-J252-IMPORT, OPEN): importing a NEW package with 306 active
-- still raises 55000 on the INSERT path; that needs a separate decision.
-- Apply after 295 and 306, staging first by the Leader under the advisory lock
-- and STAGING_FREEZE; production only at an authorised promotion.
-- Forward policy: pending_feature, group listening_package_status_revision.
-- Manual down script (restores the exact 295/306 bodies, reopens the failure):
-- rollback/353_listening_package_status_revision.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $prerequisite$
BEGIN
    IF to_regprocedure('public.fn_protect_listening_package_child()') IS NULL
       OR to_regprocedure('public.fn_guard_mock_paper_source()') IS NULL THEN
        RAISE EXCEPTION 'listening_package_353_requires_295_306';
    END IF;
END;
$prerequisite$;

CREATE OR REPLACE FUNCTION public.fn_protect_listening_package_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_package_id UUID;
    v_new_package_id UUID;
    v_allowed_columns TEXT[];
BEGIN
    IF TG_TABLE_NAME = 'listening_lessons' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.package_id;
        ELSE
            v_package_id := OLD.package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.package_id; END IF;
        v_allowed_columns := ARRAY['status', 'updated_at'];
    ELSIF TG_TABLE_NAME = 'listening_package_stimuli' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.package_id;
        ELSE
            v_package_id := OLD.package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.package_id; END IF;
        v_allowed_columns := ARRAY[]::TEXT[];
    ELSIF TG_TABLE_NAME = 'listening_form_stimuli' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.package_id;
        ELSE
            v_package_id := OLD.package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.package_id; END IF;
        v_allowed_columns := ARRAY[]::TEXT[];
    ELSIF TG_TABLE_NAME = 'listening_tests' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.content_package_id;
        ELSE
            v_package_id := OLD.content_package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.content_package_id; END IF;
        v_allowed_columns := ARRAY['status', 'is_public', 'updated_at'];
        -- 353 (0037 FR-006): also accept the policy_revision step that the
        -- active 306 policy guard (trg_mock_paper_policy, which fires first
        -- and always overwrites policy_revision) derives from a status or
        -- visibility change. The package transition GUC and every other
        -- column are still checked below.
        IF TG_OP = 'UPDATE' THEN
            IF NEW.policy_revision = OLD.policy_revision + 1
               AND (NEW.status IS DISTINCT FROM OLD.status
                    OR NEW.is_public IS DISTINCT FROM OLD.is_public) THEN
                IF public.fn_mock_admission_contract_active() THEN
                    v_allowed_columns := v_allowed_columns || 'policy_revision'::TEXT;
                END IF;
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'listening_content' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_tests AS t WHERE t.id = NEW.test_id;
        ELSE
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_tests AS t WHERE t.id = OLD.test_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            SELECT t.content_package_id INTO v_new_package_id
              FROM public.listening_tests AS t WHERE t.id = NEW.test_id;
        END IF;
        v_allowed_columns := ARRAY['status', 'updated_at'];
    ELSIF TG_TABLE_NAME = 'listening_exercises' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_content AS c
              JOIN public.listening_tests AS t ON t.id = c.test_id
             WHERE c.id = NEW.content_id;
        ELSE
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_content AS c
              JOIN public.listening_tests AS t ON t.id = c.test_id
             WHERE c.id = OLD.content_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            SELECT t.content_package_id INTO v_new_package_id
              FROM public.listening_content AS c
              JOIN public.listening_tests AS t ON t.id = c.test_id
             WHERE c.id = NEW.content_id;
        END IF;
        v_allowed_columns := ARRAY['status', 'updated_at'];
    ELSE
        RAISE EXCEPTION 'listening_package_guard_table_unsupported'
            USING ERRCODE = '55000';
    END IF;

    v_package_id := COALESCE(v_package_id, v_new_package_id);
    IF v_package_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.listening_package_import', TRUE)
               IS DISTINCT FROM v_package_id::TEXT THEN
            RAISE EXCEPTION 'listening_package_child_immutable'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'listening_package_child_immutable'
            USING ERRCODE = '55000';
    END IF;
    IF current_setting('app.listening_package_status_transition', TRUE)
           IS DISTINCT FROM v_package_id::TEXT
       OR (to_jsonb(NEW) - v_allowed_columns) IS DISTINCT FROM
          (to_jsonb(OLD) - v_allowed_columns) THEN
        RAISE EXCEPTION 'listening_package_child_immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_source()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE b JSONB:=CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
        n JSONB:=CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
        refs JSONB:='[]'; x RECORD; status_only BOOLEAN;
BEGIN
    IF NOT public.fn_mock_admission_contract_active() THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    -- 353 (0037 FR-007): a Listening child UPDATE of only status (and
    -- updated_at) is not paper content and keeps mock_content_revision.
    status_only:=TG_OP='UPDATE' AND TG_TABLE_NAME IN ('listening_content','listening_exercises')
        AND n-ARRAY['status','updated_at'] IS NOT DISTINCT FROM b-ARRAY['status','updated_at'];
    IF TG_TABLE_NAME='reading_passages' THEN
        refs:=jsonb_build_array(jsonb_build_object('kind','reading','id',b->>'test_id'),jsonb_build_object('kind','reading','id',n->>'test_id'));
    ELSIF TG_TABLE_NAME='reading_questions' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','reading','id',p.test_id)),'[]') INTO refs
            FROM public.reading_passages p WHERE id IN (NULLIF(b->>'passage_id','')::UUID,NULLIF(n->>'passage_id','')::UUID);
    ELSIF TG_TABLE_NAME='listening_content' THEN
        refs:=jsonb_build_array(jsonb_build_object('kind','listening','id',b->>'test_id'),jsonb_build_object('kind','listening','id',n->>'test_id'));
    ELSIF TG_TABLE_NAME='listening_exercises' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','listening','id',s.test_id)),'[]') INTO refs
            FROM public.listening_content s WHERE id IN (NULLIF(b->>'content_id','')::UUID,NULLIF(n->>'content_id','')::UUID);
    ELSE
        refs:=jsonb_build_array(jsonb_build_object('kind','reading','id',b->>'reading_test_id'),
            jsonb_build_object('kind','reading','id',n->>'reading_test_id'),
            jsonb_build_object('kind','listening','id',b->>'listening_test_id'),
            jsonb_build_object('kind','listening','id',n->>'listening_test_id'));
    END IF;
    FOR x IN SELECT DISTINCT item->>'kind' kind,item->>'id' id FROM jsonb_array_elements(refs) item
        WHERE item->>'id' IS NOT NULL ORDER BY kind,id LOOP
        PERFORM public.fn_lock_mock_paper(x.kind,x.id::UUID);
        IF n-ARRAY['updated_at'] IS DISTINCT FROM b-ARRAY['updated_at'] AND NOT status_only THEN
            IF x.kind='reading' THEN UPDATE public.reading_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID;
            ELSE UPDATE public.listening_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID; END IF;
        END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

-- 306 grants: the source guard stays service-role only.
REVOKE ALL ON FUNCTION public.fn_guard_mock_paper_source() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guard_mock_paper_source() TO service_role;

DO $postcondition$
DECLARE
    pinned CONSTANT TEXT[] := ARRAY['search_path=pg_catalog, public, pg_temp'];
    child CONSTANT regprocedure := 'public.fn_protect_listening_package_child()'::regprocedure;
    source CONSTANT regprocedure := 'public.fn_guard_mock_paper_source()'::regprocedure;
BEGIN
    IF (SELECT proconfig FROM pg_proc WHERE oid = child) IS DISTINCT FROM pinned
       OR (SELECT proconfig FROM pg_proc WHERE oid = source) IS DISTINCT FROM pinned
       OR (SELECT prosecdef FROM pg_proc WHERE oid = child)
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = source) THEN
        RAISE EXCEPTION 'listening_package_353_function_shape';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
                LEFT JOIN pg_roles r ON r.oid = acl.grantee
               WHERE p.oid = source AND acl.privilege_type = 'EXECUTE'
                 AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))) THEN
        RAISE EXCEPTION 'listening_package_353_source_guard_client_execute';
    END IF;
END;
$postcondition$;

COMMIT;
