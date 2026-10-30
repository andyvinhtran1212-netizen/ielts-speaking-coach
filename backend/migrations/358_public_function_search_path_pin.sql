-- Migration: 358_public_function_search_path_pin.sql
--
-- SECURITY (PC-J406, P2; SA P2-R2-1 at SA-SPEC-357-R2 2026-10-30, CR agreed;
-- spec SVCPRIV-0042 FR-010, approved by Vinh 2026-10-30 22:13).
--
-- Four trigger functions from 283 have no SET search_path. They are plpgsql,
-- not SECURITY DEFINER:
--   prevent_grammar_release_content_mutation()   (reads grammar_content_releases unqualified)
--   prevent_validated_grammar_release_rewrite()
--   prevent_grammar_evidence_mutation()
--   prevent_completed_grammar_session_mutation() (reads grammar_diagnostic_reports unqualified)
-- The first is a BEFORE INSERT/UPDATE/DELETE trigger on six grammar_* tables
-- whose release_id references grammar_content_releases ON DELETE CASCADE.
-- A cascade runs as the owner of the referencing table, and a function
-- without its own search_path resolves names with the caller's session path,
-- where pg_temp comes first for relations and types. So service_role (no
-- TRIGGER and no schema CREATE after NNN) can create
--   TEMP VIEW grammar_content_releases AS SELECT ..., pg_temp.evil() AS status
-- and DELETE a draft release: the cascade fires the trigger as the owner,
-- the trigger reads the temp view, and evil() runs with current_user = the
-- owner (SA repro on local PG 17: GRANT TRIGGER ON public.users TO
-- service_role, which reopens P2-SA-1). With search_path = public, pg_temp
-- the same attack reads public.grammar_content_releases and records nothing.
--
-- This migration pins search_path = public, pg_temp on EVERY function and
-- procedure in schema public whose proconfig has no search_path entry
-- (staging catalog 2026-10-30: exactly the four above). It uses
-- ALTER ROUTINE ... SET, so function bodies, owners, ACLs, triggers and data
-- are unchanged. pg_temp is listed last on purpose: a path that does not name
-- pg_temp searches it FIRST. An empty search_path is not used because the
-- bodies still name public relations without a schema. Functions that already
-- have any search_path entry are left as they are (FR-010 scope). Functions
-- in other schemas are not touched. Extension members are not excluded: on
-- staging no extension lives in public; if a catalog has one that the runner
-- cannot alter, the precondition aborts and lists it.
-- Migration 345 pins the same four functions; 358 does not depend on it, and
-- on a database where 345 already ran it finds nothing to pin.
--
-- Preconditions (abort before any change):
--   · every unpinned public routine is owned by a role whose privileges the
--     runner has (ALTER needs ownership); otherwise
--     unpinned_function_not_owned_by_runner lists function and owner.
-- Postconditions (abort, rolling back the whole migration):
--   · every routine pinned here now carries exactly
--     search_path=public, pg_temp (search_path_pin_not_applied);
--   · no routine (prokind f or p) in schema public lacks a search_path entry
--     in proconfig (public_function_search_path_not_pinned).
--
-- One transaction, lock_timeout 5s. No row is written. Re-runnable: a second
-- run finds nothing to pin and its postconditions still hold. No backend
-- deploy needed.
--
-- Rollout: group function_search_path_pin in forward-policy.tsv. Merging does
-- not apply it. Staging first under the advisory lock (after 357), production
-- only at an authorised staging→main promotion. Production promotion is
-- blocked until SA reports the 358 retest as passed. Read-only verification
-- after apply (must return zero rows):
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
--      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
--                       WHERE c LIKE 'search_path=%');
--
-- Rollback: none. The down of 358 is a deliberate no-op. Removing the pin
-- reopens P2-R2-1 (owner code execution through a temp object), so it is not
-- an emergency option; changing it needs a new spec. Rollbacks of other
-- migrations must not RESET search_path on these functions either: the
-- header rollback of 345 does, so after 358 it must not run unless the same
-- transaction re-pins the four functions.

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Every regprocedure printed below is then schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

DO $$
DECLARE
    v_blocked TEXT;
BEGIN
    SELECT string_agg(format('%s (owner %s)', p.oid::regprocedure, pg_get_userbyid(p.proowner)),
                      ', ' ORDER BY p.oid::regprocedure::text)
      INTO v_blocked
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
                        WHERE c LIKE 'search_path=%')
       AND NOT pg_has_role(current_user, p.proowner, 'USAGE');
    IF v_blocked IS NOT NULL THEN
        RAISE EXCEPTION 'unpinned_function_not_owned_by_runner: %', v_blocked
            USING HINT = 'Run 358 as the owner of these functions, or decide the case in a spec amendment.';
    END IF;
END $$;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid, p.oid::regprocedure AS fn
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.prokind IN ('f', 'p')
           AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
                            WHERE c LIKE 'search_path=%')
         ORDER BY p.oid::regprocedure::text
    LOOP
        -- ALTER ROUTINE covers functions and procedures alike.
        EXECUTE format('ALTER ROUTINE %s SET search_path = public, pg_temp', r.fn);
        IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c
                        WHERE p.oid = r.oid AND c = 'search_path=public, pg_temp') THEN
            RAISE EXCEPTION 'search_path_pin_not_applied: %', r.fn;
        END IF;
        RAISE NOTICE '358: pinned search_path = public, pg_temp on %', r.fn;
    END LOOP;
END $$;

DO $$
DECLARE
    v_gaps TEXT;
BEGIN
    SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
      INTO v_gaps
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
                        WHERE c LIKE 'search_path=%');
    IF v_gaps IS NOT NULL THEN
        RAISE EXCEPTION 'public_function_search_path_not_pinned: %', v_gaps;
    END IF;
END $$;

COMMIT;
