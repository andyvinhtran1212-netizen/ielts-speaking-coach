-- Migration: 365_staff_security_chain_search_path.sql
--
-- PC-J603 (Security Auditor SA-2209, residual P2 after 363; spec
-- ADMINAAL2-0032 FR-009, FR-011 and FR-019). 364 is held by PC-J544
-- (SVCPRIV-0042 T001), so this takes 365. 332, 336, 341, 361 and 363 are
-- never edited: this forward file pins the search_path of the rest of the
-- staff-security chain, the way 363 pinned the users audit trigger and its
-- writer.
--
--   SA-2209  After 363 these functions still run with
--         search_path = public, pg_temp and call catalog functions without a
--         schema. A role with CREATE on public (service_role on staging) can
--         add an exact typed overload, for example
--         public.jsonb_build_object(text,text,text,boolean,text,timestamptz),
--         that beats the catalog's VARIADIC "any" version and runs as the
--         function owner:
--           fn_set_staff_privilege       SECURITY DEFINER, EXECUTE for
--                                        service_role: the role that can plant
--                                        the overload can also call the RPC
--                                        (the #2209 RPC probe after 363).
--           fn_ai_model_override_audit   SECURITY DEFINER trigger (341 F3).
--           fn_users_suspension_guard, fn_users_suspension_role_guard
--                                        SECURITY INVOKER triggers on users;
--                                        the RPC's UPDATE runs them as the
--                                        owner (has_table_privilege,
--                                        pg_current_xact_id).
--           fn_bootstrap_admin_recovery  SECURITY INVOKER, owner only.
--           fn_staff_security_audit_append_only
--                                        SECURITY INVOKER trigger (format).
--
-- Five functions are recreated with their current bodies (341 for the guards,
-- the RPC and the bootstrap; 332 for the append-only trigger), unchanged
-- except for SET search_path = pg_catalog, pg_temp and pg_catalog.<fn> for
-- every catalog function they call. fn_ai_model_override_audit calls no
-- function, so its body stays as 341 wrote it and only
-- ALTER FUNCTION ... SET search_path changes it. Tables and functions in
-- public were already written as public.<name>. Owner, SECURITY
-- DEFINER/INVOKER and the ACLs stay as they are: CREATE OR REPLACE keeps
-- them, the REVOKEs restate them, and service_role keeps EXECUTE on the RPC
-- only. Operators in the bodies need no qualification: with public off the
-- path no schema but pg_catalog can supply one. The DO blocks run under the
-- same pinned path and also qualify every function and operator.
--
-- Not in this file (other definers with search_path = public[, pg_temp], see
-- SA-2209): the 326, 331, 333, 337, 339 and 340 groups and the older
-- definers. They need their own ticket, review and migration.
--
-- Order and compatibility. Needs 361 and 363 in public._schema_migrations
-- and their objects, with the 363 pin in place (`migration_363_missing`),
-- and no function or operator in public named like one the file or the
-- bodies use (`catalog_name_shadowed_in_public`): a shadow already planted is
-- an incident to remove before this runs. On staging 365 runs on top of the
-- applied 361 and 363; on production 341, 361, 363 and 365 run back to back
-- at one promotion. Held by forward-policy.tsv as pending_feature admin_aal2:
-- apply only with MIGRATION_FEATURES=admin_aal2 through the advisory-locked
-- runner, staging first after SA review, production only at an explicitly
-- authorised staging -> main promotion after 363. No backend change. One
-- transaction, lock_timeout 5s, re-runnable (a second run changes nothing),
-- runs as the NOSUPERUSER owner, no business data read or written.
-- Re-running 332, 336 or 341 after 365 restores search_path = public on the
-- functions it replaces: re-run 361, 363 and 365 after it. Re-running 361
-- alone after 365 aborts at its postcondition (staff_security_function_wrong,
-- it checks the 341 path) and changes nothing.
--
-- ROLLBACK: backend/migrations/rollback/365_staff_security_chain_search_path.sql
-- restores the 341 and 332 bodies verbatim and the 341 path of
-- fn_ai_model_override_audit, reopens SA-2209 for these six functions and
-- grants nothing. It refuses to run while public holds a shadow of a name
-- those bodies call.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 361 and 363 are recorded and in place; the six functions
-- and their triggers exist; nothing in public shadows a catalog name this
-- file or the bodies use.
DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY[
        'aclexplode', 'array_to_string', 'btrim', 'char_length', 'count', 'current_setting', 'format',
        'gen_random_uuid', 'has_function_privilege', 'has_table_privilege', 'jsonb_build_object', 'now',
        'pg_advisory_xact_lock', 'pg_current_xact_id', 'string_agg', 'to_regclass', 'to_regprocedure'];
    catalog_operators CONSTANT text[] := ARRAY['=', '<>', '<', '>', '<=', '>=', '~', '||'];
    v_wrong text;
BEGIN
    -- Two statements: PL/pgSQL plans a whole condition, so the ledger
    -- query must not be parsed when the table is missing.
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_363_missing: no ledger row';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM public._schema_migrations m
         WHERE m.filename OPERATOR(pg_catalog.=) ANY (ARRAY[
               '361_staff_privilege_evidence_commit_guard.sql',
               '363_users_privilege_audit_search_path.sql']))
       OPERATOR(pg_catalog.<>) 2 THEN
        RAISE EXCEPTION 'migration_363_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regclass('public.staff_privilege_evidence') IS NULL
       OR pg_catalog.to_regclass('public.staff_security_audit') IS NULL
       OR pg_catalog.to_regclass('public.ai_model_overrides') IS NULL
       OR pg_catalog.to_regclass('public.ai_model_override_audit') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_suspension_guard()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_suspension_role_guard()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_bootstrap_admin_recovery(uuid,text,text)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_staff_security_audit_append_only()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_ai_model_override_audit()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_staff_privilege_evidence_consumed()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_privilege_audit()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)') IS NULL THEN
        RAISE EXCEPTION 'migration_363_missing: objects';
    END IF;
    -- The 363 pin is in place (a re-run of 332, 341 or 361 removes it).
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                WHERE p.oid OPERATOR(pg_catalog.=) ANY (ARRAY[
                      'public.fn_users_privilege_audit()'::regprocedure::oid,
                      'public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)'::regprocedure::oid])
                  AND (p.proconfig IS NULL
                       OR pg_catalog.array_to_string(p.proconfig, '|')
                          OPERATOR(pg_catalog.<>) 'search_path=pg_catalog, pg_temp')) THEN
        RAISE EXCEPTION 'migration_363_missing: fn_users_privilege_audit / fn_staff_security_record not pinned';
    END IF;
    SELECT pg_catalog.string_agg(k.kind OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) k.name, ', '
                                 ORDER BY k.kind, k.name) INTO v_wrong
      FROM (SELECT 'function'::text, p.proname::text FROM pg_catalog.pg_proc p
             WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND p.proname::text OPERATOR(pg_catalog.=) ANY (catalog_functions)
            UNION
            SELECT 'operator'::text, o.oprname::text FROM pg_catalog.pg_operator o
             WHERE o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND o.oprname::text OPERATOR(pg_catalog.=) ANY (catalog_operators)) k(kind, name);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

