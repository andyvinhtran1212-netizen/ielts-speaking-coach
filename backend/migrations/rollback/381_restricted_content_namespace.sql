-- Manual rollback M-A, only after 382 rollback and while importer/code gates
-- are closed. Refuse ANY restricted data; keep flags and data even on rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.listening_tests, public.listening_content, public.listening_test_attempts,
    public.dictation_sessions, public.mock_paper_attempt_snapshots, public.content_access_namespaces
    IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF public.fn_content_namespace_ready() IS DISTINCT FROM true
       OR EXISTS (SELECT 1 FROM public.listening_tests WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.listening_content WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.listening_test_attempts WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.dictation_sessions WHERE restricted IS DISTINCT FROM false)
       OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc AS p
            WHERE p.oid = 'public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure)
              IS DISTINCT FROM '736792efaf56a5f3c1a3db6b33a6ab6a' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '381 rollback unsafe: restore 382 first; restricted data requires roll forward';
    END IF;
END;
$$;
DROP VIEW public.v_listening_tests_public, public.v_listening_content_public,
    public.v_listening_attempts_public, public.v_dictation_sessions_public;
DROP TRIGGER trg_content_namespace_stamp ON public.listening_tests;
DROP TRIGGER trg_content_namespace_stamp ON public.listening_content;
DROP TRIGGER trg_content_namespace_stamp ON public.listening_test_attempts;
DROP TRIGGER trg_content_namespace_stamp ON public.dictation_sessions;
DROP TRIGGER trg_content_namespace_cascade ON public.listening_tests;
DROP TRIGGER trg_content_namespace_cascade ON public.listening_content;
DROP TRIGGER trg_content_namespace_snapshot ON public.mock_paper_attempt_snapshots;
DROP FUNCTION public.fn_content_namespace_ready(), public.fn_stamp_content_namespace(),
    public.fn_cascade_content_namespace(), public.fn_stamp_snapshot_content_namespace(),
    public.fn_namespace_content_restricted(uuid,uuid,uuid,uuid,jsonb),
    public.fn_namespace_dictation_restricted(uuid,text), public.fn_content_is_restricted(text,uuid),
    public.fn_namespace_matches(text,jsonb);
DROP INDEX public.ix_listening_tests_unrestricted, public.ix_listening_content_unrestricted,
    public.ix_listening_attempts_unrestricted, public.ix_dictation_sessions_unrestricted;
DROP TABLE public.content_access_namespaces;
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.content_access_namespaces') IS NOT NULL
       OR pg_catalog.to_regclass('public.v_listening_tests_public') IS NOT NULL
       OR pg_catalog.to_regclass('public.v_listening_content_public') IS NOT NULL
       OR pg_catalog.to_regclass('public.v_listening_attempts_public') IS NOT NULL
       OR pg_catalog.to_regclass('public.v_dictation_sessions_public') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname IN (
                       'fn_namespace_matches', 'fn_content_is_restricted', 'fn_namespace_content_restricted',
                       'fn_namespace_dictation_restricted', 'fn_stamp_content_namespace', 'fn_cascade_content_namespace',
                       'fn_stamp_snapshot_content_namespace', 'fn_content_namespace_ready'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t WHERE NOT t.tgisinternal
                   AND t.tgname IN ('trg_content_namespace_stamp','trg_content_namespace_cascade','trg_content_namespace_snapshot'))
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS a
            WHERE a.attrelid IN ('public.listening_tests'::pg_catalog.regclass, 'public.listening_content'::pg_catalog.regclass,
                                'public.listening_test_attempts'::pg_catalog.regclass, 'public.dictation_sessions'::pg_catalog.regclass)
              AND a.attname = 'restricted' AND a.attnotnull AND NOT a.attisdropped) <> 4 THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '381 rollback postcondition failed';
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
