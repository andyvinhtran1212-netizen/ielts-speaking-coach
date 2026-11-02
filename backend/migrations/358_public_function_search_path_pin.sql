-- Migration: 358_public_function_search_path_pin.sql
--
-- SECURITY (PC-J406, P2; SA P2-R2-1 at SA-SPEC-357-R2 2026-10-30, CR agreed;
-- widened by PC-J510 under PGTEMP option a; spec SVCPRIV-0042 FR-010,
-- approved by Vinh 2026-11-02 06:37 UTC+7, t1246u).
--
-- PostgreSQL searches pg_temp FIRST for relations and data types unless the
-- routine's search_path names it (it is never searched for functions or
-- operators). So a caller with the default TEMP privilege can shadow a name
-- that a routine resolves while it runs as the owner:
--   · no search_path: the four 283 trigger functions
--       prevent_grammar_release_content_mutation()   (reads grammar_content_releases unqualified)
--       prevent_validated_grammar_release_rewrite()
--       prevent_grammar_evidence_mutation()
--       prevent_completed_grammar_session_mutation() (reads grammar_diagnostic_reports unqualified)
--     The first fires as the owner of six grammar_* tables through their
--     release_id ON DELETE CASCADE. service_role (no TRIGGER and no schema
--     CREATE after NNN/357) creates
--       TEMP VIEW grammar_content_releases AS SELECT ..., pg_temp.evil() AS status
--     and deletes a draft release: evil() runs as the owner (SA repro on PG
--     17: GRANT TRIGGER ON public.users TO service_role, reopening P2-SA-1).
--   · a path without pg_temp: the five fn_admin_* SECURITY DEFINER RPCs of
--     297–302 (`pg_catalog, public`) read mock_exams etc. unqualified, and a
--     temp view of that name runs as the owner. Qualified tables do not help:
--     a TEMP DOMAIN named uuid (or any type the body names) with a CHECK
--     calling pg_temp code is resolved before pg_catalog.uuid
--     (job 001iv FINDING-pgtemp-first-pinned-paths.md, Q-0600-PGTEMP).
--   · search_path = '': fn_activate_attempt_check (334) and
--     app_private.is_current_user_active (335); their relations are
--     qualified, but pg_temp is still searched first for types.
--
-- FR-010 (PGTEMP a): pin every function and procedure (prokind f or p) in
-- schemas public and app_private so that pg_temp is present and LAST:
--   · no search_path       → public, pg_temp
--   · ''                   → pg_catalog, pg_temp (bodies are fully
--                            qualified; the 358 tests run them)
--   · any other list whose last entry is not pg_temp → the same list with
--     pg_temp removed and appended: `pg_catalog, public` → `pg_catalog,
--     public, pg_temp`, `public` → `public, pg_temp`.
-- Plus one narrowing ordered by the Leader (08:50 addendum, SA via
-- PR-2116): the 224 UPDATE trigger function
-- fn_guard_active_player_terminal_mutation() goes from `public, pg_temp` to
-- `pg_catalog, pg_temp`. Its body names only to_jsonb, NULLIF, now() and
-- TG_* variables; with public on the path, an exact-type overload such as
-- public.to_jsonb(public.sessions) would win over pg_catalog.to_jsonb(anyelement).
-- Staging catalog 2026-11-02 (read-only, job 1oo ro-catalog.result): 345 is
-- not applied, so the target set is 11 routines (the four 283 triggers, the
-- five fn_admin_*, 334, 335) plus the 224 narrowing. The migration does not
-- use that list: it re-reads the catalog and pins whatever is not compliant.
--
-- ALTER ROUTINE ... SET only: bodies, owners, ACLs, volatility, SECURITY
-- DEFINER/INVOKER, triggers and data are unchanged; other proconfig entries
-- stay. Schemas other than public and app_private are not touched.
-- Extension members are not excluded: on staging no extension lives in
-- public; if a catalog has one the runner cannot alter, the precondition
-- aborts and lists it. A search_path entry that is not a plain lower-case identifier or
-- "$user" also aborts (search_path_unparsed) instead of being rewritten by
-- guesswork. Migration 345 pins the same four 283 triggers to
-- `public, pg_temp`; 358 does not depend on it and finds nothing to do for
-- them where 345 already ran.
--
-- Preconditions (abort before any change):
--   · every target routine is owned by a role whose privileges the runner
--     has (ALTER needs ownership), else unpinned_function_not_owned_by_runner
--     lists routine and owner;
--   · every existing entry parses, else search_path_unparsed.
-- Postconditions (abort, rolling back the whole migration):
--   · every routine changed here carries exactly the computed value
--     (search_path_pin_not_applied);
--   · fn_guard_active_player_terminal_mutation(), when present, carries
--     search_path=pg_catalog, pg_temp (search_path_pin_not_applied);
--   · no routine (prokind f or p) in public or app_private lacks a
--     search_path, has search_path = '' or has one whose last entry is not
--     pg_temp (routine_search_path_not_pg_temp_last).
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
--   SELECT p.oid::regprocedure, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname IN ('public', 'app_private') AND p.prokind IN ('f', 'p')
--      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
--                       WHERE c ~ '^search_path=(.+, )?pg_temp$');
--
-- Rollback: none. The down of 358 is a deliberate no-op. Removing or
-- shortening the pin reopens P2-R2-1 (owner code execution through a temp
-- object), so it is not an emergency option; changing it needs a new spec.
-- Rollbacks of other migrations must not RESET search_path on these routines
-- either: the header rollback of 345 does, so after 358 it must not run
-- unless the same transaction re-pins the four functions.

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Every regprocedure printed below is then schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

