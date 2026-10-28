-- Migration: 338_reading_listening_paper_updated_at.sql
--
-- PAPERUPDATEDAT-0037 (Security Auditor, AVR-READ-002 is_public flip,
-- 2026-10-28). reading_tests/listening_tests.updated_at only had DEFAULT now()
-- (086, 065): no trigger maintained it, the is_public/status/metadata writers
-- leave it out of their SET lists, and fn_guard_mock_paper_policy (306)
-- deliberately ignores it. On production AVR-READ-002 was hidden through the
-- admin Reading visibility toggle at 2026-10-28 02:15:04Z (release event
-- 741f775e, policy_revision 0 -> 1) while updated_at stayed at 2026-05-30, so
-- updated_at could not be trusted as "last changed". reading_passages,
-- reading_questions and listening_content had the same gap.
-- listening_exercises is already maintained by 208's
-- trg_listening_exercises_updated_at and is not touched here.
--
-- Fix. One BEFORE UPDATE ... FOR EACH ROW trigger per table,
-- update_<table>_updated_at, calling the existing
-- public.update_updated_at_column() (033, search_path pinned by 108). Every
-- UPDATE, by any writer (admin RPCs, the Mock Test copy, PostgREST with the
-- service key, raw SQL), now sets updated_at = now(), overriding an explicit
-- value. INSERT is unchanged.
--
-- Guards stay intact. PostgreSQL fires same-timing row triggers in name order,
-- so trg_mock_paper_policy, trg_mock_paper_source and
-- trg_protect_listening_package_child all run before update_* and see the
-- writer's row. All three already exclude or allow-list updated_at, so
-- policy_revision, mock_correction_release_events and mock_content_revision
-- behave exactly as before, and guard refusals still abort the statement. The
-- postcondition pins that ordering.
--
-- No data is changed (no backfill of historical updated_at). Re-runnable:
-- CREATE OR REPLACE TRIGGER (PostgreSQL 14+) takes SHARE ROW EXCLUSIVE, like
-- CREATE TRIGGER, and never needs a DROP.
--
-- Verify (read-only):
--   SELECT c.relname, t.tgname, t.tgenabled
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname LIKE 'update\_%\_updated\_at' AND c.relnamespace = 'public'::regnamespace
--      AND c.relname IN ('reading_tests','listening_tests','reading_passages',
--                        'reading_questions','listening_content')
--    ORDER BY 1;
--   -- expect 5 rows, tgenabled = 'O'
--
-- Rollback (forward migration; updated_at simply stops advancing again):
--   DROP TRIGGER IF EXISTS update_reading_tests_updated_at ON public.reading_tests;
--   DROP TRIGGER IF EXISTS update_listening_tests_updated_at ON public.listening_tests;
--   DROP TRIGGER IF EXISTS update_reading_passages_updated_at ON public.reading_passages;
--   DROP TRIGGER IF EXISTS update_reading_questions_updated_at ON public.reading_questions;
--   DROP TRIGGER IF EXISTS update_listening_content_updated_at ON public.listening_content;

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    paper_tables TEXT[] := ARRAY['reading_tests','listening_tests','reading_passages',
                                 'reading_questions','listening_content'];
    name TEXT;
BEGIN
    IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
        RAISE EXCEPTION 'migration_338_precondition: public.update_updated_at_column() is missing (033)'
            USING ERRCODE = '55000';
    END IF;
    FOREACH name IN ARRAY ARRAY['reading_tests','listening_tests'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                        WHERE t.tgrelid = to_regclass('public.' || name)
                          AND t.tgname = 'trg_mock_paper_policy' AND NOT t.tgisinternal) THEN
            RAISE EXCEPTION 'migration_338_precondition: trg_mock_paper_policy missing on % (306)', name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = to_regclass('public.listening_exercises')
                      AND t.tgname = 'trg_listening_exercises_updated_at' AND NOT t.tgisinternal) THEN
        RAISE EXCEPTION 'migration_338_precondition: trg_listening_exercises_updated_at missing (208)'
            USING ERRCODE = '55000';
    END IF;
    FOREACH name IN ARRAY paper_tables LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = to_regclass('public.' || name)
                          AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped) THEN
            RAISE EXCEPTION 'migration_338_precondition: public.%.updated_at is missing', name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    FOREACH name IN ARRAY paper_tables LOOP
        EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON public.%I '
                       'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
                       'update_' || name || '_updated_at', name);
    END LOOP;

    -- Postcondition: exactly one enabled BEFORE UPDATE row trigger named
    -- update_<table>_updated_at on the shared function, and it fires after every
    -- other BEFORE row trigger on the table (the guards see the writer's row).
    FOREACH name IN ARRAY paper_tables LOOP
        IF (SELECT count(*) FROM pg_trigger t
             WHERE t.tgrelid = to_regclass('public.' || name) AND NOT t.tgisinternal
               AND t.tgname = 'update_' || name || '_updated_at'
               AND t.tgfoid = 'public.update_updated_at_column()'::regprocedure
               AND t.tgtype = 19          -- ROW (1) | BEFORE (2) | UPDATE (16)
               AND t.tgenabled = 'O') <> 1 THEN
            RAISE EXCEPTION 'migration_338_postcondition: update_%_updated_at is not a single enabled BEFORE UPDATE row trigger', name
                USING ERRCODE = '55000';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = to_regclass('public.' || name) AND NOT t.tgisinternal
                      AND (t.tgtype & 3) = 3      -- BEFORE row trigger
                      AND t.tgname COLLATE "C" > ('update_' || name || '_updated_at') COLLATE "C") THEN
            RAISE EXCEPTION 'migration_338_postcondition: a BEFORE row trigger on % fires after update_%_updated_at', name, name
                USING ERRCODE = '55000';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = to_regclass('public.' || name) AND NOT t.tgisinternal
                      AND t.tgname <> 'update_' || name || '_updated_at'
                      AND t.tgfoid = 'public.update_updated_at_column()'::regprocedure) THEN
            RAISE EXCEPTION 'migration_338_postcondition: % has a second update_updated_at_column() trigger', name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;
END $$;

COMMIT;
