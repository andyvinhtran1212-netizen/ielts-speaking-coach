-- Manual rollback for 379 / PAPERUPDATEDAT-0037 FR-008.
-- Restores the exact 353 fn_guard_mock_paper_source body (search_path
-- pg_catalog, public, pg_temp; SECURITY DEFINER; 353 FR-007 status-only rule
-- kept). That reopens the import failure: importing a NEW Listening package
-- raises 55000 listening_package_child_immutable while the 306 contract is
-- active. CREATE OR REPLACE keeps the 306/353 grants.
--
-- NOT a forward migration: it lives outside backend/migrations/*.sql, so the
-- runner never applies it. Run it by hand, as the migration owner, only with
-- explicit Leader rollback authorization:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/rollback/379_listening_import_source_skip.sql
-- then delete the ledger row in the same session if 379 should be re-applied
-- later: DELETE FROM public._schema_migrations WHERE filename='379_listening_import_source_skip.sql';
-- No data, trigger, owner, grant or RLS change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

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

COMMIT;