DO $$
DECLARE
    v_blocked TEXT;
    v_unparsed TEXT;
BEGIN
    WITH routine AS (
        SELECT p.oid, p.proowner,
               (SELECT substr(c, length('search_path=') + 1)
                  FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
                 WHERE c LIKE 'search_path=%') AS path
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'app_private')
           AND p.prokind IN ('f', 'p')
    ), target AS (
        SELECT * FROM routine
         WHERE path IS NULL OR path !~ '^(.+, )?pg_temp$'
            OR (oid = to_regprocedure('public.fn_guard_active_player_terminal_mutation()')
                AND path IS DISTINCT FROM 'pg_catalog, pg_temp')
    )
    SELECT string_agg(format('%s (owner %s)', oid::regprocedure, pg_get_userbyid(proowner)),
                      ', ' ORDER BY oid::regprocedure::text)
               FILTER (WHERE NOT pg_has_role(current_user, proowner, 'USAGE')),
           string_agg(format('%s (search_path=%s)', oid::regprocedure, path),
                      ', ' ORDER BY oid::regprocedure::text)
               FILTER (WHERE path IS NOT NULL AND path <> '""'
                         AND EXISTS (SELECT 1 FROM unnest(string_to_array(path, ', ')) AS e
                                      WHERE e !~ '^([a-z_][a-z0-9_$]*|"\$user")$'))
      INTO v_blocked, v_unparsed
      FROM target;
    IF v_blocked IS NOT NULL THEN
        RAISE EXCEPTION 'unpinned_function_not_owned_by_runner: %', v_blocked
            USING HINT = 'Run 358 as the owner of these routines, or decide the case in a spec amendment.';
    END IF;
    IF v_unparsed IS NOT NULL THEN
        RAISE EXCEPTION 'search_path_unparsed: %', v_unparsed
            USING HINT = 'Pin these routines by hand in a reviewed migration; 358 does not guess.';
    END IF;
END $$;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        WITH routine AS (
            SELECT p.oid, p.oid::regprocedure AS fn,
                   (SELECT substr(c, length('search_path=') + 1)
                      FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
                     WHERE c LIKE 'search_path=%') AS path
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('public', 'app_private')
               AND p.prokind IN ('f', 'p')
        )
        SELECT oid, fn, path,
               CASE
                   WHEN oid = to_regprocedure('public.fn_guard_active_player_terminal_mutation()')
                       THEN 'pg_catalog, pg_temp'
                   WHEN path IS NULL THEN 'public, pg_temp'
                   WHEN path = '""' THEN 'pg_catalog, pg_temp'
                   ELSE array_to_string(array_remove(string_to_array(path, ', '), 'pg_temp')
                                        || 'pg_temp'::text, ', ')
               END AS pinned
          FROM routine
         WHERE path IS NULL OR path !~ '^(.+, )?pg_temp$'
            OR (oid = to_regprocedure('public.fn_guard_active_player_terminal_mutation()')
                AND path IS DISTINCT FROM 'pg_catalog, pg_temp')
         ORDER BY fn::text
    LOOP
        -- ALTER ROUTINE covers functions and procedures alike. Every entry of
        -- r.pinned was checked against ^([a-z_][a-z0-9_$]*|"\$user")$ above.
        EXECUTE format('ALTER ROUTINE %s SET search_path = %s', r.fn, r.pinned);
        IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c
                        WHERE p.oid = r.oid AND c = 'search_path=' || r.pinned) THEN
            RAISE EXCEPTION 'search_path_pin_not_applied: %', r.fn;
        END IF;
        RAISE NOTICE '358: % search_path % -> %', r.fn, coalesce(r.path, '(none)'), r.pinned;
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
     WHERE n.nspname IN ('public', 'app_private')
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
                        WHERE c ~ '^search_path=(.+, )?pg_temp$');
    IF v_gaps IS NOT NULL THEN
        RAISE EXCEPTION 'routine_search_path_not_pg_temp_last: %', v_gaps;
    END IF;
    IF to_regprocedure('public.fn_guard_active_player_terminal_mutation()') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c
                        WHERE p.oid = to_regprocedure('public.fn_guard_active_player_terminal_mutation()')
                          AND c = 'search_path=pg_catalog, pg_temp') THEN
        RAISE EXCEPTION 'search_path_pin_not_applied: public.fn_guard_active_player_terminal_mutation()';
    END IF;
END $$;

COMMIT;
