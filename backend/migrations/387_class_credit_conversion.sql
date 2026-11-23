-- COURSEACCESS-0055 T013 (G04-T15), convert a class that runs on legacy codes
-- to credit metering. The spec calls this file "388"; that number is only a
-- working label. register.tsv assigns 387 (Andy, 2026-11-20,
-- approval-decision.md).
--
-- Purpose (plan.md 5.18): a legacy code has no product_id, so the members of a
-- class opened with one have no entitlements row and no place to hold
-- credits. fn_credit_convert_class gives every active member with an account
-- one class entitlement (source 'class_conversion', source_ref = the cohort)
-- plus the credits the admin typed; from then on charge_plan step 4 (plan 5.4)
-- meters that class's assigned work. One RPC and one append-only request log
-- (credit_class_conversions, one row per request_key holding the scope and the
-- result of the first call); no column, no seed, no change to any existing
-- row: access_codes, user_code_assignments and student_cohort_memberships are
-- only read.
--
-- Forward: pending_feature class_credit_conversion (a group of its own, so a
-- course_commerce run of 383 + 384 never picks it up). No apply on merge.
-- Apply only after 383 and 384 are on that environment, on staging first under
-- the advisory-locked runner after SA review and Andy's typed approval;
-- production only at an authorised staging-to-main promotion. Re-runnable; one
-- transaction; postcondition block.
-- Rollback: deploy the preceding backend (the three convert-class routes then
-- answer 503), then rollback/387_class_credit_conversion.sql (drops the RPC;
-- the entitlements, events and ledger rows it wrote stay).
--
-- Locking (same rules as 384 and 385):
--   * the request key's advisory lock first ('aver.convert:' || key), so two
--     calls with one key queue even for two different classes;
--   * then the cohort row is locked FOR UPDATE first, so two calls for one class
--     (two admins, or a double click) queue and the second sees the first's
--     rows;
--   * then each member's per-user advisory lock (fn_credit_lock_user, the key
--     of fn_credit_reserve and of every admin grant), taken in user_id order,
--     so two calls for two classes that share members lock them in one order
--     and cannot deadlock; transaction-scoped locks only.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

-- 383 (M1) and 384 (M2) and the class tables must be present.
DO $precondition$
BEGIN
    IF to_regprocedure('public.fn_credit_lock_user(uuid)') IS NULL
       OR to_regprocedure('public.fn_course_commerce_append_only()') IS NULL
       OR to_regprocedure('public.fn_entitlement_credit_usable(public.entitlements)') IS NULL
       OR to_regprocedure('public.fn_credit_usable_balance(uuid)') IS NULL
       OR to_regclass('public.credit_ledger') IS NULL
       OR to_regclass('public.cohorts') IS NULL
       OR to_regclass('public.student_cohort_memberships') IS NULL
       OR to_regclass('public.user_code_assignments') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.access_codes'::regclass
                         AND attname = 'cohort_id' AND NOT attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.access_codes'::regclass
                         AND attname = 'product_id' AND NOT attisdropped) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '387 needs 383, 384 and the class tables first';
    END IF;
END;
$precondition$;

