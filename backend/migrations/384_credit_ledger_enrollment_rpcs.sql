-- COURSEACCESS-0055 T002 (G04-T02), migration M2 "credit ledger and RPCs".
-- The spec calls this file "382"; that number is only a working label. 381/382
-- are reserved for FU-2281, so register.tsv assigns 384 (approval-decision.md).
--
-- Purpose: the AI-credit ledger, credit reservations, Speaking cluster members,
-- writing_essays.review_mode and every RPC of plan.md 5.3 (credits, enrollment
-- orders, admin entitlement actions, product archive, instant Writing delivery).
-- No seed, no backfill, no change to any existing row. Nothing calls these RPCs
-- yet: the backend wiring is G04-T03 onward, behind flags that stay off.
--
-- Forward: pending_feature course_commerce. No apply on merge. Applied in the
-- same run as 383 (M1), after it, on staging first under the advisory-locked
-- runner after SA review and Andy's typed approval; production only at an
-- authorised staging-to-main promotion. Depends on 383 (course_products,
-- entitlements, enrollment_orders, outbox) and on the existing users (332
-- suspension marker), sessions, students and writing_essays tables.
-- Re-runnable; one transaction; postcondition block at the end.
-- Rollback: deploy the preceding backend, then rollback/384_credit_ledger_enrollment_rpcs.sql
-- (drops the RPCs, keeps every table and row).
--
-- Locking (plan.md 5.3, tasks.md T002):
--   * transaction-scoped advisory locks only (Supabase pooler runs in
--     transaction mode): pg_advisory_xact_lock(hashtextextended('aver.credit:' || user_id, 0));
--   * order confirm locks the order row first, then the user's advisory lock;
--     reservations take only the advisory lock;
--   * users is never locked FOR UPDATE (332/341 triggers): suspended_at is read
--     plainly and the activation UPDATE carries WHERE suspended_at IS NULL;
--   * a product is read FOR SHARE before an entitlement or order is created on
--     it, so a concurrent change of its kind or course waits (383 kind lock).
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

