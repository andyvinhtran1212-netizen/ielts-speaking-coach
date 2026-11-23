-- COURSEACCESS-0055 T011 (G04-T12), credit lifecycle. The spec calls this file
-- "383"; that number is only a working label. register.tsv assigns 385
-- (Andy, 2026-11-20, approval-decision.md).
--
-- Purpose (plan.md 5.15): close the credit book of an entitlement whose
-- credits can no longer be used, carry the unused credits of an online term
-- into its renewal (CREDIT_CARRY_PERCENT, default 100), lapse a carry after its
-- hold (CREDIT_CARRY_VALID_DAYS, default 60, from the new term's starts_at),
-- and grant extra credits on an entitlement. Two RPCs, no table, no column, no
-- seed, no change to any existing row. The carry_left formula stays in 384's
-- fn_credit_usable_balance; this file calls it instead of copying it.
--
-- Forward: pending_feature course_commerce. No apply on merge. Applied after
-- 383 and 384, on staging first under the advisory-locked runner after SA
-- review and Andy's typed approval; production only at an authorised
-- staging-to-main promotion. Re-runnable; one transaction; postcondition block.
-- Rollback: deploy the preceding backend (the sweep and the confirm path then
-- log "skipped=no_function"), then rollback/385_credit_lifecycle.sql (drops the
-- two RPCs; ledger rows they wrote stay, the ledger is append-only).
--
-- Locking (same rules as 384):
--   * transaction-scoped advisory locks only, the same per-user key as
--     fn_credit_reserve, taken BEFORE the entitlement row lock, so a reserve
--     (advisory lock, then the ledger FK's KEY SHARE on the entitlement) and
--     this function always queue in one order;
--   * the row lock is FOR NO KEY UPDATE SKIP LOCKED: it does not block the
--     ledger FK check, and two sweeps never touch the same entitlement;
--   * the sweep (p_user_id NULL) takes each learner's advisory lock with
--     pg_try_advisory_xact_lock and leaves a busy learner to the next run, so
--     two sweeps holding several learners' locks cannot deadlock; the call for
--     one learner after a confirm waits for that learner's lock instead.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

-- 383 (M1) and 384 (M2) must be present.
DO $precondition$
BEGIN
    IF to_regprocedure('public.fn_credit_usable_balance(uuid)') IS NULL
       OR to_regprocedure('public.fn_entitlement_credit_usable(public.entitlements)') IS NULL
       OR to_regclass('public.credit_ledger') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '385 needs 383 and 384 applied first';
    END IF;
END;
$precondition$;

-- ── fn_credit_expire_entitlements (plan 5.15) ───────────────────────────────
-- Three steps in order, one transaction. An entitlement that still holds an
-- open reservation is skipped by every step this time (a hold settles or
-- lapses within 24 hours); the learner-facing balance is already right in the
-- meantime because fn_credit_usable_balance is time-based.
--   1. lapse a carry past its hold date: carry_expire = carry_lapsed;
--   2. close a book that can no longer be used (credit or access window over,
--      or revoked): an unclosed carry is closed first (carry_left +
--      carry_lapsed), so a carry is never carried a second time; then the rest
--      goes out as expire;
--   3. carry into a renewal once the previous term is closed: carry_over =
--      floor(|expire| * percent / 100), never counting carry_expire, 0 for a
--      revoked previous term; carry_settled_at is set in every case.
CREATE OR REPLACE FUNCTION public.fn_credit_expire_entitlements(
    p_user_id uuid, p_limit integer, p_carry_percent integer, p_carry_valid_days integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_user uuid;
    v_ent public.entitlements%ROWTYPE;
    v_prev public.entitlements%ROWTYPE;
    v_bal record;
    v_amount integer;
    v_used integer;
    v_carry integer;
    v_closed integer := 0;
    v_carried integer := 0;
    v_carry_expired integer := 0;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
       OR p_carry_percent IS NULL OR p_carry_percent NOT BETWEEN 0 AND 100
       OR p_carry_valid_days IS NULL OR p_carry_valid_days NOT BETWEEN 0 AND 3650 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_lifecycle_invalid_argument';
    END IF;

    -- Step 1: a carry past its hold date.
    FOR v_id, v_user IN
        SELECT e.id, e.user_id FROM public.entitlements e
         WHERE (p_user_id IS NULL OR e.user_id = p_user_id)
           AND e.carry_expires_at <= now() AND e.carry_closed_at IS NULL
         ORDER BY e.carry_expires_at, e.id
         LIMIT p_limit
    LOOP
        IF p_user_id IS NULL THEN
            CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('aver.credit:' || v_user::text, 0));
        ELSE
            PERFORM public.fn_credit_lock_user(v_user);
        END IF;
        SELECT * INTO v_ent FROM public.entitlements
         WHERE id = v_id AND carry_expires_at <= now() AND carry_closed_at IS NULL
         FOR NO KEY UPDATE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.credit_reservations r
                               WHERE r.entitlement_id = v_id AND r.status = 'open');
        SELECT * INTO v_bal FROM public.fn_credit_usable_balance(v_id);
        IF v_bal.carry_lapsed > 0 THEN
            INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, note)
            VALUES (v_ent.user_id, v_id, -v_bal.carry_lapsed, 'carry_expire', 'ent:' || v_id || ':carry_expire',
                    'hết hạn bảo lưu ' || to_char(v_ent.carry_expires_at AT TIME ZONE 'Asia/Ho_Chi_Minh',
                                                   'DD/MM/YYYY'))
            ON CONFLICT (idempotency_key) DO NOTHING;
            IF FOUND THEN
                v_carry_expired := v_carry_expired + 1;
            END IF;
        END IF;
        UPDATE public.entitlements SET carry_closed_at = now() WHERE id = v_id;
    END LOOP;

    -- Step 2: close a book that can no longer be used.
    FOR v_id, v_user IN
        SELECT e.id, e.user_id FROM public.entitlements e
         WHERE (p_user_id IS NULL OR e.user_id = p_user_id)
           AND e.credits_closed_at IS NULL
           AND (e.status = 'revoked'
                OR coalesce(least(e.credits_expire_at, e.expires_at), e.credits_expire_at, e.expires_at) <= now())
         ORDER BY coalesce(least(e.credits_expire_at, e.expires_at), e.credits_expire_at, e.expires_at), e.id
         LIMIT p_limit
    LOOP
        IF p_user_id IS NULL THEN
            CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('aver.credit:' || v_user::text, 0));
        ELSE
            PERFORM public.fn_credit_lock_user(v_user);
        END IF;
        SELECT * INTO v_ent FROM public.entitlements
         WHERE id = v_id AND credits_closed_at IS NULL
           AND (status = 'revoked'
                OR coalesce(least(credits_expire_at, expires_at), credits_expire_at, expires_at) <= now())
         FOR NO KEY UPDATE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.credit_reservations r
                               WHERE r.entitlement_id = v_id AND r.status = 'open');
        IF v_ent.carry_settled_at IS NOT NULL AND v_ent.carry_expires_at IS NOT NULL
           AND v_ent.carry_closed_at IS NULL THEN
            SELECT * INTO v_bal FROM public.fn_credit_usable_balance(v_id);
            v_amount := v_bal.carry_left + v_bal.carry_lapsed;
            IF v_amount > 0 THEN
                INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, note)
                VALUES (v_ent.user_id, v_id, -v_amount, 'carry_expire', 'ent:' || v_id || ':carry_expire',
                        'hết hạn cùng kỳ ' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'))
                ON CONFLICT (idempotency_key) DO NOTHING;
                IF FOUND THEN
                    v_carry_expired := v_carry_expired + 1;
                END IF;
            END IF;
            UPDATE public.entitlements SET carry_closed_at = now() WHERE id = v_id;
        END IF;
        -- The carry is closed (or never existed), so the usable balance is the
        -- plain sum of the ledger: what this term itself still holds.
        SELECT * INTO v_bal FROM public.fn_credit_usable_balance(v_id);
        IF v_bal.balance > 0 THEN
            INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key)
            VALUES (v_ent.user_id, v_id, -v_bal.balance, 'expire', 'ent:' || v_id || ':expire')
            ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
        UPDATE public.entitlements SET credits_closed_at = now() WHERE id = v_id;
        v_closed := v_closed + 1;
    END LOOP;

    -- Step 3: carry into a renewal of the same product once the previous term
    -- is closed. renews_entitlement_id is only ever set by the order confirm
    -- (same user, same product, renewal window), so class and code
    -- entitlements never reach this step.
    FOR v_id, v_user IN
        SELECT e.id, e.user_id FROM public.entitlements e
          JOIN public.entitlements prev ON prev.id = e.renews_entitlement_id
         WHERE (p_user_id IS NULL OR e.user_id = p_user_id)
           AND e.carry_settled_at IS NULL AND prev.credits_closed_at IS NOT NULL
         ORDER BY e.starts_at, e.id
         LIMIT p_limit
    LOOP
        IF p_user_id IS NULL THEN
            CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('aver.credit:' || v_user::text, 0));
        ELSE
            PERFORM public.fn_credit_lock_user(v_user);
        END IF;
        SELECT * INTO v_ent FROM public.entitlements
         WHERE id = v_id AND carry_settled_at IS NULL
         FOR NO KEY UPDATE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.credit_reservations r
                               WHERE r.entitlement_id = v_id AND r.status = 'open');
        SELECT * INTO v_prev FROM public.entitlements WHERE id = v_ent.renews_entitlement_id;
        CONTINUE WHEN v_prev.credits_closed_at IS NULL;
        v_used := 0;
        IF v_prev.status = 'active' THEN
            SELECT coalesce(abs(l.delta), 0) INTO v_used FROM public.credit_ledger l
             WHERE l.idempotency_key = 'ent:' || v_prev.id || ':expire';
            v_used := coalesce(v_used, 0);
        END IF;
        v_carry := (v_used * p_carry_percent) / 100;
        IF v_carry > 0 AND v_ent.status = 'active' AND v_ent.credits_closed_at IS NULL THEN
            INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, note)
            VALUES (v_ent.user_id, v_id, v_carry, 'carry_over', 'carry:' || v_prev.id || ':' || v_id,
                    v_used || ' × ' || p_carry_percent || '% = ' || v_carry);
            UPDATE public.entitlements
               SET carry_settled_at = now(),
                   carry_expires_at = least(v_ent.starts_at + make_interval(days => p_carry_valid_days),
                                            coalesce(least(v_ent.credits_expire_at, v_ent.expires_at),
                                                     v_ent.credits_expire_at, v_ent.expires_at))
             WHERE id = v_id;
            v_carried := v_carried + 1;
        ELSE
            UPDATE public.entitlements SET carry_settled_at = now() WHERE id = v_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('closed', v_closed, 'carried', v_carried, 'carry_expired', v_carry_expired);
