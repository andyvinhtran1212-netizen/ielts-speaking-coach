-- Rollback of 384_credit_ledger_enrollment_rpcs.sql (COURSEACCESS-0055 T002, M2).
-- Run only after the preceding backend is deployed, after rolling back every
-- later course_commerce file (rollout.md order), and before rollback/383.
-- Keeps every table and row: credit_reservations, credit_ledger,
-- credit_cluster_members and writing_essays.review_mode stay, with their guard
-- triggers, as accounting evidence (the ledger stays append-only). It drops the
-- RPCs and their helpers, so nothing can reserve, settle, confirm or grant.
-- Refuses while credit_ledger holds any row unless the operator opts in first,
-- at session level, before running this file:
--   SET aver.allow_commerce_rollback = 'on';
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $guard$
BEGIN
    IF coalesce(current_setting('aver.allow_commerce_rollback', true), '') <> 'on'
       AND to_regclass('public.credit_ledger') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.credit_ledger) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'credit_ledger has rows; keep 384 or SET aver.allow_commerce_rollback = ''on''';
    END IF;
END;
$guard$;

DROP FUNCTION IF EXISTS public.fn_deliver_writing_essay_instant(uuid);
DROP FUNCTION IF EXISTS public.fn_course_product_archive(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_entitlement_admin_extend(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS public.fn_entitlement_admin_revoke(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_entitlement_admin_grant(uuid, uuid, uuid, integer, integer, text, text, uuid);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_pay_reminders(integer, integer, integer);
DROP FUNCTION IF EXISTS public.fn_enrollment_orders_expire(integer);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_confirm(uuid, uuid, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_confirm_result(text, public.entitlements, boolean);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_admin_action(uuid, uuid, text, text, text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_learner_action(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_create(uuid, uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.fn_enrollment_order_event(public.enrollment_orders, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_admin_adjust(uuid, uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_balance(uuid);
DROP FUNCTION IF EXISTS public.fn_credit_expire_reservations(integer);
DROP FUNCTION IF EXISTS public.fn_credit_release_for_resource(text, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_commit_for_resource(text, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_release(uuid, text);
DROP FUNCTION IF EXISTS public.fn_credit_commit(uuid);
DROP FUNCTION IF EXISTS public.fn_credit_reserve(uuid, text, integer, text, text, text, integer, uuid[], text[],
                                                 integer, integer);
DROP FUNCTION IF EXISTS public.fn_credit_settle_release(public.credit_reservations, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_resource_owned(uuid, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_feature_skill(text);
DROP FUNCTION IF EXISTS public.fn_credit_usable_balance(uuid);
DROP FUNCTION IF EXISTS public.fn_entitlement_credit_usable(public.entitlements);
DROP FUNCTION IF EXISTS public.fn_credit_lock_user(uuid);

DO $postcondition$
BEGIN
    IF to_regprocedure('public.fn_credit_reserve(uuid,text,integer,text,text,text,integer,uuid[],text[],integer,integer)') IS NOT NULL
       OR to_regprocedure('public.fn_credit_release(uuid,text)') IS NOT NULL
       OR to_regprocedure('public.fn_credit_usable_balance(uuid)') IS NOT NULL
       OR to_regprocedure('public.fn_credit_admin_adjust(uuid,uuid,integer,text,text)') IS NOT NULL
       OR to_regprocedure('public.fn_enrollment_order_confirm(uuid,uuid,text,boolean,integer,integer)') IS NOT NULL
       OR to_regprocedure('public.fn_enrollment_order_create(uuid,uuid,text,text,integer)') IS NOT NULL
       OR to_regprocedure('public.fn_entitlement_admin_grant(uuid,uuid,uuid,integer,integer,text,text,uuid)') IS NOT NULL
       OR to_regprocedure('public.fn_deliver_writing_essay_instant(uuid)') IS NOT NULL
       OR to_regclass('public.credit_ledger') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 rollback postcondition failed';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
