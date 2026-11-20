-- COURSEACCESS-0055 T001 (G04-T01), migration M1 "course commerce core".
-- The spec calls this file "381"; that number is only a working label. 381/382
-- are reserved for FU-2281, so register.tsv assigns 383 (spec rollout.md).
--
-- Purpose: course products, learner entitlements, access codes that carry a
-- product and a credit grant, bank-transfer enrollment orders and the single
-- learner email outbox (spec plan.md 5.1, 5.2, 5.5). Schema, guards and the
-- access-code entitlement trigger only: no RPC (that is M2), no seed, no
-- backfill, no change to any existing row. Legacy codes (product_id NULL) never
-- reach the trigger, so every code activated before this file keeps working
-- exactly as today.
--
-- Forward: pending_feature course_commerce. No apply on merge. Staging first
-- under the advisory-locked runner after SA review and Andy's typed approval;
-- production only at an authorised staging-to-main promotion. M1 and M2 are
-- always applied in the same run: the code trigger writes credit_ledger (M2)
-- through dynamic SQL and raises credit_ledger_missing while M2 is absent, so a
-- code with a product and credits cannot be consumed before the ledger exists.
-- Order: 383 (M1) -> M2 -> the other course_commerce files.
-- Re-runnable; one transaction; postcondition block at the end.
-- Rollback: deploy the preceding backend, then rollback/383_course_commerce_core.sql
-- (keeps every table and row, removes the access-code triggers and functions).
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

-- ── courses.kind ────────────────────────────────────────────────────────────
-- Existing rows (C1..C5) become 'class'; the default is a constant, no rewrite.
ALTER TABLE public.courses
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'class'
        CONSTRAINT courses_kind_check CHECK (kind IN ('class', 'online'));

-- ── course_products ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.course_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
    slug text NOT NULL UNIQUE
        CONSTRAINT course_products_slug_check
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
    kind text NOT NULL CONSTRAINT course_products_kind_check
        CHECK (kind IN ('online', 'class', 'repractice')),
    title text NOT NULL CONSTRAINT course_products_title_check
        CHECK (char_length(title) BETWEEN 1 AND 120),
    short_title text CONSTRAINT course_products_short_title_check
        CHECK (short_title IS NULL OR char_length(short_title) BETWEEN 1 AND 60),
    summary text CONSTRAINT course_products_summary_check
        CHECK (summary IS NULL OR char_length(summary) <= 1000),
    status text NOT NULL DEFAULT 'draft' CONSTRAINT course_products_status_check
        CHECK (status IN ('draft', 'coming_soon', 'open', 'closed')),
    is_public boolean NOT NULL DEFAULT false,
    tuition_vnd integer CONSTRAINT course_products_tuition_check
        CHECK (tuition_vnd IS NULL OR tuition_vnd > 0),
    access_days integer CONSTRAINT course_products_access_days_check
        CHECK (access_days IS NULL OR access_days BETWEEN 1 AND 3650),
    ai_credits integer NOT NULL DEFAULT 0 CONSTRAINT course_products_ai_credits_check
        CHECK (ai_credits BETWEEN 0 AND 100000),
    credit_valid_days integer CONSTRAINT course_products_credit_valid_days_check
        CHECK (credit_valid_days IS NULL OR credit_valid_days BETWEEN 1 AND 3650),
    features text[] NOT NULL DEFAULT '{}' CONSTRAINT course_products_features_check
        CHECK (features <@ ARRAY['speaking', 'writing', 'reading', 'listening', 'grammar', 'vocabulary']::text[]),
    -- Writing only (FR-020): Speaking is always graded and returned at once.
    review_mode text NOT NULL DEFAULT 'ai_instant' CONSTRAINT course_products_review_mode_check
        CHECK (review_mode IN ('ai_instant', 'teacher_review')),
    display_order integer NOT NULL DEFAULT 0,
    expected_open_on date,
    -- Key shape (level_from, level_to, author, faq) is validated by the backend.
    presentation jsonb NOT NULL DEFAULT '{}' CONSTRAINT course_products_presentation_check
        CHECK (jsonb_typeof(presentation) = 'object'),
    archived_at timestamptz,
    archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT course_products_public_online CHECK (kind = 'online' OR NOT is_public),
    CONSTRAINT course_products_open_online_tuition
        CHECK (NOT (kind = 'online' AND status = 'open') OR tuition_vnd IS NOT NULL),
    CONSTRAINT course_products_open_online_access_days
        CHECK (kind <> 'online' OR status <> 'open' OR access_days IS NOT NULL),
    CONSTRAINT course_products_archived_hidden
        CHECK (archived_at IS NULL OR (status IN ('draft', 'closed') AND NOT is_public)),
    CONSTRAINT course_products_id_course_key UNIQUE (id, course_id)
);
CREATE INDEX IF NOT EXISTS ix_course_products_public_order
    ON public.course_products (display_order) WHERE is_public AND archived_at IS NULL;