-- 1. 341 section 0 (332 guard): SECURITY INVOKER, run as the owner by the
-- RPC and the bootstrap.
CREATE OR REPLACE FUNCTION public.fn_users_suspension_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF (NEW.is_active AND NOT OLD.is_active AND OLD.suspended_at IS NOT NULL)
       OR (NEW.suspended_at, NEW.suspended_by, NEW.suspension_reason)
          IS DISTINCT FROM (OLD.suspended_at, OLD.suspended_by, OLD.suspension_reason) THEN
        IF pg_catalog.has_table_privilege('public.staff_privilege_evidence', 'SELECT') THEN
            IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence e
                        WHERE e.xact_id = pg_catalog.pg_current_xact_id() AND e.target_user_id = OLD.id
                          AND e.kind IN ('rpc', 'bootstrap')) THEN
                RETURN NEW;
            END IF;
        END IF;
    END IF;
    IF NEW.is_active AND NOT OLD.is_active AND OLD.suspended_at IS NOT NULL THEN
        RAISE EXCEPTION 'account_suspended'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'Only PATCH /admin/users/{id}/active (fn_set_staff_privilege) reactivates a suspended account.';
    END IF;
    IF (NEW.suspended_at, NEW.suspended_by, NEW.suspension_reason)
       IS DISTINCT FROM (OLD.suspended_at, OLD.suspended_by, OLD.suspension_reason) THEN
        RAISE EXCEPTION 'account_suspended_marker_protected'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'The suspension marker is written only by fn_set_staff_privilege.';
    END IF;
    RETURN NEW;
