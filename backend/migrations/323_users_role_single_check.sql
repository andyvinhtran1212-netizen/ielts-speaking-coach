-- Migration: 323_users_role_single_check.sql
--
-- A-05 / ROLECHECK-0026 (the "batch 3" follow-up that SECWRITE-0022 / 320
-- deferred). public.users carries two CHECK constraints on role:
--   · chk_users_role   (migration 106): user | student | instructor | admin
--   · users_role_check (not in any repo migration; dashboard/original schema,
--                       present on staging and production): user | admin
-- A row must satisfy both, so the effective set was {user, admin}: neither
-- PATCH /admin/users/{id}/role nor an instructor-grant access code could set
-- 'instructor' or 'student', even as service_role (23514 check_violation).
-- This keeps exactly ONE correct constraint (chk_users_role) and drops
-- users_role_check.
--
-- 320 compatibility: the trigger trg_users_guard_privileged_columns, grants and
-- policies are unchanged; nothing is GRANTed to anon/authenticated. Clients
-- still have no INSERT/UPDATE on users and the trigger still rejects a
-- client-role change of role. 323 widens the set of valid VALUES, not the set
-- of writers, and aborts if the 320 trigger is missing or disabled.
--
-- No row is written or changed; role stays nullable with DEFAULT 'user'.
-- Idempotent: a second run is a no-op.
--
-- Read-only pre-checks: specs/0026-users-role-single-check/research.md §5
-- (P1–P6). Rollback: research.md §6.4 — only safe while no row has
-- role IN ('student', 'instructor'); it re-creates bug A-05, so prefer a
-- forward fix.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Fail loud on any row outside the canonical set (never rewrite data).
DO $$
DECLARE
    bad BIGINT;
BEGIN
    SELECT count(*) INTO bad
      FROM public.users
     WHERE role IS NOT NULL
       AND role NOT IN ('user', 'student', 'instructor', 'admin');
    IF bad > 0 THEN
        RAISE EXCEPTION 'users_role_outside_canonical_set'
            USING DETAIL = format('%s public.users rows have a role outside user|student|instructor|admin', bad);
    END IF;
END $$;

-- 2. Ensure the canonical constraint exists with EXACTLY this definition. On
--    staging and production it already exists and is validated, so the IF
--    branch is skipped. Recreate it only when missing or drifted: NOT VALID,
--    then VALIDATE right after (small table; inside one transaction the gain
--    is mainly a clearly separated error).
DO $$
DECLARE
    current_def TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO current_def
      FROM pg_constraint c
     WHERE c.conrelid = 'public.users'::regclass
       AND c.conname = 'chk_users_role';
    IF current_def IS DISTINCT FROM
       'CHECK ((role = ANY (ARRAY[''user''::text, ''student''::text, ''instructor''::text, ''admin''::text])))' THEN
        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS chk_users_role;
        ALTER TABLE public.users
            ADD CONSTRAINT chk_users_role
            CHECK (role IN ('user', 'student', 'instructor', 'admin')) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.users VALIDATE CONSTRAINT chk_users_role;  -- no-op when already validated

-- 3. Drop the conflicting constraint (created outside the repo).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- 4. Postcondition: exactly ONE CHECK on the role column, with the canonical
--    name/definition and validated; the 320 trigger exists and is enabled.
DO $$
DECLARE
    role_attnum SMALLINT;
    n_checks INT;
    ok_canonical BOOLEAN;
BEGIN
    SELECT attnum INTO role_attnum
      FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attname = 'role' AND NOT attisdropped;

    SELECT count(*) INTO n_checks
      FROM pg_constraint c
     WHERE c.conrelid = 'public.users'::regclass
       AND c.contype = 'c'
       AND role_attnum = ANY (c.conkey);

    SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.users'::regclass
           AND c.conname = 'chk_users_role'
           AND c.convalidated
           AND pg_get_constraintdef(c.oid) =
               'CHECK ((role = ANY (ARRAY[''user''::text, ''student''::text, ''instructor''::text, ''admin''::text])))'
    ) INTO ok_canonical;

    IF n_checks <> 1 OR NOT ok_canonical THEN
        RAISE EXCEPTION 'users_role_single_check_postcondition_failed'
            USING DETAIL = format('role CHECK count=%s, canonical=%s', n_checks, ok_canonical);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.users'::regclass
           AND tgname = 'trg_users_guard_privileged_columns'
           AND tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'users_privileged_column_guard_missing'
            USING DETAIL = 'Migration 320 trigger must exist and be enabled before 323.';
    END IF;
END $$;

COMMIT;
