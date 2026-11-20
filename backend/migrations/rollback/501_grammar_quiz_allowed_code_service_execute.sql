-- Rollback of 501_grammar_quiz_allowed_code_service_execute.sql.
-- Re-blocks every service_role INSERT/UPDATE of quiz_banks (42501), as after
-- 309. Remove the ledger row only under a separately reviewed decision.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.grammar_quiz_allowed_code(text) FROM service_role;
DO $$
BEGIN
    IF pg_catalog.has_function_privilege('service_role', 'public.grammar_quiz_allowed_code(text)'::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'rollback_501_postcondition: service_role still executes grammar_quiz_allowed_code';
    END IF;
END $$;
COMMIT;