END;
$$;

-- 2. 341 section 0 (336 role freeze, FR-019).
CREATE OR REPLACE FUNCTION public.fn_users_suspension_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role AND OLD.suspended_at IS NOT NULL THEN
        IF pg_catalog.has_table_privilege('public.staff_privilege_evidence', 'SELECT') THEN
            IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence e
                        WHERE e.xact_id = pg_catalog.pg_current_xact_id() AND e.target_user_id = OLD.id
                          AND e.kind = 'bootstrap') THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'account_suspended_role_change'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'Reactivate the account first (PATCH /admin/users/{id}/active), then change its role.';
    END IF;
    RETURN NEW;
END;
$$;

-- 3. 341 section 5: the service_role RPC, SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.fn_set_staff_privilege(
    p_actor      uuid,
    p_target     uuid,
    p_role       text,
    p_is_active  boolean,
    p_reason     text,
    p_request_id text
) RETURNS TABLE (changed boolean, audit_id uuid, before jsonb, after jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_old        public.users%ROWTYPE;
    v_actor      public.users%ROWTYPE;
    v_role       text;
    v_active     boolean;
    v_suspend    boolean;
    v_clear      boolean;
    v_before     jsonb;
    v_after      jsonb;
    v_audit      uuid := pg_catalog.gen_random_uuid();
BEGIN
    IF p_role IS NULL AND p_is_active IS NULL THEN
        RAISE EXCEPTION 'invalid_privilege_change' USING ERRCODE = 'P0001';
    END IF;
    IF p_role IS NOT NULL AND p_role NOT IN ('admin', 'instructor', 'student') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'P0001';
    END IF;
    IF (p_reason IS NOT NULL AND pg_catalog.char_length(p_reason) > 500)
       OR (p_is_active IS NOT NULL
           AND (p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 500)) THEN
        RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'actor_not_admin' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor = p_target THEN
        RAISE EXCEPTION 'self_change_forbidden' USING ERRCODE = 'P0001';
    END IF;

    -- One lock order for every caller, so concurrent calls serialize instead
    -- of deadlocking, and the checks below see the committed state.
    PERFORM 1 FROM public.users
      WHERE id IN (p_actor, p_target) OR (role = 'admin' AND is_active)
      ORDER BY id FOR UPDATE;

    SELECT * INTO v_old FROM public.users WHERE id = p_target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_actor FROM public.users WHERE id = p_actor;
    IF NOT FOUND OR v_actor.role IS DISTINCT FROM 'admin' OR NOT v_actor.is_active
       OR v_actor.suspended_at IS NOT NULL THEN
        RAISE EXCEPTION 'actor_not_admin' USING ERRCODE = 'P0001';
    END IF;
    IF p_is_active IS NOT NULL AND v_old.role NOT IN ('admin', 'instructor') THEN
        RAISE EXCEPTION 'target_not_staff' USING ERRCODE = 'P0001';
    END IF;

    v_role    := COALESCE(p_role, v_old.role);
    v_active  := COALESCE(p_is_active, v_old.is_active);
    v_suspend := p_is_active IS FALSE AND v_old.suspended_at IS NULL;
    v_clear   := p_is_active IS TRUE AND v_old.suspended_at IS NOT NULL;
    v_before  := pg_catalog.jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active,
                                               'suspended_at', v_old.suspended_at);

    IF v_role = v_old.role AND v_active = v_old.is_active AND NOT v_suspend AND NOT v_clear THEN
        RETURN QUERY SELECT false, NULL::uuid, v_before, v_before;
        RETURN;
    END IF;

    -- Defence in depth: the actor (a different active admin) stays an admin,
    -- so this fires only if the actor rule above is ever weakened.
    IF v_old.role = 'admin' AND v_old.is_active AND NOT (v_role = 'admin' AND v_active)
       AND NOT EXISTS (SELECT 1 FROM public.users
                        WHERE role = 'admin' AND is_active AND id <> p_target) THEN
        RAISE EXCEPTION 'last_admin' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.staff_privilege_evidence
        (target_user_id, kind, audit_id, actor_user_id, reason, request_id)
    VALUES (p_target, 'rpc', v_audit, p_actor, NULLIF(pg_catalog.btrim(p_reason), ''), NULLIF(p_request_id, ''));

    UPDATE public.users
       SET role = v_role,
           is_active = v_active,
           suspended_at      = CASE WHEN v_suspend THEN pg_catalog.now()           WHEN v_clear THEN NULL ELSE suspended_at END,
           suspended_by      = CASE WHEN v_suspend THEN p_actor                    WHEN v_clear THEN NULL ELSE suspended_by END,
           suspension_reason = CASE WHEN v_suspend THEN pg_catalog.btrim(p_reason) WHEN v_clear THEN NULL ELSE suspension_reason END
     WHERE id = p_target
     RETURNING pg_catalog.jsonb_build_object('role', role, 'is_active', is_active, 'suspended_at', suspended_at)
          INTO v_after;

    -- The AFTER trigger has consumed the evidence; never leave it for a later
    -- statement of the caller's transaction.
    DELETE FROM public.staff_privilege_evidence e
     WHERE e.xact_id = pg_catalog.pg_current_xact_id() AND e.target_user_id = p_target;
    -- Only after the 332 header's partial rollback (trg_users_privilege_audit
    -- dropped) is the row missing; write the same row here instead.
    IF NOT EXISTS (SELECT 1 FROM public.staff_security_audit a WHERE a.id = v_audit) THEN
        PERFORM public.fn_staff_security_record(
            v_audit, CASE WHEN v_role IS DISTINCT FROM v_old.role THEN 'role_changed' ELSE 'active_changed' END,
            p_target, p_actor, 'admin_api', v_before, v_after, NULLIF(pg_catalog.btrim(p_reason), ''),
            NULLIF(p_request_id, ''), '{}'::jsonb, v_old.role = 'admin' OR v_role = 'admin');
    END IF;

    RETURN QUERY SELECT true, v_audit, v_before, v_after;
