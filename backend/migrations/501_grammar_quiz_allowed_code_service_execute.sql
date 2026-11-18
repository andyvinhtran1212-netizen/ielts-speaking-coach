-- Migration: 501_grammar_quiz_allowed_code_service_execute.sql
-- GRAMMARAUDIT-0019 FR-008 forward correction ("existing non-Grammar ...
-- behavior remains compatible"). 309 added the quiz_banks CHECK
-- quiz_banks_grammar_revision_shape, which calls
-- public.grammar_quiz_allowed_code(text). The same migration's blanket loop
-- (repeated by 314 and 339) revoked EXECUTE on every grammar_quiz_% function
-- from service_role. A CHECK expression runs with the writer's privileges, so
-- since 309 every service_role INSERT/UPDATE of quiz_banks through PostgREST
-- fails with 42501 "permission denied for function grammar_quiz_allowed_code":
-- the course exercise importers and PATCH /admin/quiz/banks/{id} included.
--
-- This grants EXECUTE on that one function to service_role and nothing else.
-- The function is a non-definer, IMMUTABLE LANGUAGE sql predicate over a fixed
-- list of public Grammar Wiki codes; it reads no table, holds no private
-- identifier and runs as the caller, so the grant exposes no data or owner
-- privilege. anon, authenticated and PUBLIC stay without EXECUTE. Every other
-- grammar_quiz_% ACL, the CHECK and the bank guard are unchanged.
--
-- Needs 309 and 314 in the ledger. No apply on merge: pending_feature
-- course_bank_service_write; use the advisory-locked runner with
-- MIGRATION_FEATURES=course_bank_service_write, staging first, production
-- only at an explicitly authorised staging -> main promotion.
-- Re-running 309, 314 or 339 revokes the grant again; re-run 501 afterwards.
-- ROLLBACK: rollback/501_grammar_quiz_allowed_code_service_execute.sql
-- (re-blocks service_role writes to quiz_banks). No backend change.

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL
       OR (SELECT pg_catalog.count(*) FROM public._schema_migrations m
            WHERE m.filename IN ('309_grammar_quiz_revision_cutover.sql',
                                 '314_grammar_audit_reviewed_publication.sql')) <> 2 THEN
        RAISE EXCEPTION 'migration_501_prerequisite_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regprocedure('public.grammar_quiz_allowed_code(text)') IS NULL
       OR pg_catalog.to_regclass('public.quiz_banks') IS NULL THEN
        RAISE EXCEPTION 'migration_501_prerequisite_missing: objects';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                WHERE p.oid = 'public.grammar_quiz_allowed_code(text)'::regprocedure
                  AND (p.prosecdef OR p.provolatile <> 'i' OR p.prorettype <> 'boolean'::regtype
                       OR p.prolang <> (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'sql'))) THEN
        RAISE EXCEPTION 'migration_501_unexpected_function: grammar_quiz_allowed_code is not a non-definer immutable SQL predicate';
    END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.grammar_quiz_allowed_code(text) TO service_role;

-- Postconditions
DO $$
DECLARE
    f CONSTANT oid := 'public.grammar_quiz_allowed_code(text)'::regprocedure;
BEGIN
    IF NOT pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') THEN
        RAISE EXCEPTION 'migration_501_postcondition: service_role cannot execute grammar_quiz_allowed_code';
    END IF;
    IF pg_catalog.has_function_privilege('anon', f, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = f AND a.grantee = 0::oid) THEN
        RAISE EXCEPTION 'migration_501_postcondition: grammar_quiz_allowed_code is client-executable';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = f AND (p.prosecdef OR p.provolatile <> 'i')) THEN
        RAISE EXCEPTION 'migration_501_postcondition: grammar_quiz_allowed_code shape changed';
    END IF;
END $$;

COMMIT;