END;
$$;

-- ── fn_credit_grant_extra (plan 5.15) ───────────────────────────────────────
-- One grant_extra row per (request_key, entitlement): calling the batch again
-- with the same key adds nothing. p_reason goes only to the note; the reason
-- column is always the literal 'grant_extra'. p_actor_kind is kept for the
-- instructor case (Q5); the backend route passes 'admin' only.
CREATE OR REPLACE FUNCTION public.fn_credit_grant_extra(
    p_actor_id uuid, p_actor_kind text, p_entitlement_id uuid, p_credits integer, p_reason text,
    p_request_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ent public.entitlements%ROWTYPE;
    v_user uuid;
    v_key text;
    v_id bigint;
    v_balance integer;
BEGIN
    IF p_actor_id IS NULL OR p_actor_kind IS NULL OR p_actor_kind NOT IN ('admin', 'instructor')
       OR p_entitlement_id IS NULL
       OR p_credits IS NULL OR p_credits NOT BETWEEN 1 AND 100000
       OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500
       OR p_request_key IS NULL OR char_length(p_request_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_grant_extra_invalid_argument';
    END IF;
    v_key := 'extra:' || p_request_key || ':' || p_entitlement_id;
    SELECT user_id INTO v_user FROM public.entitlements WHERE id = p_entitlement_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    PERFORM public.fn_credit_lock_user(v_user);
    SELECT id INTO v_id FROM public.credit_ledger WHERE idempotency_key = v_key;
    IF FOUND THEN
        SELECT b.balance INTO v_balance FROM public.fn_credit_usable_balance(p_entitlement_id) b;
        RETURN jsonb_build_object('status', 'replay', 'ledger_id', v_id, 'balance', v_balance);
    END IF;
    -- Read the row again under the learner's lock: a revoke or a close that
    -- committed meanwhile is seen.
    SELECT * INTO v_ent FROM public.entitlements WHERE id = p_entitlement_id;
    IF NOT public.fn_entitlement_credit_usable(v_ent) THEN
        RETURN jsonb_build_object('status', 'not_usable');
    END IF;
    INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, actor_id, note)
    VALUES (v_ent.user_id, v_ent.id, p_credits, 'grant_extra', v_key, p_actor_id, btrim(p_reason))
    RETURNING id INTO v_id;
    SELECT b.balance INTO v_balance FROM public.fn_credit_usable_balance(v_ent.id) b;
    RETURN jsonb_build_object('status', 'granted', 'ledger_id', v_id, 'balance', v_balance);
END;
$$;

-- RPCs: service_role only (plan 5.3).
DO $rpcs$
DECLARE
    v_routine regprocedure;
BEGIN
    FOREACH v_routine IN ARRAY ARRAY[
        'public.fn_credit_expire_entitlements(uuid,integer,integer,integer)'::regprocedure,
        'public.fn_credit_grant_extra(uuid,text,uuid,integer,text,text)'::regprocedure
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_routine);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_routine);
    END LOOP;
END;
$rpcs$;

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_routine regprocedure;
BEGIN
    FOREACH v_routine IN ARRAY ARRAY[
        'public.fn_credit_expire_entitlements(uuid,integer,integer,integer)'::regprocedure,
        'public.fn_credit_grant_extra(uuid,text,uuid,integer,text,text)'::regprocedure
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_routine AND prosecdef
                          AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '385 postcondition: definer/search_path ' || v_routine;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE p.oid = v_routine AND a.grantee = 0)
           OR has_function_privilege('anon', v_routine, 'EXECUTE')
           OR has_function_privilege('authenticated', v_routine, 'EXECUTE')
           OR NOT has_function_privilege('service_role', v_routine, 'EXECUTE') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '385 postcondition: EXECUTE on ' || v_routine;
        END IF;
    END LOOP;
    -- The lifecycle stamps this file sets are allowed by 383's guard trigger.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entitlements_guard'
                    AND tgrelid = 'public.entitlements'::regclass)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_credit_ledger_append_only'
                       AND tgrelid = 'public.credit_ledger'::regclass) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '385 postcondition: triggers';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