END;
$$;

-- 4. 341 section 5b: owner only, SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.fn_bootstrap_admin_recovery(
    p_target   uuid,
    p_operator text,
    p_reason   text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_old    public.users%ROWTYPE;
    v_before jsonb;
    v_after  jsonb;
    v_audit  uuid := pg_catalog.gen_random_uuid();
BEGIN
    IF p_operator IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_operator)) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'bootstrap_operator_required' USING ERRCODE = 'P0001';
    END IF;
    IF p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
    END IF;

    -- With no admin row at all, two bootstraps on different targets lock
    -- disjoint rows, so the row locks below cannot serialize them. One
    -- transaction-level key does (class 332; 173204 is the migration runner's,
    -- 306 the grammar quiz's). The waiter's next statement sees the committed
    -- admin only under READ COMMITTED: a REPEATABLE READ snapshot predates the
    -- wait.
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'bootstrap_requires_read_committed' USING ERRCODE = 'P0001';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(332, 1);
    PERFORM 1 FROM public.users WHERE role = 'admin' OR id = p_target ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.users WHERE role = 'admin' AND is_active) THEN
        RAISE EXCEPTION 'admins_exist' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_old FROM public.users WHERE id = p_target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0001';
    END IF;
    v_before := pg_catalog.jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active,
                                              'suspended_at', v_old.suspended_at);

    INSERT INTO public.staff_privilege_evidence (target_user_id, kind, audit_id, reason, operator)
    VALUES (p_target, 'bootstrap', v_audit, pg_catalog.btrim(p_reason), pg_catalog.btrim(p_operator));
    UPDATE public.users
       SET role = 'admin', is_active = true,
           suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL
     WHERE id = p_target
     RETURNING pg_catalog.jsonb_build_object('role', role, 'is_active', is_active, 'suspended_at', suspended_at)
          INTO v_after;
    DELETE FROM public.staff_privilege_evidence e
     WHERE e.xact_id = pg_catalog.pg_current_xact_id() AND e.target_user_id = p_target;
    -- The 332 header rollback keeps this function but drops the audit
    -- trigger; it stays audited by writing the same row here.
    IF NOT EXISTS (SELECT 1 FROM public.staff_security_audit a WHERE a.id = v_audit) THEN
        PERFORM public.fn_staff_security_record(
            v_audit, 'bootstrap_recovery', p_target, NULL, 'out_of_band', v_before, v_after,
            pg_catalog.btrim(p_reason), NULL,
            pg_catalog.jsonb_build_object('operator', pg_catalog.btrim(p_operator)), true);
    END IF;
    RETURN v_audit;
