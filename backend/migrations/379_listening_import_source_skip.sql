-- Migration 379: PAPERUPDATEDAT-0037 FR-008 (PC-J562, Q-J252-IMPORT "IMPORT a").
-- Importing a NEW Listening package (import_listening_content_package_atomic,
-- 295) still raised 55000 listening_package_child_immutable once 306 was
-- active, after 353: each INSERT into listening_content/listening_exercises
-- fires 306's trg_mock_paper_source, whose mock_content_revision UPDATE of the
-- parent listening_tests row is refused by 295's package guard (only the
-- import setting, not the status-transition setting, is set).
--   * FR-008: fn_guard_mock_paper_source no longer bumps
--     listening_tests.mock_content_revision for an INSERT or UPDATE on those
--     two tables whose target paper belongs to the package the import is
--     creating (content_package_id::text =
--     NULLIF(current_setting('app.listening_package_import', true), ''), the
--     transaction-local setting only the 295 import sets), while that package
--     is 'validated', was never published and the paper has no
--     listening_test_attempts row. Every other target (setting unset or
--     empty, another package, a package-less paper, a published, once
--     published or attempted package), DELETE and the 353 FR-007 status-only
--     rule behave exactly as before. The 295 guards are not changed and no
--     setting is added.
-- Only the 353 source guard body changes (search_path stays pinned to
-- pg_catalog, public, pg_temp, SECURITY DEFINER kept). No data, trigger, owner
-- or RLS change; the 306/353 ACL of the source guard is re-asserted. One
-- transaction, re-runnable; aborts unless 353's FR-007 body is installed.
-- Apply after 353, staging first by the Leader under the advisory lock;
-- production only at an authorised promotion.
-- Forward policy: pending_feature, group listening_import_source_skip.
-- Manual down script (restores the exact 353 body, reopens the import
-- failure): rollback/379_listening_import_source_skip.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $prerequisite$
DECLARE
    source CONSTANT regprocedure := to_regprocedure('public.fn_guard_mock_paper_source()');
BEGIN
    IF source IS NULL OR position(
           $fr007$status_only:=TG_OP='UPDATE' AND TG_TABLE_NAME IN ('listening_content','listening_exercises')$fr007$
           IN (SELECT prosrc FROM pg_proc WHERE oid = source)) = 0 THEN
        RAISE EXCEPTION 'listening_package_379_requires_353';
    END IF;
END;
$prerequisite$;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_source()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE b JSONB:=CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
        n JSONB:=CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
        refs JSONB:='[]'; x RECORD; status_only BOOLEAN; import_skip BOOLEAN;
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
        -- 379 (0037 FR-008): a Listening child INSERT/UPDATE whose paper
        -- belongs to the package the 295 import is creating (its
        -- transaction-local setting), still validated, never published and
        -- never attempted, is not a content revision. Checked per paper, so
        -- any other paper touched by the same write still bumps.
        import_skip:=FALSE;
        IF TG_OP<>'DELETE' AND TG_TABLE_NAME IN ('listening_content','listening_exercises')
           AND NULLIF(current_setting('app.listening_package_import',TRUE),'') IS NOT NULL THEN
            import_skip:=EXISTS(SELECT 1 FROM public.listening_tests t
                JOIN public.listening_content_packages p ON p.id=t.content_package_id
                WHERE t.id=x.id::UUID
                  AND t.content_package_id::TEXT=NULLIF(current_setting('app.listening_package_import',TRUE),'')
                  AND p.status='validated' AND p.published_at IS NULL
                  AND NOT EXISTS(SELECT 1 FROM public.listening_test_attempts a WHERE a.test_id=t.id));
        END IF;
        IF n-ARRAY['updated_at'] IS DISTINCT FROM b-ARRAY['updated_at'] AND NOT status_only AND NOT import_skip THEN
            IF x.kind='reading' THEN UPDATE public.reading_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID;
            ELSE UPDATE public.listening_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID; END IF;
        END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

-- 306/353 grants: the source guard stays service-role only.
REVOKE ALL ON FUNCTION public.fn_guard_mock_paper_source() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guard_mock_paper_source() TO service_role;

DO $postcondition$
DECLARE
    pinned CONSTANT TEXT[] := ARRAY['search_path=pg_catalog, public, pg_temp'];
    source CONSTANT regprocedure := 'public.fn_guard_mock_paper_source()'::regprocedure;
BEGIN
    IF (SELECT proconfig FROM pg_proc WHERE oid = source) IS DISTINCT FROM pinned
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = source)
       OR position('import_skip' IN (SELECT prosrc FROM pg_proc WHERE oid = source)) = 0 THEN
        RAISE EXCEPTION 'listening_package_379_function_shape';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
                LEFT JOIN pg_roles r ON r.oid = acl.grantee
               WHERE p.oid = source AND acl.privilege_type = 'EXECUTE'
                 AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))) THEN
        RAISE EXCEPTION 'listening_package_379_source_guard_client_execute';
    END IF;
END;
$postcondition$;

COMMIT;