-- ── credit_reservations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    entitlement_id uuid NOT NULL REFERENCES public.entitlements(id) ON DELETE RESTRICT,
    feature text NOT NULL CONSTRAINT credit_reservations_feature_check
        CHECK (feature IN ('speaking_grading', 'writing_grading', 'short_writing_feedback')),
    cost integer NOT NULL CONSTRAINT credit_reservations_cost_check CHECK (cost BETWEEN 1 AND 20),
    request_key text NOT NULL CONSTRAINT credit_reservations_request_key_check
        CHECK (char_length(request_key) BETWEEN 8 AND 120),
    status text NOT NULL DEFAULT 'open' CONSTRAINT credit_reservations_status_check
        CHECK (status IN ('open', 'committed', 'released', 'expired')),
    resource_type text CONSTRAINT credit_reservations_resource_type_check
        CHECK (resource_type IS NULL OR resource_type IN
               ('speaking_response', 'speaking_cluster', 'writing_essay', 'short_writing')),
    resource_id text CONSTRAINT credit_reservations_resource_id_check
        CHECK (resource_id IS NULL OR char_length(resource_id) <= 80),
    expires_at timestamptz NOT NULL,
    settled_at timestamptz,
    release_reason text CONSTRAINT credit_reservations_release_reason_check
        CHECK (release_reason IS NULL OR release_reason IN
               ('grader_failed', 'stt_failed', 'request_failed', 'budget_refused', 'expired', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_reservations_settled CHECK ((status = 'open') = (settled_at IS NULL)),
    CONSTRAINT credit_reservations_release_reason_status
        CHECK ((status IN ('released', 'expired')) = (release_reason IS NOT NULL)),
    CONSTRAINT credit_reservations_request_key UNIQUE (user_id, feature, request_key)
);
CREATE INDEX IF NOT EXISTS ix_credit_reservations_open_expiry
    ON public.credit_reservations (status, expires_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_credit_reservations_open_resource
    ON public.credit_reservations (resource_type, resource_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_credit_reservations_open_entitlement
    ON public.credit_reservations (entitlement_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_reservations_live_cluster
    ON public.credit_reservations (user_id, resource_id)
    WHERE resource_type = 'speaking_cluster' AND status IN ('open', 'committed');

-- Only open -> committed | released | expired, with settled_at (and the
-- release reason); every other column is immutable and rows are never deleted.
CREATE OR REPLACE FUNCTION public.fn_credit_reservations_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'credit_reservation_append_only';
    END IF;
    IF (NEW.id, NEW.user_id, NEW.entitlement_id, NEW.feature, NEW.cost, NEW.request_key,
        NEW.resource_type, NEW.resource_id, NEW.expires_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.entitlement_id, OLD.feature, OLD.cost, OLD.request_key,
        OLD.resource_type, OLD.resource_id, OLD.expires_at, OLD.created_at)
       OR OLD.status <> 'open'
       OR NEW.status NOT IN ('committed', 'released', 'expired') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'credit_reservation_immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_credit_reservations_guard
    BEFORE UPDATE OR DELETE ON public.credit_reservations
    FOR EACH ROW EXECUTE FUNCTION public.fn_credit_reservations_guard();
CREATE OR REPLACE TRIGGER trg_credit_reservations_no_truncate
    BEFORE TRUNCATE ON public.credit_reservations
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_credit_reservations_guard();

-- ── credit_ledger (append-only, FR-011) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_ledger (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    entitlement_id uuid NOT NULL REFERENCES public.entitlements(id) ON DELETE RESTRICT,
    credit_kind text NOT NULL DEFAULT 'ai_grading' CONSTRAINT credit_ledger_credit_kind_check
        CHECK (credit_kind IN ('ai_grading')),
    delta integer NOT NULL,
    reason text NOT NULL CONSTRAINT credit_ledger_reason_check
        CHECK (reason IN ('grant', 'grant_extra', 'carry_over', 'carry_expire', 'reserve', 'release',
                          'admin_adjust', 'expire')),
    reservation_id uuid REFERENCES public.credit_reservations(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE CONSTRAINT credit_ledger_idempotency_key_check
        CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
    feature text CONSTRAINT credit_ledger_feature_check
        CHECK (feature IS NULL OR feature IN ('speaking_grading', 'writing_grading', 'short_writing_feedback')),
    resource_type text,
    resource_id text,
    actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    note text CONSTRAINT credit_ledger_note_check CHECK (note IS NULL OR char_length(note) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- The 100000 bound applies to each grant, reservation, release or
    -- adjustment; the three lifecycle rows carry an accumulated balance.
    CONSTRAINT credit_ledger_delta_check
        CHECK (delta <> 0 AND (reason IN ('expire', 'carry_over', 'carry_expire') OR abs(delta) <= 100000)),
    CONSTRAINT credit_ledger_delta_sign
        CHECK ((reason IN ('grant', 'grant_extra', 'carry_over', 'release') AND delta > 0)
               OR (reason IN ('reserve', 'expire', 'carry_expire') AND delta < 0)
               OR reason = 'admin_adjust'),
    CONSTRAINT credit_ledger_reservation_rows
        CHECK ((reason IN ('reserve', 'release')) = (reservation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_user_created
    ON public.credit_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_entitlement
    ON public.credit_ledger (entitlement_id);
CREATE OR REPLACE TRIGGER trg_credit_ledger_append_only
    BEFORE UPDATE OR DELETE ON public.credit_ledger
    FOR EACH ROW EXECUTE FUNCTION public.fn_course_commerce_append_only();
CREATE OR REPLACE TRIGGER trg_credit_ledger_no_truncate
    BEFORE TRUNCATE ON public.credit_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_course_commerce_append_only();

-- ── credit_cluster_members (N-1) ────────────────────────────────────────────
-- A question's place in a Speaking cluster is fixed once assigned: rows are
-- deleted only with their session (or at account deletion), never on release.
CREATE TABLE IF NOT EXISTS public.credit_cluster_members (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    part smallint NOT NULL CONSTRAINT credit_cluster_members_part_check CHECK (part IN (1, 2, 3)),
    -- No FK: a question may be edited or deleted after grading.
    question_id uuid NOT NULL,
    cluster_k integer NOT NULL CONSTRAINT credit_cluster_members_cluster_k_check CHECK (cluster_k >= 0),
    reservation_id uuid REFERENCES public.credit_reservations(id) ON DELETE RESTRICT,
    regrade_count smallint NOT NULL DEFAULT 0
        CONSTRAINT credit_cluster_members_regrade_count_check CHECK (regrade_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_cluster_members_question_key UNIQUE (session_id, part, question_id)
);
CREATE INDEX IF NOT EXISTS ix_credit_cluster_members_session_part
    ON public.credit_cluster_members (session_id, part);
CREATE INDEX IF NOT EXISTS ix_credit_cluster_members_reservation
    ON public.credit_cluster_members (reservation_id) WHERE reservation_id IS NOT NULL;

-- Only reservation_id and a growing regrade_count may change.
CREATE OR REPLACE FUNCTION public.fn_credit_cluster_members_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF (NEW.id, NEW.user_id, NEW.session_id, NEW.part, NEW.question_id, NEW.cluster_k, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.session_id, OLD.part, OLD.question_id, OLD.cluster_k, OLD.created_at)
       OR NEW.regrade_count < OLD.regrade_count THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'credit_cluster_member_immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_credit_cluster_members_guard
    BEFORE UPDATE ON public.credit_cluster_members
    FOR EACH ROW EXECUTE FUNCTION public.fn_credit_cluster_members_guard();

-- ── credit_covered_requests: replay record of a "covered" answer (FR-014) ──
-- A covered Speaking answer writes no reservation, so its request key is kept
-- here; a replay of that key returns the same answer without touching
-- regrade_count again.
CREATE TABLE IF NOT EXISTS public.credit_covered_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    feature text NOT NULL CONSTRAINT credit_covered_requests_feature_check
        CHECK (feature IN ('speaking_grading', 'writing_grading', 'short_writing_feedback')),
    request_key text NOT NULL CONSTRAINT credit_covered_requests_request_key_check
        CHECK (char_length(request_key) BETWEEN 8 AND 120),
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    reservation_id uuid NOT NULL REFERENCES public.credit_reservations(id) ON DELETE RESTRICT,
    cluster_k integer NOT NULL,
    regrade_count smallint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_covered_requests_request_key UNIQUE (user_id, feature, request_key)
);
CREATE OR REPLACE TRIGGER trg_credit_covered_requests_append_only
    BEFORE UPDATE OR DELETE ON public.credit_covered_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_course_commerce_append_only();
CREATE OR REPLACE TRIGGER trg_credit_covered_requests_no_truncate
    BEFORE TRUNCATE ON public.credit_covered_requests
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_course_commerce_append_only();

-- ── writing_essays.review_mode ──────────────────────────────────────────────
-- NULL = the existing flow (class assignments, admin review).
ALTER TABLE public.writing_essays ADD COLUMN IF NOT EXISTS review_mode text;
ALTER TABLE public.writing_essays DROP CONSTRAINT IF EXISTS writing_essays_review_mode_check;
ALTER TABLE public.writing_essays ADD CONSTRAINT writing_essays_review_mode_check
    CHECK (review_mode IS NULL OR review_mode IN ('ai_instant', 'teacher_review'));

-- ── enrollment_orders.entitlement_id belongs to the order (CR/SA R1 F4) ─────
CREATE OR REPLACE FUNCTION public.fn_enrollment_order_entitlement_match()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.entitlement_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.entitlements
         WHERE id = NEW.entitlement_id AND user_id = NEW.user_id AND product_id = NEW.product_id
           AND source = 'enrollment_order' AND source_ref = NEW.id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'enrollment_order_entitlement_mismatch';
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_enrollment_order_entitlement_match
    BEFORE INSERT OR UPDATE OF entitlement_id, user_id, product_id ON public.enrollment_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_enrollment_order_entitlement_match();

-- ── Internal helpers (service_role only, plan 5.3) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_credit_lock_user(p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT pg_advisory_xact_lock(hashtextextended('aver.credit:' || p_user_id::text, 0));
$$;

-- "Usable for credits": active, started, inside its access and credit windows,
-- credit book still open.
CREATE OR REPLACE FUNCTION public.fn_entitlement_credit_usable(p_entitlement public.entitlements)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p_entitlement.status = 'active'
       AND p_entitlement.starts_at <= now()
       AND (p_entitlement.expires_at IS NULL OR p_entitlement.expires_at > now())
       AND (p_entitlement.credits_expire_at IS NULL OR p_entitlement.credits_expire_at > now())
       AND p_entitlement.credits_closed_at IS NULL;
$$;

-- Usable balance of one entitlement (plan 5.3): carried-over credits are spent
-- first; a carry past its hold date that the 385 job has not booked yet is
-- reported as carry_lapsed and left out of the balance. The single home of
-- this formula; 385 calls it instead of copying it.
-- One refinement of the plan's formula: only reservations made before
-- carry_expires_at can spend the carry. Uses after the hold date come from the
-- new term, so they never shrink carry_lapsed (otherwise a learner could keep
-- spending a lapsed carry until the job runs; tasks.md T002 9b, 5th hold).
CREATE OR REPLACE FUNCTION public.fn_credit_usable_balance(p_entitlement_id uuid)
RETURNS TABLE (balance integer, carry_left integer, carry_lapsed integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ent public.entitlements%ROWTYPE;
    v_sum integer;
    v_carry integer;
    v_used_before integer;
    v_used_after integer;
    v_left integer;
    v_lapsed_now boolean;
BEGIN
    SELECT * INTO v_ent FROM public.entitlements WHERE id = p_entitlement_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 0, 0;
        RETURN;
    END IF;
    v_lapsed_now := v_ent.carry_expires_at IS NOT NULL AND v_ent.carry_expires_at <= now()
                    AND v_ent.carry_closed_at IS NULL;
    SELECT coalesce(sum(l.delta), 0)::integer,
           coalesce(sum(l.delta) FILTER (WHERE l.reason = 'carry_over'), 0)::integer,
           (-coalesce(sum(l.delta) FILTER (
                WHERE l.reason IN ('reserve', 'release')
                  AND (NOT v_lapsed_now OR r.created_at < v_ent.carry_expires_at)), 0))::integer,
           (-coalesce(sum(l.delta) FILTER (
                WHERE l.reason IN ('reserve', 'release')
                  AND v_lapsed_now AND r.created_at >= v_ent.carry_expires_at), 0))::integer
      INTO v_sum, v_carry, v_used_before, v_used_after
      FROM public.credit_ledger l
      LEFT JOIN public.credit_reservations r ON r.id = l.reservation_id
     WHERE l.entitlement_id = p_entitlement_id;
    -- v_sum + v_used_after is the balance as it stood before any post-lapse use.
    v_left := greatest(0, least(v_carry - v_used_before, v_sum + v_used_after));
    IF v_ent.carry_closed_at IS NOT NULL THEN
        v_left := 0;
    END IF;
    IF v_lapsed_now THEN
        RETURN QUERY SELECT v_sum - v_left, 0, v_left;
    ELSE
        RETURN QUERY SELECT v_sum, v_left, 0;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_feature_skill(p_feature text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE p_feature
               WHEN 'speaking_grading' THEN 'speaking'
               WHEN 'writing_grading' THEN 'writing'
               WHEN 'short_writing_feedback' THEN 'writing'
           END;
$$;

-- N-2: the resource must belong to the caller. Unknown shapes are not theirs.
CREATE OR REPLACE FUNCTION public.fn_credit_resource_owned(p_user_id uuid, p_resource_type text, p_resource_id text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c_uuid constant text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
    v_owned boolean;
BEGIN
    IF p_resource_id IS NULL THEN
        RETURN false;
    END IF;
    IF p_resource_type = 'speaking_response' THEN
        IF p_resource_id !~ ('^' || c_uuid || ':' || c_uuid || '(:r[0-9]{1,3})?$') THEN
            RETURN false;
        END IF;
        RETURN EXISTS (SELECT 1 FROM public.sessions
                        WHERE id = split_part(p_resource_id, ':', 1)::uuid AND user_id = p_user_id);
    ELSIF p_resource_type = 'speaking_cluster' THEN
        IF p_resource_id !~ ('^' || c_uuid || ':p[123]:q' || c_uuid || '$') THEN
            RETURN false;
        END IF;
        RETURN EXISTS (SELECT 1 FROM public.sessions
                        WHERE id = split_part(p_resource_id, ':', 1)::uuid AND user_id = p_user_id);
    ELSIF p_resource_type = 'writing_essay' THEN
        IF p_resource_id !~ ('^' || c_uuid || '$') THEN
            RETURN false;
        END IF;
        RETURN EXISTS (SELECT 1 FROM public.writing_essays e
                         JOIN public.students s ON s.id = e.student_id
                        WHERE e.id = p_resource_id::uuid AND s.user_id = p_user_id
                          AND e.deleted_at IS NULL);
    ELSIF p_resource_type = 'short_writing' THEN
        -- short_writing_submissions belongs to TOPICKNOW-0097 (a later file).
        IF p_resource_id !~ ('^' || c_uuid || '$')
           OR to_regclass('public.short_writing_submissions') IS NULL THEN
            RETURN false;
        END IF;
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.short_writing_submissions
                                 WHERE id = $1::uuid AND user_id = $2)'
           INTO v_owned USING p_resource_id, p_user_id;
        RETURN coalesce(v_owned, false);
    END IF;
    RETURN false;
END;
$$;

-- Ledger release of one open reservation (shared by release and expire).
CREATE OR REPLACE FUNCTION public.fn_credit_settle_release(
    p_reservation public.credit_reservations, p_status text, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE public.credit_reservations
       SET status = p_status, settled_at = statement_timestamp(), release_reason = p_reason
     WHERE id = p_reservation.id;
    INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, reservation_id,
                                      idempotency_key, feature, resource_type, resource_id)
    VALUES (p_reservation.user_id, p_reservation.entitlement_id, p_reservation.cost, 'release',
            p_reservation.id, 'res:' || p_reservation.id::text || ':release', p_reservation.feature,
            p_reservation.resource_type, p_reservation.resource_id);
    -- The cluster keeps its members; only the link to the released hold goes.
    UPDATE public.credit_cluster_members SET reservation_id = NULL
     WHERE reservation_id = p_reservation.id;
END;
$$;

-- ── Credit RPCs ─────────────────────────────────────────────────────────────
-- p_cluster_size and p_free_regrades are the backend constants
-- CREDIT_SPEAKING_CLUSTER_SIZE and CREDIT_CLUSTER_FREE_REGRADES (plan 5.6).
CREATE OR REPLACE FUNCTION public.fn_credit_reserve(
    p_user_id uuid, p_feature text, p_cost integer, p_request_key text,
    p_resource_type text, p_resource_id text, p_ttl_seconds integer,
    p_course_ids uuid[] DEFAULT NULL, p_kinds text[] DEFAULT NULL,
    p_cluster_size integer DEFAULT 3, p_free_regrades integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_existing public.credit_reservations%ROWTYPE;
    v_covered public.credit_covered_requests%ROWTYPE;
    v_member public.credit_cluster_members%ROWTYPE;
    v_session uuid;
    v_part smallint;
    v_question uuid;
    v_cover uuid;
    v_skill text := public.fn_credit_feature_skill(p_feature);
    v_candidates uuid[];
    v_pick record;
    v_total integer := 0;
    v_res uuid;
BEGIN
    IF v_skill IS NULL OR p_cost IS NULL OR p_cost NOT BETWEEN 1 AND 20
       OR p_request_key IS NULL OR char_length(p_request_key) NOT BETWEEN 8 AND 120
       OR p_resource_type IS NULL
       OR p_resource_type NOT IN ('speaking_response', 'speaking_cluster', 'writing_essay', 'short_writing')
       OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 60 AND 86400
       OR p_cluster_size IS NULL OR p_cluster_size NOT BETWEEN 1 AND 20
       OR p_free_regrades IS NULL OR p_free_regrades NOT BETWEEN 0 AND 10 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_reserve_invalid_argument';
    END IF;
    PERFORM public.fn_credit_lock_user(p_user_id);

    SELECT * INTO v_existing FROM public.credit_reservations
     WHERE user_id = p_user_id AND feature = p_feature AND request_key = p_request_key;
    IF FOUND THEN
        IF (v_existing.resource_type, v_existing.resource_id)
           IS DISTINCT FROM (p_resource_type, p_resource_id)
           OR v_existing.status IN ('released', 'expired') THEN
            RETURN jsonb_build_object('status', 'request_key_conflict', 'reservation_id', v_existing.id);
        ELSIF v_existing.status = 'committed' THEN
            RETURN jsonb_build_object('status', 'already_committed', 'reservation_id', v_existing.id);
        END IF;
        RETURN jsonb_build_object('status', 'replay', 'reservation_id', v_existing.id);
    END IF;
    SELECT * INTO v_covered FROM public.credit_covered_requests
     WHERE user_id = p_user_id AND feature = p_feature AND request_key = p_request_key;
    IF FOUND THEN
        IF (v_covered.resource_type, v_covered.resource_id) IS DISTINCT FROM (p_resource_type, p_resource_id) THEN
            RETURN jsonb_build_object('status', 'request_key_conflict', 'reservation_id', v_covered.reservation_id);
        END IF;
        RETURN jsonb_build_object('status', 'covered', 'replay', true, 'reservation_id', v_covered.reservation_id,
                                  'cluster_k', v_covered.cluster_k, 'regrade_count', v_covered.regrade_count);
    END IF;

    -- (1) owner, before anything is written.
    IF NOT public.fn_credit_resource_owned(p_user_id, p_resource_type, p_resource_id) THEN
        RETURN jsonb_build_object('status', 'not_owner');
    END IF;

    -- (2) applicable entitlements, balance not yet considered.
    SELECT array_agg(e.id) INTO v_candidates
      FROM public.entitlements e
      JOIN public.course_products p ON p.id = e.product_id
     WHERE e.user_id = p_user_id
       AND public.fn_entitlement_credit_usable(e)
       AND v_skill = ANY (p.features)
       AND (p_course_ids IS NULL OR e.course_id = ANY (p_course_ids))
       AND (p_kinds IS NULL OR p.kind = ANY (p_kinds));
    IF v_candidates IS NULL THEN
        RETURN jsonb_build_object('status', 'no_entitlement');
    END IF;

    -- (3) Speaking cluster: place the question, then look for a live hold.
    IF p_resource_type = 'speaking_cluster' THEN
        v_session := split_part(p_resource_id, ':', 1)::uuid;
        v_part := substr(split_part(p_resource_id, ':', 2), 2)::smallint;
        v_question := substr(split_part(p_resource_id, ':', 3), 2)::uuid;
        SELECT * INTO v_member FROM public.credit_cluster_members
         WHERE session_id = v_session AND part = v_part AND question_id = v_question;
        IF NOT FOUND THEN
            INSERT INTO public.credit_cluster_members (user_id, session_id, part, question_id, cluster_k)
            VALUES (p_user_id, v_session, v_part, v_question,
                    (SELECT count(*) FROM public.credit_cluster_members
                      WHERE session_id = v_session AND part = v_part) / p_cluster_size)
            RETURNING * INTO v_member;
        END IF;
        -- FOR SHARE: a concurrent release or expiry of the covering hold
        -- (FOR UPDATE on that row) either finishes first, and then the hold
        -- no longer qualifies on re-check, or waits until this answer is
        -- recorded. Lock order is the same everywhere: user lock, then
        -- reservation row; release and expiry take only the row lock.
        FOR i IN 1..3 LOOP
            SELECT r.id INTO v_cover
              FROM public.credit_reservations r
             WHERE r.id IN (SELECT m.reservation_id FROM public.credit_cluster_members m
                             WHERE m.session_id = v_session AND m.part = v_part
                               AND m.cluster_k = v_member.cluster_k AND m.reservation_id IS NOT NULL)
               AND r.status IN ('open', 'committed')
             ORDER BY r.created_at
             LIMIT 1
               FOR SHARE;
            EXIT WHEN v_cover IS NOT NULL
                   OR NOT EXISTS (SELECT 1 FROM public.credit_cluster_members m
                                    JOIN public.credit_reservations r ON r.id = m.reservation_id
                                   WHERE m.session_id = v_session AND m.part = v_part
                                     AND m.cluster_k = v_member.cluster_k
                                     AND r.status IN ('open', 'committed'));
        END LOOP;
        -- The question's own link may have been cleared by that release.
        SELECT * INTO v_member FROM public.credit_cluster_members WHERE id = v_member.id;
        IF v_cover IS NOT NULL THEN
            IF v_member.reservation_id IS NOT NULL THEN
                -- The question was already graded under this cluster (N-3).
                IF v_member.regrade_count >= p_free_regrades THEN
                    RETURN jsonb_build_object('status', 'regrade_limit', 'reservation_id', v_cover,
                                              'cluster_k', v_member.cluster_k,
                                              'regrade_count', v_member.regrade_count);
                END IF;
                UPDATE public.credit_cluster_members
                   SET regrade_count = regrade_count + 1, reservation_id = v_cover
                 WHERE id = v_member.id
                RETURNING * INTO v_member;
            ELSE
                UPDATE public.credit_cluster_members SET reservation_id = v_cover WHERE id = v_member.id
                RETURNING * INTO v_member;
            END IF;
            INSERT INTO public.credit_covered_requests (user_id, feature, request_key, resource_type, resource_id,
                                                        reservation_id, cluster_k, regrade_count)
            VALUES (p_user_id, p_feature, p_request_key, p_resource_type, p_resource_id, v_cover,
                    v_member.cluster_k, v_member.regrade_count);
            RETURN jsonb_build_object('status', 'covered', 'reservation_id', v_cover,
                                      'cluster_k', v_member.cluster_k,
                                      'regrade_count', v_member.regrade_count);
        END IF;
    END IF;

    -- (4) the entitlement whose credits lapse first and that can pay.
    SELECT e.id, e.course_id, p.kind, b.balance INTO v_pick
      FROM public.entitlements e
      JOIN public.course_products p ON p.id = e.product_id
      CROSS JOIN LATERAL public.fn_credit_usable_balance(e.id) b
     WHERE e.id = ANY (v_candidates) AND b.balance >= p_cost
     ORDER BY coalesce(least(e.credits_expire_at, e.expires_at), e.credits_expire_at, e.expires_at)
              ASC NULLS LAST, e.starts_at, e.created_at, e.id
     LIMIT 1;
    IF NOT FOUND THEN
        SELECT coalesce(sum(b.balance), 0)::integer INTO v_total
          FROM unnest(v_candidates) AS c(id)
          CROSS JOIN LATERAL public.fn_credit_usable_balance(c.id) b;
        RETURN jsonb_build_object('status', 'insufficient_credits', 'balance', v_total);
    END IF;

    INSERT INTO public.credit_reservations (user_id, entitlement_id, feature, cost, request_key,
                                            resource_type, resource_id, expires_at)
    VALUES (p_user_id, v_pick.id, p_feature, p_cost, p_request_key, p_resource_type, p_resource_id,
            statement_timestamp() + make_interval(secs => p_ttl_seconds))
    RETURNING id INTO v_res;
    INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, reservation_id,
                                      idempotency_key, feature, resource_type, resource_id)
    VALUES (p_user_id, v_pick.id, -p_cost, 'reserve', v_res, 'res:' || v_res::text || ':reserve',
            p_feature, p_resource_type, p_resource_id);
    IF p_resource_type = 'speaking_cluster' THEN
        UPDATE public.credit_cluster_members SET reservation_id = v_res WHERE id = v_member.id;
    END IF;
    RETURN jsonb_build_object('status', 'reserved', 'reservation_id', v_res, 'entitlement_id', v_pick.id,
                              'product_kind', v_pick.kind, 'balance_after', v_pick.balance - p_cost,
                              'cluster_k', CASE WHEN p_resource_type = 'speaking_cluster'
                                                THEN v_member.cluster_k END);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_commit(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res public.credit_reservations%ROWTYPE;
BEGIN
    SELECT * INTO v_res FROM public.credit_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    ELSIF v_res.status = 'committed' THEN
        RETURN jsonb_build_object('status', 'already_committed', 'reservation_id', v_res.id);
    ELSIF v_res.status <> 'open' THEN
        RETURN jsonb_build_object('status', 'not_open', 'reservation_id', v_res.id, 'reservation_status', v_res.status);
    END IF;
    UPDATE public.credit_reservations SET status = 'committed', settled_at = statement_timestamp()
     WHERE id = v_res.id;
    RETURN jsonb_build_object('status', 'committed', 'reservation_id', v_res.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_release(p_reservation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res public.credit_reservations%ROWTYPE;
BEGIN
    IF p_reason IS NULL OR p_reason NOT IN ('grader_failed', 'stt_failed', 'request_failed',
                                            'budget_refused', 'admin') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_release_invalid_reason';
    END IF;
    SELECT * INTO v_res FROM public.credit_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    ELSIF v_res.status = 'released' THEN
        RETURN jsonb_build_object('status', 'already_released', 'reservation_id', v_res.id);
    ELSIF v_res.status <> 'open' THEN
        RETURN jsonb_build_object('status', 'not_open', 'reservation_id', v_res.id, 'reservation_status', v_res.status);
    END IF;
    PERFORM public.fn_credit_settle_release(v_res, 'released', p_reason);
    RETURN jsonb_build_object('status', 'released', 'reservation_id', v_res.id);
END;
$$;

-- Background Writing: settle by resource. 'none' when nothing is open.
CREATE OR REPLACE FUNCTION public.fn_credit_commit_for_resource(
    p_resource_type text, p_resource_id text, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM public.credit_reservations
     WHERE resource_type = p_resource_type AND resource_id = p_resource_id AND status = 'open'
     ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('status', 'none');
    END IF;
    RETURN public.fn_credit_commit(v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_release_for_resource(
    p_resource_type text, p_resource_id text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM public.credit_reservations
     WHERE resource_type = p_resource_type AND resource_id = p_resource_id AND status = 'open'
     ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('status', 'none');
    END IF;
    RETURN public.fn_credit_release(v_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_expire_reservations(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res public.credit_reservations%ROWTYPE;
    v_count integer := 0;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_expire_invalid_limit';
    END IF;
    FOR v_res IN
        SELECT * FROM public.credit_reservations
         WHERE status = 'open' AND expires_at < now()
         ORDER BY expires_at
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.fn_credit_settle_release(v_res, 'expired', 'expired');
        v_count := v_count + 1;
    END LOOP;
    RETURN jsonb_build_object('expired', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_balance(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_items jsonb;
    v_total integer;
BEGIN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'entitlement_id', e.id, 'course_id', e.course_id, 'product_id', e.product_id,
               'product_kind', p.kind, 'balance', b.balance, 'usable_from', e.starts_at,
               'usable_until', CASE WHEN e.credits_expire_at IS NULL THEN e.expires_at
                                    WHEN e.expires_at IS NULL THEN e.credits_expire_at
                                    ELSE least(e.credits_expire_at, e.expires_at) END,
               'carry_balance', b.carry_left,
               'carry_expires_at', CASE WHEN b.carry_left > 0 THEN e.carry_expires_at END)
               ORDER BY coalesce(least(e.credits_expire_at, e.expires_at), e.credits_expire_at, e.expires_at)
                        NULLS LAST, e.starts_at, e.id), '[]'::jsonb),
           coalesce(sum(b.balance) FILTER (WHERE public.fn_entitlement_credit_usable(e)), 0)::integer
      INTO v_items, v_total
      FROM public.entitlements e
      JOIN public.course_products p ON p.id = e.product_id
      CROSS JOIN LATERAL public.fn_credit_usable_balance(e.id) b
     WHERE e.user_id = p_user_id AND e.status = 'active'
       AND (e.expires_at IS NULL OR e.expires_at > now())
       AND (e.credits_expire_at IS NULL OR e.credits_expire_at > now())
       AND e.credits_closed_at IS NULL;
    RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

-- p_reason goes only to the note; the reason column is always the literal
-- 'admin_adjust' (SA-2335-R7-C2).
CREATE OR REPLACE FUNCTION public.fn_credit_admin_adjust(
    p_admin_id uuid, p_entitlement_id uuid, p_delta integer, p_reason text, p_request_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ent public.entitlements%ROWTYPE;
    v_balance integer;
    v_key text;
    v_id bigint;
BEGIN
    IF p_admin_id IS NULL OR p_delta IS NULL OR p_delta = 0
       OR p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 10 AND 500
       OR p_request_key IS NULL OR char_length(p_request_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_adjust_invalid_argument';
    END IF;
    v_key := 'admin:' || p_request_key;
    SELECT * INTO v_ent FROM public.entitlements WHERE id = p_entitlement_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    PERFORM public.fn_credit_lock_user(v_ent.user_id);
    SELECT id INTO v_id FROM public.credit_ledger WHERE idempotency_key = v_key;
    IF FOUND THEN
        RETURN jsonb_build_object('status', 'replay', 'ledger_id', v_id);
    END IF;
    IF NOT public.fn_entitlement_credit_usable(v_ent) THEN
        RETURN jsonb_build_object('status', 'not_usable');
    END IF;
    SELECT b.balance INTO v_balance FROM public.fn_credit_usable_balance(v_ent.id) b;
    IF v_balance + p_delta < 0 THEN
        RETURN jsonb_build_object('status', 'would_go_negative', 'balance', v_balance);
    END IF;
    INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, actor_id, note)
    VALUES (v_ent.user_id, v_ent.id, p_delta, 'admin_adjust', v_key, p_admin_id, p_reason)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('status', 'adjusted', 'ledger_id', v_id, 'balance_after', v_balance + p_delta);
END;
$$;

-- ── Enrollment order RPCs ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_enrollment_order_event(
    p_order public.enrollment_orders, p_from text, p_action text, p_actor_id uuid, p_actor_kind text,
    p_note text
) RETURNS bigint
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    INSERT INTO public.enrollment_order_events (order_id, from_status, to_status, action, actor_id,
                                                actor_kind, note)
    VALUES (p_order.id, p_from, p_order.status, p_action, p_actor_id, p_actor_kind, p_note)
    RETURNING id;
$$;

CREATE OR REPLACE FUNCTION public.fn_enrollment_order_create(
    p_user_id uuid, p_product_id uuid, p_order_code text, p_request_key text, p_pay_hours integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order public.enrollment_orders%ROWTYPE;
    v_product public.course_products%ROWTYPE;
    v_suspended timestamptz;
BEGIN
    IF p_user_id IS NULL OR p_product_id IS NULL OR p_order_code IS NULL OR p_request_key IS NULL
       OR p_pay_hours IS NULL OR p_pay_hours NOT BETWEEN 1 AND 720 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_create_invalid_argument';
    END IF;
    PERFORM public.fn_credit_lock_user(p_user_id);
    SELECT * INTO v_order FROM public.enrollment_orders
     WHERE user_id = p_user_id AND request_key = p_request_key;
    IF FOUND THEN
        IF v_order.product_id <> p_product_id THEN
            RETURN jsonb_build_object('status', 'request_key_conflict');
        END IF;
        RETURN jsonb_build_object('status', 'replay', 'order', to_jsonb(v_order));
    END IF;
    SELECT suspended_at INTO v_suspended FROM public.users WHERE id = p_user_id;
    IF NOT FOUND OR v_suspended IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'account_suspended');
    END IF;
    SELECT * INTO v_product FROM public.course_products WHERE id = p_product_id FOR SHARE;
    IF NOT FOUND OR v_product.kind <> 'online' OR v_product.status <> 'open' OR NOT v_product.is_public
       OR v_product.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'product_unavailable');
    END IF;
    SELECT * INTO v_order FROM public.enrollment_orders
     WHERE user_id = p_user_id AND product_id = p_product_id
       AND status IN ('awaiting_transfer', 'transfer_reported', 'needs_info');
    IF FOUND THEN
        RETURN jsonb_build_object('status', 'existing_open', 'order', to_jsonb(v_order));
    END IF;
    BEGIN
        INSERT INTO public.enrollment_orders (order_code, user_id, product_id, tuition_vnd, access_days,
                                              ai_credits, credit_valid_days, product_title, request_key,
                                              pay_by)
        VALUES (p_order_code, p_user_id, p_product_id, v_product.tuition_vnd, v_product.access_days,
                v_product.ai_credits, v_product.credit_valid_days, v_product.title, p_request_key,
                statement_timestamp() + make_interval(hours => p_pay_hours))
        RETURNING * INTO v_order;
    EXCEPTION WHEN unique_violation THEN
        -- The user lock rules out the other unique keys; the code is global.
        RETURN jsonb_build_object('status', 'code_collision');
    END;
    PERFORM public.fn_enrollment_order_event(v_order, NULL, 'create', p_user_id, 'learner', NULL);
    INSERT INTO public.learner_email_outbox (user_id, template, dedupe_key, payload)
    VALUES (p_user_id, 'order_created', 'order:' || v_order.id::text || ':created',
            jsonb_build_object('order_id', v_order.id, 'order_code', v_order.order_code,
                               'product_title', v_order.product_title, 'tuition_vnd', v_order.tuition_vnd,
                               'pay_by', v_order.pay_by));
    RETURN jsonb_build_object('status', 'created', 'order', to_jsonb(v_order));
END;
$$;

-- Learner actions write events only, never the outbox. Someone else's order is
-- not_found, so its existence is not revealed.
CREATE OR REPLACE FUNCTION public.fn_enrollment_order_learner_action(
    p_user_id uuid, p_order_code text, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order public.enrollment_orders%ROWTYPE;
    v_from text;
    v_late boolean := false;
BEGIN
    IF p_action IS NULL OR p_action NOT IN ('report_transfer', 'cancel', 'supplement')
       OR (p_note IS NOT NULL AND char_length(p_note) > 1000)
       OR (p_action = 'supplement' AND (p_note IS NULL OR char_length(p_note) < 3)) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_learner_action_invalid_argument';
    END IF;
    SELECT * INTO v_order FROM public.enrollment_orders
     WHERE order_code = p_order_code AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_from := v_order.status;
    IF p_action = 'report_transfer' AND v_order.status = 'awaiting_transfer' THEN
        UPDATE public.enrollment_orders
           SET status = 'transfer_reported', transfer_reported_at = statement_timestamp(),
               learner_note = coalesce(p_note, learner_note)
         WHERE id = v_order.id RETURNING * INTO v_order;
    ELSIF p_action = 'report_transfer' AND v_order.status = 'expired' THEN
        UPDATE public.enrollment_orders
           SET late_transfer_reported_at = statement_timestamp(), learner_note = coalesce(p_note, learner_note)
         WHERE id = v_order.id RETURNING * INTO v_order;
        v_late := true;
    ELSIF p_action = 'cancel' AND v_order.status IN ('awaiting_transfer', 'transfer_reported', 'needs_info') THEN
        UPDATE public.enrollment_orders
           SET status = 'cancelled', cancelled_at = statement_timestamp(), cancelled_by = p_user_id,
               cancel_reason = left(p_note, 500)
         WHERE id = v_order.id RETURNING * INTO v_order;
    ELSIF p_action = 'supplement' AND v_order.status = 'needs_info' THEN
        UPDATE public.enrollment_orders
           SET status = 'transfer_reported', transfer_reported_at = statement_timestamp(), learner_note = p_note
         WHERE id = v_order.id RETURNING * INTO v_order;
    ELSE
        RETURN jsonb_build_object('status', 'invalid_transition', 'order_status', v_order.status);
    END IF;
    PERFORM public.fn_enrollment_order_event(v_order, v_from, p_action, p_user_id, 'learner', p_note);
    RETURN jsonb_build_object('status', 'ok', 'late', v_late, 'order', to_jsonb(v_order));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enrollment_order_admin_action(
    p_admin_id uuid, p_order_id uuid, p_action text, p_reason text, p_message text,
    p_supplement_by timestamptz DEFAULT NULL, p_received_vnd integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order public.enrollment_orders%ROWTYPE;
    v_from text;
    v_event bigint;
BEGIN
    IF p_admin_id IS NULL OR p_action IS NULL OR p_action NOT IN ('request_info', 'cancel') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_admin_action_invalid_argument';
    END IF;
    IF p_action = 'request_info'
       AND (p_reason IS NULL OR p_reason NOT IN ('underpaid', 'not_found', 'other')
            OR p_message IS NULL OR char_length(p_message) NOT BETWEEN 3 AND 1000
            OR p_supplement_by IS NULL OR p_supplement_by <= now()
            OR (p_received_vnd IS NOT NULL AND p_received_vnd < 0)
            OR (p_reason = 'underpaid' AND p_received_vnd IS NULL)) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_admin_action_invalid_argument';
    END IF;
    IF p_action = 'cancel' AND (p_message IS NULL OR char_length(p_message) NOT BETWEEN 3 AND 500) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_admin_action_invalid_argument';
    END IF;
    SELECT * INTO v_order FROM public.enrollment_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_order.status NOT IN ('awaiting_transfer', 'transfer_reported', 'needs_info') THEN
        RETURN jsonb_build_object('status', 'invalid_transition', 'order_status', v_order.status);
    END IF;
    IF p_action = 'request_info' AND p_reason = 'underpaid' AND p_received_vnd >= v_order.tuition_vnd THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_admin_action_invalid_argument';
    END IF;
    v_from := v_order.status;
    IF p_action = 'request_info' THEN
        UPDATE public.enrollment_orders
           SET status = 'needs_info', info_kind = p_reason, admin_message = p_message,
               supplement_by = p_supplement_by, received_vnd = coalesce(p_received_vnd, received_vnd)
         WHERE id = v_order.id RETURNING * INTO v_order;
        v_event := public.fn_enrollment_order_event(v_order, v_from, 'request_info', p_admin_id, 'admin', p_reason);
        -- Each marking sends its own letter (5.5): the event id keeps them apart.
        INSERT INTO public.learner_email_outbox (user_id, template, dedupe_key, payload)
        VALUES (v_order.user_id, 'order_needs_info',
                'order:' || v_order.id::text || ':needs_info:' || v_event::text,
                jsonb_build_object('order_id', v_order.id, 'order_code', v_order.order_code,
                                   'product_title', v_order.product_title, 'info_kind', p_reason,
                                   'admin_message', p_message, 'supplement_by', p_supplement_by,
                                   'tuition_vnd', v_order.tuition_vnd, 'received_vnd', v_order.received_vnd));
    ELSE
        UPDATE public.enrollment_orders
           SET status = 'cancelled', cancelled_at = statement_timestamp(), cancelled_by = p_admin_id,
               cancel_reason = p_message
         WHERE id = v_order.id RETURNING * INTO v_order;
        PERFORM public.fn_enrollment_order_event(v_order, v_from, 'cancel', p_admin_id, 'admin', p_message);
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'order', to_jsonb(v_order));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enrollment_order_confirm_result(
    p_status text, p_ent public.entitlements, p_reopened boolean
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT jsonb_build_object(
        'status', p_status, 'entitlement_id', p_ent.id, 'starts_at', p_ent.starts_at,
        'expires_at', p_ent.expires_at, 'credits_expire_at', p_ent.credits_expire_at,
        'credits_granted', coalesce((SELECT l.delta FROM public.credit_ledger l
                                      WHERE l.idempotency_key = 'order:' || p_ent.source_ref::text || ':grant'), 0),
        'reopened', p_reopened, 'renews_entitlement_id', p_ent.renews_entitlement_id);
$$;

CREATE OR REPLACE FUNCTION public.fn_enrollment_order_confirm(
    p_admin_id uuid, p_order_id uuid, p_note text, p_allow_expired boolean,
    p_carry_window_days integer, p_received_vnd integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order public.enrollment_orders%ROWTYPE;
    v_product public.course_products%ROWTYPE;
    v_ent public.entitlements%ROWTYPE;
    v_from text;
    v_suspended timestamptz;
    v_active boolean;
    v_reopened boolean := false;
    v_starts timestamptz;
    v_expires timestamptz;
    v_renews uuid;
BEGIN
    IF p_admin_id IS NULL OR p_carry_window_days IS NULL OR p_carry_window_days NOT BETWEEN 0 AND 3650
       OR (p_received_vnd IS NOT NULL AND p_received_vnd < 0)
       OR (p_note IS NOT NULL AND char_length(p_note) > 500) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_confirm_invalid_argument';
    END IF;
    -- Lock order: the order row, then the user's advisory lock.
    SELECT * INTO v_order FROM public.enrollment_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    PERFORM public.fn_credit_lock_user(v_order.user_id);
    IF v_order.status = 'confirmed' THEN
        SELECT * INTO STRICT v_ent FROM public.entitlements WHERE id = v_order.entitlement_id;
        RETURN public.fn_enrollment_order_confirm_result('already_confirmed', v_ent,
                                                         v_order.reopened_at IS NOT NULL);
    END IF;
    IF v_order.status = 'cancelled' OR (v_order.status = 'expired' AND NOT coalesce(p_allow_expired, false)) THEN
        RETURN jsonb_build_object('status', 'invalid_transition', 'order_status', v_order.status);
    END IF;
    IF v_order.status = 'expired' THEN
        IF EXISTS (SELECT 1 FROM public.enrollment_orders
                    WHERE user_id = v_order.user_id AND product_id = v_order.product_id AND id <> v_order.id
                      AND status IN ('awaiting_transfer', 'transfer_reported', 'needs_info')) THEN
            RETURN jsonb_build_object('status', 'has_open_order');
        END IF;
        v_reopened := true;
    END IF;
    IF p_received_vnd IS NOT NULL AND p_received_vnd > v_order.tuition_vnd AND p_note IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_confirm_overpaid_needs_note';
    END IF;
    -- Read the suspension marker before any UPDATE (332 raises otherwise).
    SELECT suspended_at, is_active INTO v_suspended, v_active FROM public.users WHERE id = v_order.user_id;
    IF v_suspended IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'account_suspended');
    END IF;
    SELECT * INTO STRICT v_product FROM public.course_products WHERE id = v_order.product_id FOR SHARE;

    -- A renewal starts where the learner's current access to the course ends.
    SELECT greatest(statement_timestamp(), max(e.expires_at)) INTO v_starts
      FROM public.entitlements e
     WHERE e.user_id = v_order.user_id AND e.course_id = v_product.course_id AND e.status = 'active';
    v_starts := coalesce(v_starts, statement_timestamp());
    v_expires := v_starts + make_interval(days => v_order.access_days);
    -- Linked for carry-over only when the order was created inside the
    -- re-enrol window of the previous term of the same product.
    SELECT e.id INTO v_renews
      FROM public.entitlements e
     WHERE e.user_id = v_order.user_id AND e.product_id = v_order.product_id AND e.status = 'active'
       AND e.expires_at IS NOT NULL
     ORDER BY e.expires_at DESC
     LIMIT 1;
    IF v_renews IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
         WHERE e.id = v_renews
           AND v_order.created_at <= e.expires_at + make_interval(days => p_carry_window_days)) THEN
        v_renews := NULL;
    END IF;

    INSERT INTO public.entitlements (user_id, product_id, course_id, source, source_ref, starts_at, expires_at,
                                     credits_expire_at, renews_entitlement_id, granted_by, reason)
    VALUES (v_order.user_id, v_order.product_id, v_product.course_id, 'enrollment_order', v_order.id,
            v_starts, v_expires,
            CASE WHEN v_order.credit_valid_days IS NULL THEN NULL
                 ELSE least(v_expires, v_starts + make_interval(days => v_order.credit_valid_days)) END,
            v_renews, p_admin_id, p_note)
    RETURNING * INTO v_ent;
    IF v_order.ai_credits > 0 THEN
        INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, actor_id)
        VALUES (v_order.user_id, v_ent.id, v_order.ai_credits, 'grant', 'order:' || v_order.id::text || ':grant',
                p_admin_id);
    END IF;
    INSERT INTO public.entitlement_events (entitlement_id, action, actor_id, actor_kind, after, reason)
    VALUES (v_ent.id, 'grant', p_admin_id, 'admin',
            jsonb_build_object('source', 'enrollment_order', 'order_id', v_order.id, 'starts_at', v_starts,
                               'expires_at', v_expires, 'credits', v_order.ai_credits),
            p_note);
    -- Activate a deactivated (never suspended) learner; no UPDATE when active.
    IF NOT coalesce(v_active, true) THEN
        UPDATE public.users SET is_active = true
         WHERE id = v_order.user_id AND suspended_at IS NULL AND NOT is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'order_confirm_user_changed';
        END IF;
    END IF;

    v_from := v_order.status;
    UPDATE public.enrollment_orders
       SET status = 'confirmed', confirmed_at = statement_timestamp(), confirmed_by = p_admin_id,
           entitlement_id = v_ent.id, received_vnd = coalesce(p_received_vnd, received_vnd),
           reopened_at = CASE WHEN v_reopened THEN statement_timestamp() ELSE reopened_at END
     WHERE id = v_order.id RETURNING * INTO v_order;
    PERFORM public.fn_enrollment_order_event(v_order, v_from, 'confirm', p_admin_id, 'admin', p_note);
    INSERT INTO public.learner_email_outbox (user_id, template, dedupe_key, payload)
    VALUES (v_order.user_id, 'order_confirmed', 'order:' || v_order.id::text || ':confirmed',
            jsonb_build_object('order_id', v_order.id, 'order_code', v_order.order_code,
                               'product_title', v_order.product_title, 'starts_at', v_starts,
                               'expires_at', v_expires, 'ai_credits', v_order.ai_credits));
    RETURN public.fn_enrollment_order_confirm_result('confirmed', v_ent, v_reopened);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enrollment_orders_expire(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order public.enrollment_orders%ROWTYPE;
    v_count integer := 0;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_expire_invalid_limit';
    END IF;
    FOR v_order IN
        SELECT * FROM public.enrollment_orders
         WHERE status = 'awaiting_transfer' AND pay_by < now()
         ORDER BY pay_by
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.enrollment_orders SET status = 'expired', expired_at = statement_timestamp()
         WHERE id = v_order.id RETURNING * INTO v_order;
        PERFORM public.fn_enrollment_order_event(v_order, 'awaiting_transfer', 'expire', NULL, 'system', NULL);
        v_count := v_count + 1;
    END LOOP;
    RETURN jsonb_build_object('expired', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enrollment_order_pay_reminders(
    p_hours_before integer, p_min_age_hours integer, p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_order public.enrollment_orders%ROWTYPE;
    v_count integer := 0;
    v_inserted integer;
BEGIN
    IF p_hours_before IS NULL OR p_hours_before NOT BETWEEN 1 AND 720
       OR p_min_age_hours IS NULL OR p_min_age_hours NOT BETWEEN 0 AND 720
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_reminder_invalid_argument';
    END IF;
    FOR v_order IN
        SELECT * FROM public.enrollment_orders
         WHERE status = 'awaiting_transfer' AND pay_by > now()
           AND pay_by - now() <= make_interval(hours => p_hours_before)
           AND now() - created_at >= make_interval(hours => p_min_age_hours)
         ORDER BY pay_by
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    LOOP
        INSERT INTO public.learner_email_outbox (user_id, template, dedupe_key, payload)
        VALUES (v_order.user_id, 'order_pay_reminder', 'order:' || v_order.id::text || ':pay_reminder',
                jsonb_build_object('order_id', v_order.id, 'order_code', v_order.order_code,
                                   'product_title', v_order.product_title, 'tuition_vnd', v_order.tuition_vnd,
                                   'pay_by', v_order.pay_by))
        ON CONFLICT (dedupe_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_count := v_count + v_inserted;
    END LOOP;
    RETURN jsonb_build_object('queued', v_count);
END;
$$;

-- ── Admin entitlement RPCs ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_entitlement_admin_grant(
    p_admin_id uuid, p_user_id uuid, p_product_id uuid, p_days integer, p_credits integer,
    p_review_mode text, p_reason text, p_request_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_product public.course_products%ROWTYPE;
    v_ent public.entitlements%ROWTYPE;
    v_days integer;
    v_credits integer;
BEGIN
    IF p_admin_id IS NULL OR p_user_id IS NULL OR p_request_key IS NULL
       OR (p_days IS NOT NULL AND p_days NOT BETWEEN 1 AND 3650)
       OR (p_credits IS NOT NULL AND p_credits NOT BETWEEN 0 AND 100000)
       OR (p_review_mode IS NOT NULL AND p_review_mode NOT IN ('ai_instant', 'teacher_review'))
       OR p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'entitlement_grant_invalid_argument';
    END IF;
    PERFORM public.fn_credit_lock_user(p_user_id);
    SELECT * INTO v_ent FROM public.entitlements
     WHERE source = 'admin_grant' AND source_ref = p_request_key AND user_id = p_user_id;
    IF FOUND THEN
        RETURN jsonb_build_object('status', 'replay', 'entitlement_id', v_ent.id);
    END IF;
    SELECT * INTO v_product FROM public.course_products WHERE id = p_product_id FOR SHARE;
    IF NOT FOUND OR v_product.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'product_invalid');
    END IF;
    v_days := coalesce(p_days, v_product.access_days);
    v_credits := coalesce(p_credits, v_product.ai_credits);
    INSERT INTO public.entitlements (user_id, product_id, course_id, source, source_ref, starts_at, expires_at,
                                     credits_expire_at, review_mode, granted_by, reason)
    VALUES (p_user_id, v_product.id, v_product.course_id, 'admin_grant', p_request_key, statement_timestamp(),
            CASE WHEN v_days IS NULL THEN NULL
                 ELSE statement_timestamp() + make_interval(days => v_days) END,
            CASE WHEN v_product.credit_valid_days IS NULL THEN NULL
                 WHEN v_days IS NULL THEN statement_timestamp() + make_interval(days => v_product.credit_valid_days)
                 ELSE statement_timestamp() + make_interval(days => least(v_days, v_product.credit_valid_days)) END,
            p_review_mode, p_admin_id, p_reason)
    RETURNING * INTO v_ent;
    IF v_credits > 0 THEN
        INSERT INTO public.credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key, actor_id)
        VALUES (p_user_id, v_ent.id, v_credits, 'grant', 'admin_grant:' || p_request_key::text, p_admin_id);
    END IF;
    INSERT INTO public.entitlement_events (entitlement_id, action, actor_id, actor_kind, after, reason)
    VALUES (v_ent.id, 'grant', p_admin_id, 'admin',
            jsonb_build_object('source', 'admin_grant', 'access_days', v_days, 'credits', v_credits,
                               'review_mode', p_review_mode),
            p_reason);
    RETURN jsonb_build_object('status', 'granted', 'entitlement_id', v_ent.id, 'starts_at', v_ent.starts_at,
                              'expires_at', v_ent.expires_at, 'credits_granted', v_credits);
END;
$$;

-- The remaining balance becomes unusable at once; the 385 close job books the
-- negative row later, and revoked credits never carry over.
CREATE OR REPLACE FUNCTION public.fn_entitlement_admin_revoke(
    p_admin_id uuid, p_entitlement_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ent public.entitlements%ROWTYPE;
BEGIN
    IF p_admin_id IS NULL OR p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'entitlement_revoke_invalid_argument';
    END IF;
    SELECT * INTO v_ent FROM public.entitlements WHERE id = p_entitlement_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    ELSIF v_ent.status = 'revoked' THEN
        RETURN jsonb_build_object('status', 'already_revoked', 'entitlement_id', v_ent.id);
    END IF;
    UPDATE public.entitlements
       SET status = 'revoked', revoked_at = statement_timestamp(), revoked_by = p_admin_id, revoke_reason = p_reason
     WHERE id = v_ent.id RETURNING * INTO v_ent;
    INSERT INTO public.entitlement_events (entitlement_id, action, actor_id, actor_kind, before, after, reason)
    VALUES (v_ent.id, 'revoke', p_admin_id, 'admin', jsonb_build_object('status', 'active'),
            jsonb_build_object('status', 'revoked', 'revoked_at', v_ent.revoked_at), p_reason);
    RETURN jsonb_build_object('status', 'revoked', 'entitlement_id', v_ent.id);
END;
$$;

-- Extending the course never extends the carry hold (carry_expires_at).
CREATE OR REPLACE FUNCTION public.fn_entitlement_admin_extend(
    p_admin_id uuid, p_entitlement_id uuid, p_days integer, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ent public.entitlements%ROWTYPE;
    v_before jsonb;
BEGIN
    IF p_admin_id IS NULL OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 3650
       OR p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'entitlement_extend_invalid_argument';
    END IF;
    SELECT * INTO v_ent FROM public.entitlements WHERE id = p_entitlement_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    ELSIF v_ent.status = 'revoked' THEN
        RETURN jsonb_build_object('status', 'revoked', 'entitlement_id', v_ent.id);
    ELSIF v_ent.expires_at IS NULL THEN
        RETURN jsonb_build_object('status', 'no_expiry', 'entitlement_id', v_ent.id);
    ELSIF v_ent.credits_closed_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'credits_closed', 'entitlement_id', v_ent.id);
    END IF;
    v_before := jsonb_build_object('expires_at', v_ent.expires_at, 'credits_expire_at', v_ent.credits_expire_at);
    UPDATE public.entitlements
       SET expires_at = greatest(expires_at, statement_timestamp()) + make_interval(days => p_days),
           credits_expire_at = credits_expire_at + make_interval(days => p_days)
     WHERE id = v_ent.id RETURNING * INTO v_ent;
    INSERT INTO public.entitlement_events (entitlement_id, action, actor_id, actor_kind, before, after, reason)
    VALUES (v_ent.id, 'extend', p_admin_id, 'admin', v_before,
            jsonb_build_object('expires_at', v_ent.expires_at, 'credits_expire_at', v_ent.credits_expire_at,
                               'days', p_days),
            p_reason);
    RETURN jsonb_build_object('status', 'extended', 'entitlement_id', v_ent.id, 'expires_at', v_ent.expires_at,
                              'credits_expire_at', v_ent.credits_expire_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_course_product_archive(p_admin_id uuid, p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_product public.course_products%ROWTYPE;
    v_count integer;
BEGIN
    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'product_archive_invalid_argument';
    END IF;
    SELECT * INTO v_product FROM public.course_products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    ELSIF v_product.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_archived');
    END IF;
    SELECT count(*) INTO v_count FROM public.entitlements
     WHERE product_id = p_product_id AND status = 'active' AND (expires_at IS NULL OR expires_at > now());
    IF v_count > 0 THEN
        RETURN jsonb_build_object('status', 'has_active_learners', 'n', v_count);
    END IF;
    SELECT count(*) INTO v_count FROM public.enrollment_orders
     WHERE product_id = p_product_id AND status IN ('awaiting_transfer', 'transfer_reported', 'needs_info');
    IF v_count > 0 THEN
        RETURN jsonb_build_object('status', 'has_open_orders', 'n', v_count);
    END IF;
    UPDATE public.course_products
       SET archived_at = statement_timestamp(), archived_by = p_admin_id, status = 'closed', is_public = false
     WHERE id = p_product_id;
    RETURN jsonb_build_object('status', 'archived');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_deliver_writing_essay_instant(p_essay_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_status text;
    v_mode text;
BEGIN
    UPDATE public.writing_essays
       SET status = 'delivered', delivered_at = now(), delivery_method = 'web_view'
     WHERE id = p_essay_id AND status = 'graded' AND review_mode = 'ai_instant' AND deleted_at IS NULL;
    IF FOUND THEN
        RETURN jsonb_build_object('status', 'delivered');
    END IF;
    SELECT status, review_mode INTO v_status, v_mode FROM public.writing_essays
     WHERE id = p_essay_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    ELSIF v_mode IS DISTINCT FROM 'ai_instant' THEN
        RETURN jsonb_build_object('status', 'not_instant');
    END IF;
    RETURN jsonb_build_object('status', 'not_graded', 'essay_status', v_status);
END;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- Tables: RLS on, no client policy, read-only for service_role; every write
-- goes through the SECURITY DEFINER RPCs below (and the 383 code trigger).
-- FORCE is not used: the RPCs run as the owner and must see the rows.
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_cluster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_covered_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_reservations, public.credit_ledger, public.credit_cluster_members,
              public.credit_covered_requests
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.credit_reservations, public.credit_ledger, public.credit_cluster_members,
                public.credit_covered_requests TO service_role;
DO $sequences$
DECLARE
    v_seq text;
BEGIN
    FOREACH v_seq IN ARRAY ARRAY[
        pg_get_serial_sequence('public.credit_ledger', 'id'),
        pg_get_serial_sequence('public.credit_cluster_members', 'id'),
        pg_get_serial_sequence('public.credit_covered_requests', 'id')
    ] LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
    END LOOP;
END;
$sequences$;

-- Trigger functions and internal helpers: no role gets EXECUTE.
REVOKE ALL ON FUNCTION public.fn_credit_reservations_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_credit_cluster_members_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_enrollment_order_entitlement_match() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_credit_lock_user(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_entitlement_credit_usable(public.entitlements)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_credit_feature_skill(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_credit_resource_owned(uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_credit_settle_release(public.credit_reservations, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_enrollment_order_event(public.enrollment_orders, text, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_enrollment_order_confirm_result(text, public.entitlements, boolean)
    FROM PUBLIC, anon, authenticated, service_role;

-- RPCs: service_role only (plan 5.3). fn_credit_usable_balance is internal
-- but plan 5.3 grants it to service_role (385 and diagnostics read it).
DO $rpcs$
DECLARE
    v_routine regprocedure;
BEGIN
    FOREACH v_routine IN ARRAY ARRAY[
        'public.fn_credit_usable_balance(uuid)'::regprocedure,
        'public.fn_credit_reserve(uuid,text,integer,text,text,text,integer,uuid[],text[],integer,integer)'::regprocedure,
        'public.fn_credit_commit(uuid)'::regprocedure,
        'public.fn_credit_release(uuid,text)'::regprocedure,
        'public.fn_credit_commit_for_resource(text,text,text)'::regprocedure,
        'public.fn_credit_release_for_resource(text,text,text)'::regprocedure,
        'public.fn_credit_expire_reservations(integer)'::regprocedure,
        'public.fn_credit_balance(uuid)'::regprocedure,
        'public.fn_credit_admin_adjust(uuid,uuid,integer,text,text)'::regprocedure,
        'public.fn_enrollment_order_create(uuid,uuid,text,text,integer)'::regprocedure,
        'public.fn_enrollment_order_learner_action(uuid,text,text,text)'::regprocedure,
        'public.fn_enrollment_order_admin_action(uuid,uuid,text,text,text,timestamptz,integer)'::regprocedure,
        'public.fn_enrollment_order_confirm(uuid,uuid,text,boolean,integer,integer)'::regprocedure,
        'public.fn_enrollment_orders_expire(integer)'::regprocedure,
        'public.fn_enrollment_order_pay_reminders(integer,integer,integer)'::regprocedure,
        'public.fn_entitlement_admin_grant(uuid,uuid,uuid,integer,integer,text,text,uuid)'::regprocedure,
        'public.fn_entitlement_admin_revoke(uuid,uuid,text)'::regprocedure,
        'public.fn_entitlement_admin_extend(uuid,uuid,integer,text)'::regprocedure,
        'public.fn_course_product_archive(uuid,uuid)'::regprocedure,
        'public.fn_deliver_writing_essay_instant(uuid)'::regprocedure
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_routine);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_routine);
    END LOOP;
END;
$rpcs$;

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_table regclass;
    v_routine regprocedure;
    v_role text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'public.credit_reservations'::regclass, 'public.credit_ledger'::regclass,
        'public.credit_cluster_members'::regclass, 'public.credit_covered_requests'::regclass
    ] LOOP
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: RLS off on ' || v_table;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_table) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: policy on ' || v_table;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_table_privilege(v_role, v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
                RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: ' || v_role || ' on ' || v_table;
            END IF;
        END LOOP;
        IF has_table_privilege('service_role', v_table, 'INSERT, UPDATE, DELETE, TRUNCATE')
           OR NOT has_table_privilege('service_role', v_table, 'SELECT') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: service_role on ' || v_table;
        END IF;
    END LOOP;
    FOREACH v_routine IN ARRAY ARRAY[
        'public.fn_credit_reservations_guard()'::regprocedure,
        'public.fn_credit_cluster_members_guard()'::regprocedure,
        'public.fn_enrollment_order_entitlement_match()'::regprocedure,
        'public.fn_credit_lock_user(uuid)'::regprocedure,
        'public.fn_entitlement_credit_usable(public.entitlements)'::regprocedure,
        'public.fn_credit_feature_skill(text)'::regprocedure,
        'public.fn_credit_resource_owned(uuid,text,text)'::regprocedure,
        'public.fn_credit_settle_release(public.credit_reservations,text,text)'::regprocedure,
        'public.fn_enrollment_order_event(public.enrollment_orders,text,text,uuid,text,text)'::regprocedure,
        'public.fn_enrollment_order_confirm_result(text,public.entitlements,boolean)'::regprocedure,
        'public.fn_credit_usable_balance(uuid)'::regprocedure,
        'public.fn_credit_reserve(uuid,text,integer,text,text,text,integer,uuid[],text[],integer,integer)'::regprocedure,
        'public.fn_credit_commit(uuid)'::regprocedure,
        'public.fn_credit_release(uuid,text)'::regprocedure,
        'public.fn_credit_commit_for_resource(text,text,text)'::regprocedure,
        'public.fn_credit_release_for_resource(text,text,text)'::regprocedure,
        'public.fn_credit_expire_reservations(integer)'::regprocedure,
        'public.fn_credit_balance(uuid)'::regprocedure,
        'public.fn_credit_admin_adjust(uuid,uuid,integer,text,text)'::regprocedure,
        'public.fn_enrollment_order_create(uuid,uuid,text,text,integer)'::regprocedure,
        'public.fn_enrollment_order_learner_action(uuid,text,text,text)'::regprocedure,
        'public.fn_enrollment_order_admin_action(uuid,uuid,text,text,text,timestamptz,integer)'::regprocedure,
        'public.fn_enrollment_order_confirm(uuid,uuid,text,boolean,integer,integer)'::regprocedure,
        'public.fn_enrollment_orders_expire(integer)'::regprocedure,
        'public.fn_enrollment_order_pay_reminders(integer,integer,integer)'::regprocedure,
        'public.fn_entitlement_admin_grant(uuid,uuid,uuid,integer,integer,text,text,uuid)'::regprocedure,
        'public.fn_entitlement_admin_revoke(uuid,uuid,text)'::regprocedure,
        'public.fn_entitlement_admin_extend(uuid,uuid,integer,text)'::regprocedure,
        'public.fn_course_product_archive(uuid,uuid)'::regprocedure,
        'public.fn_deliver_writing_essay_instant(uuid)'::regprocedure
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_routine AND prosecdef
                          AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: definer/search_path ' || v_routine;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE p.oid = v_routine AND a.grantee = 0)
           OR has_function_privilege('anon', v_routine, 'EXECUTE')
           OR has_function_privilege('authenticated', v_routine, 'EXECUTE') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: client EXECUTE ' || v_routine;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enrollment_order_entitlement_match'
                    AND tgrelid = 'public.enrollment_orders'::regclass)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_credit_ledger_append_only'
                       AND tgrelid = 'public.credit_ledger'::regclass) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '384 postcondition: triggers';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