CREATE OR REPLACE TRIGGER trg_course_products_updated_at
    BEFORE UPDATE ON public.course_products
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── entitlements ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT on purpose (FR-052): account deletion anonymises users and keeps
    -- these rows as accounting evidence.
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    product_id uuid NOT NULL,
    course_id uuid NOT NULL,
    source text NOT NULL CONSTRAINT entitlements_source_check
        CHECK (source IN ('enrollment_order', 'access_code', 'admin_grant', 'class_conversion')),
    source_ref uuid NOT NULL,
    -- "Expired" is derived from expires_at, never stored.
    status text NOT NULL DEFAULT 'active' CONSTRAINT entitlements_status_check
        CHECK (status IN ('active', 'revoked')),
    starts_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz CONSTRAINT entitlements_expires_check
        CHECK (expires_at IS NULL OR expires_at > starts_at),
    credits_expire_at timestamptz CONSTRAINT entitlements_credits_expire_check
        CHECK (credits_expire_at IS NULL OR credits_expire_at > starts_at),
    credits_closed_at timestamptz,
    renews_entitlement_id uuid REFERENCES public.entitlements(id) ON DELETE RESTRICT,
    carry_settled_at timestamptz,
    carry_expires_at timestamptz CONSTRAINT entitlements_carry_expires_check
        CHECK (carry_expires_at IS NULL OR carry_settled_at IS NOT NULL),
    carry_closed_at timestamptz CONSTRAINT entitlements_carry_closed_check
        CHECK (carry_closed_at IS NULL OR carry_expires_at IS NOT NULL),
    review_mode text CONSTRAINT entitlements_review_mode_check
        CHECK (review_mode IS NULL OR review_mode IN ('ai_instant', 'teacher_review')),
    granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    reason text CONSTRAINT entitlements_reason_check
        CHECK (reason IS NULL OR char_length(reason) <= 500),
    revoked_at timestamptz,
    revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    revoke_reason text CONSTRAINT entitlements_revoke_reason_check
        CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT entitlements_revoked_consistent CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CONSTRAINT entitlements_product_course_fkey FOREIGN KEY (product_id, course_id)
        REFERENCES public.course_products(id, course_id) ON DELETE RESTRICT,
    CONSTRAINT entitlements_source_ref_user_key UNIQUE (source, source_ref, user_id)
);
CREATE INDEX IF NOT EXISTS ix_entitlements_user_course_active
    ON public.entitlements (user_id, course_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_entitlements_credit_close_due
    ON public.entitlements ((coalesce(credits_expire_at, expires_at)))
    WHERE credits_closed_at IS NULL AND status = 'active';

-- Only (a) active -> revoked with revoked_*, (b) extension: expires_at grows and,
-- in the same statement, credits_expire_at may grow, (c) credits_closed_at,
-- carry_settled_at (+ carry_expires_at in that statement) and carry_closed_at
-- go from NULL to a value exactly once. Everything else is immutable.
CREATE OR REPLACE FUNCTION public.fn_entitlements_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_extended boolean;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_append_only';
    END IF;
    IF (NEW.id, NEW.user_id, NEW.product_id, NEW.course_id, NEW.source, NEW.source_ref,
        NEW.starts_at, NEW.renews_entitlement_id, NEW.review_mode, NEW.granted_by,
        NEW.reason, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.product_id, OLD.course_id, OLD.source, OLD.source_ref,
        OLD.starts_at, OLD.renews_entitlement_id, OLD.review_mode, OLD.granted_by,
        OLD.reason, OLD.created_at) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    -- (a) revoke, once and never back.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status <> 'active' OR NEW.status <> 'revoked' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
        END IF;
    ELSIF (NEW.revoked_at, NEW.revoked_by, NEW.revoke_reason)
          IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by, OLD.revoke_reason) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    -- (b) extension only grows a bounded access window.
    v_extended := NEW.expires_at IS DISTINCT FROM OLD.expires_at;
    IF v_extended AND (OLD.status <> 'active' OR NEW.status <> 'active'
                       OR OLD.expires_at IS NULL OR NEW.expires_at IS NULL
                       OR NEW.expires_at <= OLD.expires_at) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    IF NEW.credits_expire_at IS DISTINCT FROM OLD.credits_expire_at
       AND (NOT v_extended OR OLD.credits_expire_at IS NULL OR NEW.credits_expire_at IS NULL
            OR NEW.credits_expire_at <= OLD.credits_expire_at) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    -- (c) lifecycle stamps: NULL -> value, once.
    IF NEW.credits_closed_at IS DISTINCT FROM OLD.credits_closed_at
       AND (OLD.credits_closed_at IS NOT NULL OR NEW.credits_closed_at IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    IF NEW.carry_settled_at IS DISTINCT FROM OLD.carry_settled_at
       AND (OLD.carry_settled_at IS NOT NULL OR NEW.carry_settled_at IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    -- carry_expires_at is set only together with carry_settled_at; an extension
    -- never moves it.
    IF NEW.carry_expires_at IS DISTINCT FROM OLD.carry_expires_at
       AND (OLD.carry_expires_at IS NOT NULL OR OLD.carry_settled_at IS NOT NULL
            OR NEW.carry_settled_at IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    IF NEW.carry_closed_at IS DISTINCT FROM OLD.carry_closed_at
       AND (OLD.carry_closed_at IS NOT NULL OR NEW.carry_closed_at IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entitlement_immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_entitlements_guard
    BEFORE UPDATE OR DELETE ON public.entitlements
    FOR EACH ROW EXECUTE FUNCTION public.fn_entitlements_guard();
CREATE OR REPLACE TRIGGER trg_entitlements_no_truncate
    BEFORE TRUNCATE ON public.entitlements
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_entitlements_guard();
CREATE OR REPLACE TRIGGER trg_entitlements_updated_at
    BEFORE UPDATE ON public.entitlements
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── entitlement_events (append-only) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlement_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entitlement_id uuid NOT NULL REFERENCES public.entitlements(id) ON DELETE RESTRICT,
    action text NOT NULL CONSTRAINT entitlement_events_action_check
        CHECK (action IN ('grant', 'extend', 'revoke')),
    actor_id uuid,
    actor_kind text NOT NULL CONSTRAINT entitlement_events_actor_kind_check
        CHECK (actor_kind IN ('admin', 'instructor', 'system', 'learner')),
    before jsonb,
    after jsonb,
    reason text CONSTRAINT entitlement_events_reason_check
        CHECK (reason IS NULL OR char_length(reason) <= 500),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_entitlement_events_entitlement
    ON public.entitlement_events (entitlement_id, created_at);

-- Shared by the three append-only event/ledger tables of this file (mig 356 pattern).
CREATE OR REPLACE FUNCTION public.fn_course_commerce_append_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = TG_TABLE_NAME || '_append_only';
END;
$$;
CREATE OR REPLACE TRIGGER trg_entitlement_events_append_only
    BEFORE UPDATE OR DELETE ON public.entitlement_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_course_commerce_append_only();
CREATE OR REPLACE TRIGGER trg_entitlement_events_no_truncate
    BEFORE TRUNCATE ON public.entitlement_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_course_commerce_append_only();

-- ── access_codes: product, access days and credits granted with the code ────
-- For a code with a product, expires_at is the deadline to enter the code; the
-- access window is coalesce(grant_days, product.access_days) from used_at and
-- the credits granted are grant_credits (never product.ai_credits).
ALTER TABLE public.access_codes
    ADD COLUMN IF NOT EXISTS product_id uuid,
    ADD COLUMN IF NOT EXISTS grant_days integer,
    ADD COLUMN IF NOT EXISTS grant_credits integer;
ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS access_codes_product_id_fkey;
ALTER TABLE public.access_codes ADD CONSTRAINT access_codes_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.course_products(id) ON DELETE RESTRICT;
ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS access_codes_grant_days_check;
ALTER TABLE public.access_codes ADD CONSTRAINT access_codes_grant_days_check
    CHECK (grant_days IS NULL OR grant_days BETWEEN 1 AND 3650);
ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS access_codes_grant_credits_check;
ALTER TABLE public.access_codes ADD CONSTRAINT access_codes_grant_credits_check
    CHECK (grant_credits IS NULL OR grant_credits BETWEEN 0 AND 100000);
ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS access_codes_product_credits;
ALTER TABLE public.access_codes ADD CONSTRAINT access_codes_product_credits
    CHECK (product_id IS NULL OR grant_credits IS NOT NULL);
CREATE INDEX IF NOT EXISTS ix_access_codes_product
    ON public.access_codes (product_id) WHERE product_id IS NOT NULL;

-- FR-010: a code can only carry a class or re-practice product. Its terms are
-- frozen once the code is used, so an existing (legacy) code can never be turned
-- into a metered one in place: that is the admin class conversion (G04-T15).
CREATE OR REPLACE FUNCTION public.fn_access_codes_product_kind()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.is_used
       AND (NEW.product_id, NEW.grant_days, NEW.grant_credits)
           IS DISTINCT FROM (OLD.product_id, OLD.grant_days, OLD.grant_credits) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'access_code_product_locked';
    END IF;
    IF NEW.product_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.course_products
         WHERE id = NEW.product_id AND kind IN ('class', 'repractice')) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'access_code_product_kind';
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_access_codes_product_kind
    BEFORE INSERT OR UPDATE OF product_id, grant_days, grant_credits ON public.access_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_access_codes_product_kind();

-- Revoke the active access-code entitlements of one code (and one user).
CREATE OR REPLACE FUNCTION public.fn_access_code_entitlement_revoke(
    p_code_id uuid, p_user_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_row public.entitlements%ROWTYPE;
BEGIN
    FOR v_row IN
        UPDATE public.entitlements
           SET status = 'revoked', revoked_at = statement_timestamp(), revoke_reason = p_reason
         WHERE source = 'access_code' AND source_ref = p_code_id AND status = 'active'
           AND (p_user_id IS NULL OR user_id = p_user_id)
        RETURNING *
    LOOP
        INSERT INTO public.entitlement_events (entitlement_id, action, actor_kind, before, after, reason)
        VALUES (v_row.id, 'revoke', 'system',
                jsonb_build_object('status', 'active'),
                jsonb_build_object('status', 'revoked', 'revoked_at', v_row.revoked_at),
                p_reason);
    END LOOP;
END;
$$;

-- AFTER trigger: an error here aborts the statement that used the code, so the
-- code stays unused (fn_activation_serialize returns activation_error).
CREATE OR REPLACE FUNCTION public.fn_access_code_entitlement_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_product public.course_products%ROWTYPE;
    v_days integer;
    v_starts timestamptz;
    v_entitlement uuid;
    v_revoked boolean := coalesce(NEW.is_revoked, false) OR NOT coalesce(NEW.is_active, true);
BEGIN
    IF v_revoked THEN
        PERFORM public.fn_access_code_entitlement_revoke(NEW.id, NULL, 'code_revoked');
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.used_by IS NOT NULL
       AND OLD.used_by IS DISTINCT FROM NEW.used_by THEN
        PERFORM public.fn_access_code_entitlement_revoke(NEW.id, OLD.used_by, 'code_reassigned');
    END IF;
    IF NOT coalesce(NEW.is_used, false) OR NEW.used_by IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT * INTO STRICT v_product FROM public.course_products WHERE id = NEW.product_id;
    v_days := coalesce(NEW.grant_days, v_product.access_days);
    v_starts := coalesce(NEW.used_at, statement_timestamp());
    INSERT INTO public.entitlements (user_id, product_id, course_id, source, source_ref,
                                     starts_at, expires_at)
    VALUES (NEW.used_by, v_product.id, v_product.course_id, 'access_code', NEW.id, v_starts,
            CASE WHEN v_days IS NULL THEN NULL ELSE v_starts + make_interval(days => v_days) END)
    ON CONFLICT (source, source_ref, user_id) DO NOTHING
    RETURNING id INTO v_entitlement;
    IF v_entitlement IS NULL THEN
        RETURN NULL;  -- already granted (or revoked earlier): never twice
    END IF;

    IF coalesce(NEW.grant_credits, 0) > 0 THEN
        -- credit_ledger is created by M2; this file must not depend on it.
        IF to_regclass('public.credit_ledger') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'credit_ledger_missing';
        END IF;
        EXECUTE 'INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key)
                 VALUES ($1, $2, $3, ''grant'', $4) ON CONFLICT (idempotency_key) DO NOTHING'
          USING NEW.used_by, v_entitlement, NEW.grant_credits,
                'code:' || NEW.id::text || ':' || NEW.used_by::text || ':grant';
    END IF;
    INSERT INTO public.entitlement_events (entitlement_id, action, actor_kind, after)
    VALUES (v_entitlement, 'grant', 'system',
            jsonb_build_object('source', 'access_code', 'starts_at', v_starts,
                               'access_days', v_days, 'credits', coalesce(NEW.grant_credits, 0)));
    RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER trg_access_codes_entitlement_sync
    AFTER INSERT OR UPDATE OF is_used, used_by, is_revoked, is_active ON public.access_codes
    FOR EACH ROW WHEN (NEW.product_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_access_code_entitlement_sync();

CREATE OR REPLACE FUNCTION public.fn_code_assignment_entitlement_revoke()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM public.fn_access_code_entitlement_revoke(NEW.code_id, NEW.user_id, 'assignment_removed');
    RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER trg_code_assignment_entitlement_revoke
    AFTER UPDATE OF is_active ON public.user_code_assignments
    FOR EACH ROW WHEN (OLD.is_active AND NOT NEW.is_active)
    EXECUTE FUNCTION public.fn_code_assignment_entitlement_revoke();

-- ── enrollment_orders ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enrollment_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_code text NOT NULL UNIQUE CONSTRAINT enrollment_orders_code_check
        CHECK (order_code ~ '^AVER-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES public.course_products(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'awaiting_transfer' CONSTRAINT enrollment_orders_status_check
        CHECK (status IN ('awaiting_transfer', 'transfer_reported', 'needs_info',
                          'confirmed', 'expired', 'cancelled')),
    -- Snapshot of the product terms when the order was created.
    tuition_vnd integer NOT NULL CONSTRAINT enrollment_orders_tuition_check CHECK (tuition_vnd > 0),
    access_days integer NOT NULL CONSTRAINT enrollment_orders_access_days_check CHECK (access_days > 0),
    ai_credits integer NOT NULL CONSTRAINT enrollment_orders_ai_credits_check CHECK (ai_credits >= 0),
    credit_valid_days integer CONSTRAINT enrollment_orders_credit_valid_days_check
        CHECK (credit_valid_days IS NULL OR credit_valid_days > 0),
    product_title text NOT NULL,
    request_key text NOT NULL CONSTRAINT enrollment_orders_request_key_check
        CHECK (char_length(request_key) BETWEEN 8 AND 80),
    learner_note text CONSTRAINT enrollment_orders_learner_note_check
        CHECK (learner_note IS NULL OR char_length(learner_note) <= 1000),
    info_kind text CONSTRAINT enrollment_orders_info_kind_check
        CHECK (info_kind IS NULL OR info_kind IN ('underpaid', 'not_found', 'other')),
    -- Display and audit only: the server never decides on this amount.
    received_vnd integer CONSTRAINT enrollment_orders_received_check
        CHECK (received_vnd IS NULL OR received_vnd >= 0),
    admin_message text CONSTRAINT enrollment_orders_admin_message_check
        CHECK (admin_message IS NULL OR char_length(admin_message) <= 1000),
    supplement_by timestamptz,
    pay_by timestamptz NOT NULL,
    transfer_reported_at timestamptz,
    late_transfer_reported_at timestamptz,
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    expired_at timestamptz,
    reopened_at timestamptz,
    confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    cancel_reason text CONSTRAINT enrollment_orders_cancel_reason_check
        CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 500),
    entitlement_id uuid REFERENCES public.entitlements(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT enrollment_orders_confirmed_entitlement
        CHECK ((status = 'confirmed') = (entitlement_id IS NOT NULL)),
    CONSTRAINT enrollment_orders_user_request_key UNIQUE (user_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_orders_one_open
    ON public.enrollment_orders (user_id, product_id)
    WHERE status IN ('awaiting_transfer', 'transfer_reported', 'needs_info');
CREATE INDEX IF NOT EXISTS ix_enrollment_orders_status_created
    ON public.enrollment_orders (status, created_at);
CREATE INDEX IF NOT EXISTS ix_enrollment_orders_user_created
    ON public.enrollment_orders (user_id, created_at DESC);

-- Transition table of plan 5.5. A same-status update (needs_info marked again,
-- late_transfer_reported_at on an expired order) is not a transition.
CREATE OR REPLACE FUNCTION public.fn_enrollment_orders_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'enrollment_order_append_only';
    END IF;
    IF (NEW.id, NEW.user_id, NEW.product_id, NEW.order_code, NEW.tuition_vnd, NEW.access_days,
        NEW.ai_credits, NEW.credit_valid_days, NEW.product_title, NEW.request_key, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.product_id, OLD.order_code, OLD.tuition_vnd, OLD.access_days,
        OLD.ai_credits, OLD.credit_valid_days, OLD.product_title, OLD.request_key, OLD.created_at) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'enrollment_order_immutable';
    END IF;
    IF OLD.status IN ('confirmed', 'cancelled')
       AND (NEW.status, NEW.entitlement_id) IS DISTINCT FROM (OLD.status, OLD.entitlement_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_transition';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'awaiting_transfer'
             AND NEW.status IN ('transfer_reported', 'expired', 'cancelled', 'needs_info', 'confirmed'))
        OR (OLD.status = 'transfer_reported' AND NEW.status IN ('cancelled', 'needs_info', 'confirmed'))
        OR (OLD.status = 'needs_info' AND NEW.status IN ('transfer_reported', 'cancelled', 'confirmed'))
        OR (OLD.status = 'expired' AND NEW.status = 'confirmed')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_transition';
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_enrollment_orders_transition
    BEFORE UPDATE OR DELETE ON public.enrollment_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_enrollment_orders_transition();
CREATE OR REPLACE TRIGGER trg_enrollment_orders_no_truncate
    BEFORE TRUNCATE ON public.enrollment_orders
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_enrollment_orders_transition();
CREATE OR REPLACE TRIGGER trg_enrollment_orders_updated_at
    BEFORE UPDATE ON public.enrollment_orders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── enrollment_order_events (append-only) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enrollment_order_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES public.enrollment_orders(id) ON DELETE RESTRICT,
    from_status text,
    to_status text NOT NULL,
    action text NOT NULL,
    actor_id uuid,
    actor_kind text NOT NULL CONSTRAINT enrollment_order_events_actor_kind_check
        CHECK (actor_kind IN ('learner', 'admin', 'system')),
    note text CONSTRAINT enrollment_order_events_note_check
        CHECK (note IS NULL OR char_length(note) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_enrollment_order_events_order
    ON public.enrollment_order_events (order_id, created_at);
CREATE OR REPLACE TRIGGER trg_enrollment_order_events_append_only
    BEFORE UPDATE OR DELETE ON public.enrollment_order_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_course_commerce_append_only();
CREATE OR REPLACE TRIGGER trg_enrollment_order_events_no_truncate
    BEFORE TRUNCATE ON public.enrollment_order_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_course_commerce_append_only();

-- ── learner_email_outbox: the only learner email table ──────────────────────
-- A user_id row stores no address (users.email is read at send time). Only
-- course_open_alert goes to a bare address, for people who may have no account.
CREATE TABLE IF NOT EXISTS public.learner_email_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
    to_email text CONSTRAINT learner_email_outbox_to_email_check
        CHECK (to_email IS NULL OR char_length(to_email) <= 254),
    template text NOT NULL CONSTRAINT learner_email_outbox_template_check
        CHECK (template IN ('order_created', 'order_pay_reminder', 'order_needs_info',
                            'order_confirmed', 'course_open_alert', 'result_ready_digest',
                            'course_expiring', 'course_expired', 'staff_notice')),
    dedupe_key text NOT NULL UNIQUE,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CONSTRAINT learner_email_outbox_status_check
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts integer NOT NULL DEFAULT 0 CONSTRAINT learner_email_outbox_attempts_check
        CHECK (attempts BETWEEN 0 AND 5),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT learner_email_outbox_one_recipient CHECK ((user_id IS NOT NULL) <> (to_email IS NOT NULL)),
    CONSTRAINT learner_email_outbox_address_template
        CHECK ((template = 'course_open_alert') = (to_email IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_learner_email_outbox_pending
    ON public.learner_email_outbox (status, next_attempt_at) WHERE status = 'pending';

-- ── Privileges: backend (service_role) only ─────────────────────────────────
-- No client policy: learners read through backend routes filtered by token.
-- Entitlements, orders and their events are written only by the owner-run
-- triggers here and the SECURITY DEFINER RPCs of M2.
ALTER TABLE public.course_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_products, public.entitlements, public.entitlement_events,
              public.enrollment_orders, public.enrollment_order_events, public.learner_email_outbox
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.course_products TO service_role;
GRANT SELECT ON public.entitlements, public.entitlement_events,
                public.enrollment_orders, public.enrollment_order_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.learner_email_outbox TO service_role;
DO $sequences$
DECLARE
    v_seq text;
BEGIN
    FOREACH v_seq IN ARRAY ARRAY[
        pg_get_serial_sequence('public.entitlement_events', 'id'),
        pg_get_serial_sequence('public.enrollment_order_events', 'id')
    ] LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
    END LOOP;
END;
$sequences$;

-- Trigger functions are never called directly (mig 356 pattern): no role,
-- service_role included, gets EXECUTE.
REVOKE ALL ON FUNCTION public.fn_entitlements_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_course_commerce_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_access_codes_product_kind() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_access_code_entitlement_revoke(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_access_code_entitlement_sync() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_code_assignment_entitlement_revoke()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_enrollment_orders_transition() FROM PUBLIC, anon, authenticated, service_role;

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_table regclass;
    v_routine regprocedure;
    v_role text;
    v_privilege text;
    v_expected text[];
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'public.course_products'::regclass, 'public.entitlements'::regclass,
        'public.entitlement_events'::regclass, 'public.enrollment_orders'::regclass,
        'public.enrollment_order_events'::regclass, 'public.learner_email_outbox'::regclass
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_table AND relrowsecurity) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '383 RLS disabled on ' || v_table::text;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_table) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '383 unexpected policy on ' || v_table::text;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                    WHERE c.oid = v_table AND a.grantee = 0) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '383 PUBLIC privilege on ' || v_table::text;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                               'REFERENCES', 'TRIGGER'] LOOP
                IF has_table_privilege(v_role, v_table, v_privilege) THEN
                    RAISE EXCEPTION USING ERRCODE = '55000',
                        MESSAGE = format('383 %s has %s on %s', v_role, v_privilege, v_table);
                END IF;
            END LOOP;
        END LOOP;
        v_expected := CASE WHEN v_table IN ('public.course_products'::regclass,
                                            'public.learner_email_outbox'::regclass)
                           THEN ARRAY['SELECT', 'INSERT', 'UPDATE'] ELSE ARRAY['SELECT'] END;
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                           'REFERENCES', 'TRIGGER'] LOOP
            IF has_table_privilege('service_role', v_table, v_privilege)
               IS DISTINCT FROM (v_privilege = ANY (v_expected)) THEN
                RAISE EXCEPTION USING ERRCODE = '55000',
                    MESSAGE = format('383 service_role %s on %s is wrong', v_privilege, v_table);
            END IF;
        END LOOP;
    END LOOP;

    FOREACH v_routine IN ARRAY ARRAY[
        'public.fn_entitlements_guard()'::regprocedure,
        'public.fn_course_commerce_append_only()'::regprocedure,
        'public.fn_access_codes_product_kind()'::regprocedure,
        'public.fn_access_code_entitlement_revoke(uuid,uuid,text)'::regprocedure,
        'public.fn_access_code_entitlement_sync()'::regprocedure,
        'public.fn_code_assignment_entitlement_revoke()'::regprocedure,
        'public.fn_enrollment_orders_transition()'::regprocedure
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_routine AND prosecdef
                          AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = '383 function configuration invalid: ' || v_routine::text;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_proc p
                     CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE p.oid = v_routine AND a.grantee = 0)
           OR has_function_privilege('anon', v_routine, 'EXECUTE')
           OR has_function_privilege('authenticated', v_routine, 'EXECUTE')
           OR has_function_privilege('service_role', v_routine, 'EXECUTE') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '383 function ACL invalid: ' || v_routine::text;
        END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.access_codes'::regclass
                      AND tgname = 'trg_access_codes_entitlement_sync' AND tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger
                       WHERE tgrelid = 'public.user_code_assignments'::regclass
                         AND tgname = 'trg_code_assignment_entitlement_revoke' AND tgenabled = 'O') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '383 access-code entitlement triggers missing';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
