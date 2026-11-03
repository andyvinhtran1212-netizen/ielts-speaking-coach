-- Manual rollback for 353 / PAPERUPDATEDAT-0037 FR-006 + FR-007.
-- Restores the exact 295 fn_protect_listening_package_child and 306
-- fn_guard_mock_paper_source bodies (search_path public, pg_temp). That
-- reopens the failure: a Listening package publish/archive raises 55000
-- listening_package_child_immutable while the 306 contract is active.
--
-- NOT a forward migration: it lives outside backend/migrations/*.sql, so the
-- runner never applies it. Run it by hand, as the migration owner, only with
-- explicit Leader rollback authorization:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/rollback/353_listening_package_status_revision.sql
-- then delete the ledger row in the same session if 353 should be re-applied
-- later: DELETE FROM public._schema_migrations WHERE filename='353_listening_package_status_revision.sql';
-- No data, trigger, owner, grant or RLS change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION public.fn_protect_listening_package_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
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
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b JSONB:=CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
        n JSONB:=CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
        refs JSONB:='[]'; x RECORD;
BEGIN
    IF NOT public.fn_mock_admission_contract_active() THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
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
        IF n-ARRAY['updated_at'] IS DISTINCT FROM b-ARRAY['updated_at'] THEN
            IF x.kind='reading' THEN UPDATE public.reading_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID;
            ELSE UPDATE public.listening_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID; END IF;
        END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

COMMIT;