-- ── credit_class_conversions: one row per request ──────────────────────────
-- Written in the same transaction as the conversion it records, before the
-- RPC returns; never updated or deleted. A resend of the same request_key is
-- answered from this row, under the key lock and before any write, so a retry
-- never reaches members who joined the class after the first call.
CREATE TABLE IF NOT EXISTS public.credit_class_conversions (
    request_key uuid PRIMARY KEY,
    cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES public.course_products(id) ON DELETE RESTRICT,
    credits_per_member integer NOT NULL CONSTRAINT credit_class_conversions_credits_check
        CHECK (credits_per_member BETWEEN 0 AND 100000),
    admin_id uuid NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER trg_credit_class_conversions_append_only
    BEFORE UPDATE OR DELETE ON public.credit_class_conversions
    FOR EACH ROW EXECUTE FUNCTION public.fn_course_commerce_append_only();
CREATE OR REPLACE TRIGGER trg_credit_class_conversions_no_truncate
    BEFORE TRUNCATE ON public.credit_class_conversions
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_course_commerce_append_only();
-- Read and written only by the SECURITY DEFINER RPC below.
ALTER TABLE public.credit_class_conversions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_class_conversions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.credit_class_conversions TO service_role;

-- ── fn_credit_convert_class (plan 5.18) ─────────────────────────────────────
-- Statuses: converted (+converted[], skipped[]), replay (the first call's
-- converted[] and skipped[] exactly, balances as they were then; nothing is
-- written), request_key_conflict (the key was used with another class,
-- product, credit amount or admin; nothing is written), cohort_not_found,
-- cohort_archived, cohort_has_no_course, product_invalid. Refusals record
-- nothing, so the same key can be sent again once the class is fixed. The backend picks the product before calling (409
-- no_class_product / product_ambiguous there).
--
-- Per active member (students joined through student_cohort_memberships):
--   * no account (students.user_id NULL)              -> skipped no_account;
--   * already has a credit-usable class or repractice
--     entitlement for the course (plan 5.3)           -> skipped already_metered;
--   * otherwise one entitlement, expiring with the legacy code of THIS class
--     the member holds: a code without expiry -> no expiry; else the latest
--     expires_at; a member added straight to the class (no code) -> no expiry.
--     "Holds a live code" is the same rule as
--     services/access_code_permissions._active_code_rows: an active
--     user_code_assignments row, or access_codes.used_by when that user has no
--     assignment row at all for the code (an inactive row is a deliberate
--     per-user revoke); live = not revoked, not locked, expires_at > now.
--   * ON CONFLICT (source, source_ref, user_id) DO NOTHING: a member converted
--     before in this class (even if that entitlement is now over) is skipped
--     already_metered; granting again is POST /admin/entitlements.
-- Credits go in only for a row this call inserted, and only when > 0.
CREATE OR REPLACE FUNCTION public.fn_credit_convert_class(
    p_admin_id uuid, p_cohort_id uuid, p_product_id uuid, p_credits_per_member integer, p_request_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_now timestamptz := statement_timestamp();
    v_course uuid;
    v_archived timestamptz;
    v_product public.course_products%ROWTYPE;
    v_member record;
    v_expires timestamptz;
    v_ent public.entitlements%ROWTYPE;
    v_balance integer;
    v_converted jsonb := '[]'::jsonb;
    v_skipped jsonb := '[]'::jsonb;
    v_prior public.credit_class_conversions%ROWTYPE;
    v_result jsonb;
BEGIN
    IF p_admin_id IS NULL OR p_cohort_id IS NULL OR p_product_id IS NULL OR p_request_key IS NULL
       OR p_credits_per_member IS NULL OR p_credits_per_member NOT BETWEEN 0 AND 100000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_convert_class_invalid_argument';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('aver.convert:' || p_request_key::text, 0));
    SELECT * INTO v_prior FROM public.credit_class_conversions WHERE request_key = p_request_key;
    IF FOUND THEN
        IF v_prior.cohort_id = p_cohort_id AND v_prior.product_id = p_product_id
           AND v_prior.credits_per_member = p_credits_per_member AND v_prior.admin_id = p_admin_id THEN
            RETURN v_prior.result || jsonb_build_object('status', 'replay');
        END IF;
        RETURN jsonb_build_object('status', 'request_key_conflict');
    END IF;
    SELECT c.course_id, c.archived_at INTO v_course, v_archived
      FROM public.cohorts c WHERE c.id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'cohort_not_found');
    END IF;
    IF v_archived IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'cohort_archived');
    END IF;
    IF v_course IS NULL THEN
        RETURN jsonb_build_object('status', 'cohort_has_no_course');
    END IF;
    SELECT * INTO v_product FROM public.course_products WHERE id = p_product_id FOR SHARE;
    IF NOT FOUND OR v_product.kind <> 'class' OR v_product.course_id <> v_course
       OR v_product.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'product_invalid');
    END IF;

    FOR v_member IN
        SELECT s.user_id
          FROM public.student_cohort_memberships m
          JOIN public.students s ON s.id = m.student_id
         WHERE m.cohort_id = p_cohort_id AND m.is_active
         ORDER BY s.user_id NULLS LAST, m.id
    LOOP
        IF v_member.user_id IS NULL THEN
            v_skipped := v_skipped || jsonb_build_object('user_id', NULL, 'reason', 'no_account');
            CONTINUE;
        END IF;
        PERFORM public.fn_credit_lock_user(v_member.user_id);
        IF EXISTS (SELECT 1 FROM public.entitlements e
                     JOIN public.course_products p ON p.id = e.product_id
                    WHERE e.user_id = v_member.user_id AND e.course_id = v_course
                      AND p.kind IN ('class', 'repractice')
                      AND public.fn_entitlement_credit_usable(e)) THEN
            v_skipped := v_skipped || jsonb_build_object('user_id', v_member.user_id, 'reason', 'already_metered');
            CONTINUE;
        END IF;
        SELECT CASE WHEN count(*) = 0 OR bool_or(h.expires_at IS NULL) THEN NULL
                    ELSE max(h.expires_at) END
          INTO v_expires
          FROM (SELECT c.expires_at
                  FROM public.access_codes c
                 WHERE c.cohort_id = p_cohort_id AND c.product_id IS NULL
                   AND c.is_revoked IS NOT TRUE AND c.is_active IS DISTINCT FROM false
                   AND (c.expires_at IS NULL OR c.expires_at > v_now)
                   AND (EXISTS (SELECT 1 FROM public.user_code_assignments a
                                 WHERE a.code_id = c.id AND a.user_id = v_member.user_id AND a.is_active)
                        OR (c.used_by = v_member.user_id
                            AND NOT EXISTS (SELECT 1 FROM public.user_code_assignments a
                                             WHERE a.code_id = c.id AND a.user_id = v_member.user_id)))) h;
        INSERT INTO public.entitlements (user_id, product_id, course_id, source, source_ref, starts_at, expires_at,
                                         granted_by, reason)
        VALUES (v_member.user_id, v_product.id, v_course, 'class_conversion', p_cohort_id, v_now, v_expires,
                p_admin_id, 'class_conversion')
        ON CONFLICT (source, source_ref, user_id) DO NOTHING
        RETURNING * INTO v_ent;
        IF NOT FOUND THEN
            v_skipped := v_skipped || jsonb_build_object('user_id', v_member.user_id, 'reason', 'already_metered');
            CONTINUE;
        END IF;
        IF p_credits_per_member > 0 THEN
            INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, actor_id)
            VALUES (v_member.user_id, v_ent.id, p_credits_per_member, 'grant',
                    'convert:' || p_cohort_id::text || ':' || v_member.user_id::text || ':grant', p_admin_id)
            ON CONFLICT DO NOTHING;
        END IF;
        INSERT INTO public.entitlement_events (entitlement_id, action, actor_id, actor_kind, after, reason)
        VALUES (v_ent.id, 'grant', p_admin_id, 'admin',
                jsonb_build_object('source', 'class_conversion', 'request_key', p_request_key,
                                   'cohort_id', p_cohort_id, 'credits', p_credits_per_member),
                'class_conversion');
        SELECT b.balance INTO v_balance FROM public.fn_credit_usable_balance(v_ent.id) b;
        v_converted := v_converted || jsonb_build_object('user_id', v_member.user_id, 'entitlement_id', v_ent.id,
                                                         'expires_at', v_ent.expires_at, 'balance', v_balance);
    END LOOP;

    v_result := jsonb_build_object('status', 'converted', 'converted', v_converted, 'skipped', v_skipped);
    INSERT INTO public.credit_class_conversions (request_key, cohort_id, product_id, credits_per_member,
                                                 admin_id, result)
    VALUES (p_request_key, p_cohort_id, p_product_id, p_credits_per_member, p_admin_id, v_result);
    RETURN v_result;