END;
$$;

-- 5. 332 section 1: append-only trigger on staff_security_audit.
CREATE OR REPLACE FUNCTION public.fn_staff_security_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'staff_security_audit_append_only'
        USING ERRCODE = 'P0001',
              DETAIL = pg_catalog.format('%s on staff_security_audit is not allowed.', TG_OP);
END;
$$;

-- 6. 341 F3: the override audit definer calls no function; only its path
-- changes.
ALTER FUNCTION public.fn_ai_model_override_audit() SET search_path = pg_catalog, pg_temp;

-- The 332/336/341 ACLs, restated (CREATE OR REPLACE and ALTER kept them);
-- service_role keeps its 341 EXECUTE on the RPC.
REVOKE ALL ON FUNCTION public.fn_users_suspension_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_users_suspension_role_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_bootstrap_admin_recovery(uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_staff_security_audit_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_model_override_audit() FROM PUBLIC, anon, authenticated, service_role;

-- 7. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    v_wrong text;
BEGIN
    -- Exactly the pinned path, no unqualified catalog call left in a body,
    -- the 332/336/341 security mode, the owner of the table each writes or
    -- guards, no EXECUTE for PUBLIC (grantee 0) or a client role, and
    -- service_role EXECUTE on the RPC only.
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_users_suspension_guard()', false, false, 'public.staff_security_audit'),
                   ('public.fn_users_suspension_role_guard()', false, false, 'public.staff_security_audit'),
                   ('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', true, true,
                    'public.staff_privilege_evidence'),
                   ('public.fn_bootstrap_admin_recovery(uuid,text,text)', false, false,
                    'public.staff_privilege_evidence'),
                   ('public.fn_staff_security_audit_append_only()', false, false, 'public.staff_security_audit'),
                   ('public.fn_ai_model_override_audit()', true, false, 'public.ai_model_override_audit')
           ) f(sig, definer, service_exec, tbl)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
      JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) f.tbl::regclass
     WHERE p.prosecdef OPERATOR(pg_catalog.<>) f.definer
        OR p.proconfig IS NULL
        OR pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.<>) 'search_path=pg_catalog, pg_temp'
        OR p.prosrc OPERATOR(pg_catalog.~)
           '(^|[^.[:alnum:]_])(btrim|char_length|current_setting|format|gen_random_uuid|has_table_privilege|jsonb_build_object|now|pg_advisory_xact_lock|pg_current_xact_id)\s*\('
        OR p.proowner OPERATOR(pg_catalog.<>) c.relowner
        OR p.proacl IS NULL   -- NULL = default ACL, which includes PUBLIC EXECUTE
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee OPERATOR(pg_catalog.=) 0::oid)
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') OPERATOR(pg_catalog.<>) f.service_exec;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_chain_search_path_wrong: %', v_wrong;
    END IF;

    -- The triggers are on and call the functions above.
    SELECT pg_catalog.string_agg(t.name, ', ' ORDER BY t.name) INTO v_wrong
      FROM (VALUES ('public.users', 'trg_users_suspension_guard', 'public.fn_users_suspension_guard()'),
                   ('public.users', 'trg_users_suspension_role_guard', 'public.fn_users_suspension_role_guard()'),
                   ('public.staff_security_audit', 'trg_staff_security_audit_append_only',
                    'public.fn_staff_security_audit_append_only()'),
                   ('public.staff_security_audit', 'trg_staff_security_audit_no_truncate',
                    'public.fn_staff_security_audit_append_only()'),
                   ('public.ai_model_overrides', 'trg_ai_model_override_audit', 'public.fn_ai_model_override_audit()')
           ) t(tbl, name, fn)
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                        WHERE g.tgrelid OPERATOR(pg_catalog.=) t.tbl::regclass
                          AND g.tgname OPERATOR(pg_catalog.=) t.name
                          AND g.tgfoid OPERATOR(pg_catalog.=) t.fn::regprocedure
                          AND g.tgenabled OPERATOR(pg_catalog.<>) 'D'
                          AND g.tgenabled OPERATOR(pg_catalog.<>) 'R');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_trigger_missing: %', v_wrong;
    END IF;
END $$;

COMMIT;
