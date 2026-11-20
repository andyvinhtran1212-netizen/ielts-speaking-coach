-- Rollback of 383_course_commerce_core.sql (COURSEACCESS-0055 T001, M1).
-- Run only after the preceding backend is deployed, and after rolling back M2
-- and every later course_commerce file (rollout.md order).
-- Keeps every table and row: course_products, entitlements, entitlement_events,
-- enrollment_orders, enrollment_order_events and learner_email_outbox stay, with
-- their guard triggers, as evidence. It removes only the access-code triggers
-- and functions, so codes stop granting entitlements, and drops the three new
-- access_codes columns only while no code uses them. Refuses to run while any
-- order is confirmed or any access-code entitlement is active (nothing would
-- revoke it once the triggers are gone) unless the operator opts in first, at
-- session level, before running this file:
--   SET aver.allow_commerce_rollback = 'on';
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.access_codes, public.user_code_assignments IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
    IF coalesce(current_setting('aver.allow_commerce_rollback', true), '') <> 'on' THEN
        IF to_regclass('public.enrollment_orders') IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.enrollment_orders WHERE status = 'confirmed') THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'confirmed enrollment orders exist; keep 383 or SET aver.allow_commerce_rollback = ''on''';
        END IF;
        IF to_regclass('public.entitlements') IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.entitlements WHERE status = 'active' AND source = 'access_code') THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'active access-code entitlements exist; keep 383 or SET aver.allow_commerce_rollback = ''on''';
        END IF;
    END IF;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_access_codes_entitlement_sync ON public.access_codes;
DROP TRIGGER IF EXISTS trg_access_codes_product_kind ON public.access_codes;
DROP TRIGGER IF EXISTS trg_code_assignment_entitlement_revoke ON public.user_code_assignments;
DROP FUNCTION IF EXISTS public.fn_access_code_entitlement_sync();
DROP FUNCTION IF EXISTS public.fn_code_assignment_entitlement_revoke();
DROP FUNCTION IF EXISTS public.fn_access_code_entitlement_revoke(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_access_codes_product_kind();
-- The product kind lock reads access_codes.product_id, which may be dropped below.
DROP TRIGGER IF EXISTS trg_course_products_kind_lock ON public.course_products;
DROP FUNCTION IF EXISTS public.fn_course_products_kind_lock();

DO $columns$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.access_codes
                    WHERE product_id IS NOT NULL OR grant_days IS NOT NULL OR grant_credits IS NOT NULL) THEN
        DROP INDEX IF EXISTS public.ix_access_codes_product;
        ALTER TABLE public.access_codes
            DROP COLUMN IF EXISTS product_id,
            DROP COLUMN IF EXISTS grant_days,
            DROP COLUMN IF EXISTS grant_credits;
    ELSE
        RAISE NOTICE '383 rollback: access codes carry a product; columns kept';
    END IF;
END;
$columns$;

DO $postcondition$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname IN ('trg_access_codes_entitlement_sync', 'trg_access_codes_product_kind',
                                 'trg_code_assignment_entitlement_revoke')
                  AND tgrelid IN ('public.access_codes'::regclass, 'public.user_code_assignments'::regclass))
       OR to_regprocedure('public.fn_access_code_entitlement_sync()') IS NOT NULL
       OR to_regprocedure('public.fn_code_assignment_entitlement_revoke()') IS NOT NULL
       OR to_regprocedure('public.fn_access_code_entitlement_revoke(uuid,uuid,text)') IS NOT NULL
       OR to_regprocedure('public.fn_access_codes_product_kind()') IS NOT NULL
       OR to_regprocedure('public.fn_course_products_kind_lock()') IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '383 rollback postcondition failed';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
