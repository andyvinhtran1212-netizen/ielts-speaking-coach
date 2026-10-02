-- MOCKREPAIR-0016: opt-in only, AFTER the exact new backend deployment.
-- Operator verifies the running backend SHA and sets this session value;
-- absence is a hard failure, never an automatic migration-before-code toggle.
BEGIN;
DO $$ DECLARE runtime_sha TEXT:=current_setting('mock_paper.deployed_backend_sha',TRUE);
BEGIN
    IF runtime_sha IS NULL OR runtime_sha !~ '^[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'mock_paper_activation_requires_verified_backend_sha';
    END IF;
    IF to_regprocedure('public.fn_mock_admission_contract_active()') IS NULL THEN
        RAISE EXCEPTION 'mock_paper_activation_requires_additive_migration';
    END IF;
    EXECUTE 'CREATE OR REPLACE FUNCTION public.fn_mock_admission_contract_active() RETURNS BOOLEAN
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS ''SELECT TRUE''';
    EXECUTE format('COMMENT ON FUNCTION public.fn_mock_admission_contract_active() IS %L',
        'Frozen admission activated after verified backend SHA '||runtime_sha);
END $$;
REVOKE ALL ON FUNCTION public.fn_mock_admission_contract_active() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mock_admission_contract_active() TO service_role;
COMMIT;