END;
$$;

-- RPC: service_role only (plan 5.3).
REVOKE ALL ON FUNCTION public.fn_credit_convert_class(uuid, uuid, uuid, integer, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credit_convert_class(uuid, uuid, uuid, integer, uuid) TO service_role;

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_routine regprocedure := 'public.fn_credit_convert_class(uuid,uuid,uuid,integer,uuid)'::regprocedure;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_routine AND prosecdef
                      AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '387 postcondition: definer/search_path';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_routine AND a.grantee = 0)
       OR has_function_privilege('anon', v_routine, 'EXECUTE')
       OR has_function_privilege('authenticated', v_routine, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_routine, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '387 postcondition: EXECUTE';
    END IF;
    -- 'class_conversion' is a source 383 already allows.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_source_check'
                    AND conrelid = 'public.entitlements'::regclass
                    AND pg_get_constraintdef(oid) LIKE '%class_conversion%')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_source_ref_user_key'
                       AND conrelid = 'public.entitlements'::regclass) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '387 postcondition: entitlements constraints';
    END IF;
    IF to_regclass('public.credit_class_conversions') IS NULL
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.credit_class_conversions'::regclass)
       OR has_table_privilege('anon', 'public.credit_class_conversions', 'SELECT')
       OR has_table_privilege('authenticated', 'public.credit_class_conversions', 'SELECT')
       OR has_table_privilege('service_role', 'public.credit_class_conversions', 'INSERT')
       OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.credit_class_conversions'::regclass
             AND tgname IN ('trg_credit_class_conversions_append_only',
                            'trg_credit_class_conversions_no_truncate')) <> 2 THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '387 postcondition: credit_class_conversions';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
