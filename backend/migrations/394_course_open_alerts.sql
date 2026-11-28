-- Migration: 394_course_open_alerts.sql
--
-- ENROLL-0060 T22 (G05-T22, plan 5.7, FR-060). "Báo cho tôi khi mở": a guest or
-- a signed-in learner leaves an email for a course that is not open yet; when
-- the course opens, the G04 sweep queues exactly one mail per email per course.
--
--   public.course_open_alerts           one row per (product, lower(email)).
--   public.course_open_alert_attempts   per hashed-IP counter (the form takes
--                                       bare addresses, so it must be rate limited
--                                       across every worker; 334 pattern).
--   fn_course_open_alert_attempt_check(rate_key, action) → jsonb
--                                       subscribe 3/hour, unsubscribe 20/hour; rows
--                                       older than a day are removed as calls arrive.
--   fn_course_open_alert_subscribe(slug, email, user_id) → text
--                                       ok | course_not_found | course_already_open.
--                                       Never returns the unsubscribe token.
--   fn_course_open_alert_unsubscribe(slug, token, user_id, email) → integer
--                                       by mail token OR by session; the token is
--                                       single use (replaced on unsubscribe).
--   fn_course_open_alerts_for_user(user_id, email) → text[]  (GET /api/me/open-alerts)
--   fn_course_open_alerts_enqueue(limit) → integer           (G04 sweep step)
--   fn_course_open_alerts_rekey(user_id, old_email, new_email) → integer (5.6b)
--   fn_course_open_alert_send_check(alert_id, to_email) → text (G04 dispatcher)
--
-- Tokens: two v4 UUIDs without dashes (pg_catalog.gen_random_uuid, built in
-- since PG13; 244 random bits, url-safe). Stored readable on purpose (plan 5.7):
-- the enqueue function must put it in the mail, and it can only unsubscribe one
-- row. Unsubscribing replaces it, so a link works once.
--
-- One mail per email per course: the unique index (product_id, lower(email)),
-- notified_at set once and never cleared, and the outbox dedupe_key
-- 'open_alert:' || id (unique in learner_email_outbox, mig 383).
--
-- Needs 383 (course_products, entitlements, learner_email_outbox with the
-- course_open_alert template). No seed, no backfill. Only service_role executes
-- the functions; clients get nothing.
--
-- ROLLBACK: backend/migrations/rollback/394_course_open_alerts.sql (functions
-- first, then the tables). Deploy the pre-T22 backend first; the T22 routes
-- answer 503 open_alerts_unavailable without these objects and the G04 sweep
-- step logs skipped=no_function.
--
-- Postcheck (read-only; every row must be t|t|f|f|t):
--   SELECT p.proname, p.prosecdef, p.proconfig = ARRAY['search_path=pg_catalog, pg_temp'],
--          has_function_privilege('anon', p.oid, 'EXECUTE'),
--          has_function_privilege('authenticated', p.oid, 'EXECUTE'),
--          has_function_privilege('service_role', p.oid, 'EXECUTE')
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'fn_course_open_alert%';

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- 0. Preconditions
DO $pre$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'service_role_missing';
    END IF;
    IF to_regclass('public.course_products') IS NULL OR to_regclass('public.entitlements') IS NULL
       OR to_regclass('public.learner_email_outbox') IS NULL THEN
        RAISE EXCEPTION 'migration_383_missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.learner_email_outbox'::regclass
           AND conname = 'learner_email_outbox_template_check'
           AND pg_get_constraintdef(oid) LIKE '%course_open_alert%') THEN
        RAISE EXCEPTION 'learner_email_outbox_template_missing_course_open_alert';
    END IF;
END;
$pre$;

-- 1. Subscriptions
CREATE TABLE IF NOT EXISTS public.course_open_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.course_products(id) ON DELETE CASCADE,
    email text NOT NULL CONSTRAINT course_open_alerts_email_check
        CHECK (char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    unsubscribe_token text NOT NULL UNIQUE CONSTRAINT course_open_alerts_token_check
        CHECK (unsubscribe_token ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    subscribed_at timestamptz NOT NULL DEFAULT now(),
    notified_at timestamptz,
    notify_result text CONSTRAINT course_open_alerts_notify_result_check
        CHECK (notify_result IS NULL OR notify_result IN ('queued', 'skipped_has_course')),
    unsubscribed_at timestamptz,
    CONSTRAINT course_open_alerts_notified_consistent
        CHECK ((notified_at IS NULL) = (notify_result IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_course_open_alerts_product_email
    ON public.course_open_alerts (product_id, lower(email));
CREATE INDEX IF NOT EXISTS ix_course_open_alerts_pending
    ON public.course_open_alerts (product_id) WHERE notified_at IS NULL AND unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_course_open_alerts_user
    ON public.course_open_alerts (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_course_open_alerts_email
    ON public.course_open_alerts (lower(email));

-- 2. Counter per account or hashed IP (one row per ALLOWED call; a refused call writes nothing)
CREATE TABLE IF NOT EXISTS public.course_open_alert_attempts (
    rate_key text NOT NULL CONSTRAINT course_open_alert_attempts_rate_key_check
        CHECK (char_length(rate_key) BETWEEN 1 AND 128),
    action text NOT NULL CONSTRAINT course_open_alert_attempts_action_check
        CHECK (action IN ('subscribe', 'unsubscribe')),
    attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_course_open_alert_attempts_key
    ON public.course_open_alert_attempts (rate_key, action, attempted_at);
CREATE INDEX IF NOT EXISTS ix_course_open_alert_attempts_attempted
    ON public.course_open_alert_attempts (attempted_at);

ALTER TABLE public.course_open_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_open_alert_attempts ENABLE ROW LEVEL SECURITY;
-- No policy. Writes go only through the functions below; service_role keeps
-- SELECT for support queries.
REVOKE ALL ON public.course_open_alerts, public.course_open_alert_attempts
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.course_open_alerts, public.course_open_alert_attempts TO service_role;

-- 3. Internal: a fresh unsubscribe token
CREATE OR REPLACE FUNCTION public.fn_course_open_alert_new_token()
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
        || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
$$;

-- Internal: the email has an active entitlement on this product (by user_id or
-- by an account with the same address).
CREATE OR REPLACE FUNCTION public.fn_course_open_alert_has_course(p_product_id uuid, p_user_id uuid, p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.entitlements e
         WHERE e.product_id = p_product_id
           AND e.status = 'active'
           AND e.starts_at <= pg_catalog.now()
           AND (e.expires_at IS NULL OR e.expires_at > pg_catalog.now())
           AND (e.user_id = p_user_id
                OR e.user_id IN (SELECT u.id FROM public.users u
                                  WHERE pg_catalog.lower(u.email) = pg_catalog.lower(p_email))))
$$;

-- 4. Rate limit (334 pattern: advisory lock per key, count, then record)
CREATE OR REPLACE FUNCTION public.fn_course_open_alert_attempt_check(p_rate_key text, p_action text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    c_window CONSTANT interval := interval '1 hour';
    c_keep   CONSTANT interval := interval '1 day';
    c_sweep  CONSTANT integer  := 200;
    v_max     integer;
    v_now     timestamptz;
    v_count   integer;
    v_free_at timestamptz;
BEGIN
    IF p_rate_key IS NULL OR p_rate_key = '' THEN
        RAISE EXCEPTION 'open_alert_rate_key_required' USING ERRCODE = '22004';
    END IF;
    v_max := CASE p_action WHEN 'subscribe' THEN 3 WHEN 'unsubscribe' THEN 20 END;
    IF v_max IS NULL THEN
        RAISE EXCEPTION 'open_alert_action_invalid' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'open_alert_attempt_check_requires_read_committed';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('open-alert-attempt:' || p_action || ':' || p_rate_key, 0));
    v_now := pg_catalog.clock_timestamp();

    DELETE FROM public.course_open_alert_attempts
     WHERE rate_key = p_rate_key AND action = p_action AND attempted_at < v_now - c_keep;
    -- Keys that never come back would stay forever: every call also removes
    -- up to c_sweep stale rows of any key (no cron needed; SKIP LOCKED so two
    -- calls never wait on each other here).
    DELETE FROM public.course_open_alert_attempts
     WHERE ctid IN (SELECT ctid FROM public.course_open_alert_attempts
                     WHERE attempted_at < v_now - c_keep
                     LIMIT c_sweep
                       FOR UPDATE SKIP LOCKED);

    SELECT count(*) INTO v_count
      FROM public.course_open_alert_attempts
     WHERE rate_key = p_rate_key AND action = p_action AND attempted_at > v_now - c_window;

    IF v_count >= v_max THEN
        SELECT attempted_at + c_window INTO v_free_at
          FROM public.course_open_alert_attempts
         WHERE rate_key = p_rate_key AND action = p_action AND attempted_at > v_now - c_window
         ORDER BY attempted_at
         OFFSET v_count - v_max LIMIT 1;
        RETURN pg_catalog.jsonb_build_object(
            'allowed', false,
            'retry_after_s', GREATEST(1, pg_catalog.ceil(
                EXTRACT(EPOCH FROM v_free_at - v_now))::integer));
    END IF;

    INSERT INTO public.course_open_alert_attempts (rate_key, action, attempted_at)
    VALUES (p_rate_key, p_action, v_now);
    RETURN pg_catalog.jsonb_build_object('allowed', true, 'retry_after_s', 0);
END $$;

-- 5. Subscribe (plan 5.7 write rules). The same 'ok' for every case so the
-- response never tells whether an address was already on the list.
CREATE OR REPLACE FUNCTION public.fn_course_open_alert_subscribe(p_slug text, p_email text, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_product public.course_products%ROWTYPE;
    v_email   text := pg_catalog.btrim(p_email);
BEGIN
    IF v_email IS NULL OR v_email = '' THEN
        RAISE EXCEPTION 'open_alert_email_required' USING ERRCODE = '22004';
    END IF;
    SELECT * INTO v_product FROM public.course_products
     WHERE slug = p_slug AND is_public AND archived_at IS NULL AND status <> 'draft';
    IF NOT FOUND THEN
        RETURN 'course_not_found';
    END IF;
    IF v_product.status = 'open' THEN
        RETURN 'course_already_open';
    END IF;

    INSERT INTO public.course_open_alerts AS a (product_id, email, user_id, unsubscribe_token)
    VALUES (v_product.id, v_email, p_user_id, public.fn_course_open_alert_new_token())
    ON CONFLICT (product_id, (pg_catalog.lower(email))) DO UPDATE
       SET user_id = COALESCE(a.user_id, EXCLUDED.user_id),
           -- Unsubscribed but never notified: subscribe again. Notified rows keep
           -- notified_at and unsubscribed_at (one mail per course, FR-060).
           subscribed_at = CASE WHEN a.unsubscribed_at IS NOT NULL AND a.notified_at IS NULL
                                THEN pg_catalog.now() ELSE a.subscribed_at END,
           unsubscribed_at = CASE WHEN a.notified_at IS NULL THEN NULL ELSE a.unsubscribed_at END;
    RETURN 'ok';
END $$;

-- 6. Unsubscribe: by the mail token (p_token) or by session (p_user_id + the
-- account email). Idempotent; an unknown token changes nothing. The token of
-- every matched row is replaced, so a mail link works once.
CREATE OR REPLACE FUNCTION public.fn_course_open_alert_unsubscribe(
    p_slug text, p_token text, p_user_id uuid, p_email text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_token IS NULL AND p_user_id IS NULL THEN
        RAISE EXCEPTION 'open_alert_unsubscribe_needs_token_or_user' USING ERRCODE = '22004';
    END IF;
    UPDATE public.course_open_alerts a
       SET unsubscribed_at = COALESCE(a.unsubscribed_at, pg_catalog.now()),
           unsubscribe_token = public.fn_course_open_alert_new_token()
      FROM public.course_products p
     WHERE p.id = a.product_id AND p.slug = p_slug
       AND CASE WHEN p_token IS NOT NULL THEN a.unsubscribe_token = p_token
                ELSE (a.user_id = p_user_id
                      OR (p_email IS NOT NULL AND pg_catalog.lower(a.email) = pg_catalog.lower(p_email)))
           END;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END $$;

-- 7. The caller's live subscriptions (slugs of public products).
CREATE OR REPLACE FUNCTION public.fn_course_open_alerts_for_user(p_user_id uuid, p_email text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT COALESCE(pg_catalog.array_agg(DISTINCT p.slug ORDER BY p.slug), ARRAY[]::text[])
      FROM public.course_open_alerts a
      JOIN public.course_products p ON p.id = a.product_id
     WHERE a.unsubscribed_at IS NULL
       AND p.is_public AND p.archived_at IS NULL
       AND (a.user_id = p_user_id
            OR (p_email IS NOT NULL AND pg_catalog.lower(a.email) = pg_catalog.lower(p_email)))
$$;

-- 8. Queue the mails of open products (called by the G04 sweep, limit 200).
CREATE OR REPLACE FUNCTION public.fn_course_open_alerts_enqueue(p_limit integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_row   record;
    v_count integer := 0;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
        RAISE EXCEPTION 'open_alert_limit_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_row IN
        SELECT a.id, a.email, a.user_id, a.product_id, a.unsubscribe_token, p.slug, p.title
          FROM public.course_open_alerts a
          JOIN public.course_products p ON p.id = a.product_id
         WHERE a.notified_at IS NULL AND a.unsubscribed_at IS NULL
           AND p.status = 'open' AND p.is_public AND p.archived_at IS NULL
         ORDER BY a.subscribed_at, a.id
         LIMIT p_limit
           FOR UPDATE OF a SKIP LOCKED
    LOOP
        IF public.fn_course_open_alert_has_course(v_row.product_id, v_row.user_id, v_row.email) THEN
            UPDATE public.course_open_alerts
               SET notified_at = pg_catalog.now(), notify_result = 'skipped_has_course'
             WHERE id = v_row.id;
        ELSE
            INSERT INTO public.learner_email_outbox (user_id, to_email, template, dedupe_key, payload)
            VALUES (NULL, v_row.email, 'course_open_alert', 'open_alert:' || v_row.id::text,
                    pg_catalog.jsonb_build_object(
                        'alert_id', v_row.id,
                        'product_slug', v_row.slug,
                        'product_title', v_row.title,
                        'unsubscribe_token', v_row.unsubscribe_token))
            ON CONFLICT (dedupe_key) DO NOTHING;
            UPDATE public.course_open_alerts
               SET notified_at = pg_catalog.now(), notify_result = 'queued'
             WHERE id = v_row.id;
        END IF;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END $$;

-- 9. Email change (5.6b): merge the person's rows per product onto the new
-- address. Unsubscribed wins, already-notified wins; idempotent (second run 0).
CREATE OR REPLACE FUNCTION public.fn_course_open_alerts_rekey(p_user_id uuid, p_old_email text, p_new_email text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_new      text := pg_catalog.btrim(p_new_email);
    v_product  uuid;
    v_ids      uuid[];
    v_keep     public.course_open_alerts%ROWTYPE;
    v_unsub    timestamptz;
    v_notified timestamptz;
    v_result   text;
    v_changed  integer := 0;
BEGIN
    IF p_user_id IS NULL OR v_new IS NULL OR v_new = '' THEN
        RAISE EXCEPTION 'open_alert_rekey_args_required' USING ERRCODE = '22004';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('open-alert-rekey:' || p_user_id::text, 0));

    -- The person's rows: linked to the account, or unlinked under either address.
    FOR v_product IN
        SELECT DISTINCT a.product_id FROM public.course_open_alerts a
         WHERE a.user_id = p_user_id
            OR (a.user_id IS NULL
                AND pg_catalog.lower(a.email) IN (pg_catalog.lower(p_old_email), pg_catalog.lower(v_new)))
         ORDER BY a.product_id
    LOOP
        SELECT pg_catalog.array_agg(g.id) INTO v_ids FROM (
            SELECT a.id FROM public.course_open_alerts a
             WHERE a.product_id = v_product
               AND (a.user_id = p_user_id
                    OR (a.user_id IS NULL
                        AND pg_catalog.lower(a.email) IN (pg_catalog.lower(p_old_email),
                                                          pg_catalog.lower(v_new))))
             ORDER BY a.id
               FOR UPDATE) g;
        CONTINUE WHEN v_ids IS NULL;  -- removed concurrently
        SELECT * INTO v_keep FROM public.course_open_alerts
         WHERE id = ANY (v_ids)
         ORDER BY (user_id IS NOT DISTINCT FROM p_user_id) DESC, created_at, id LIMIT 1;
        IF pg_catalog.cardinality(v_ids) = 1 AND v_keep.email = v_new AND v_keep.user_id = p_user_id THEN
            CONTINUE;  -- already merged
        END IF;
        SELECT min(unsubscribed_at) INTO v_unsub FROM public.course_open_alerts WHERE id = ANY (v_ids);
        v_notified := NULL;
        v_result := NULL;
        SELECT notified_at, notify_result INTO v_notified, v_result FROM public.course_open_alerts
         WHERE id = ANY (v_ids) AND notified_at IS NOT NULL ORDER BY notified_at, id LIMIT 1;

        -- Delete first: the kept row takes the new address under the unique index.
        DELETE FROM public.course_open_alerts WHERE id = ANY (v_ids) AND id <> v_keep.id;
        UPDATE public.course_open_alerts
           SET email = v_new, user_id = p_user_id,
               unsubscribed_at = v_unsub,
               notified_at = v_notified, notify_result = v_result
         WHERE id = v_keep.id;
        v_changed := v_changed + 1;
    END LOOP;
    RETURN v_changed;
END $$;

-- 10. Check again right before every send, retries included (FR-060).
CREATE OR REPLACE FUNCTION public.fn_course_open_alert_send_check(p_alert_id uuid, p_to_email text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_alert   public.course_open_alerts%ROWTYPE;
    v_product public.course_products%ROWTYPE;
BEGIN
    SELECT * INTO v_alert FROM public.course_open_alerts WHERE id = p_alert_id;
    IF NOT FOUND THEN
        RETURN 'skipped_missing';
    END IF;
    IF v_alert.unsubscribed_at IS NOT NULL THEN
        RETURN 'skipped_unsubscribed';
    END IF;
    IF p_to_email IS NULL OR pg_catalog.lower(v_alert.email) <> pg_catalog.lower(p_to_email) THEN
        RETURN 'skipped_email_changed';
    END IF;
    IF public.fn_course_open_alert_has_course(v_alert.product_id, v_alert.user_id, v_alert.email) THEN
        RETURN 'skipped_has_course';
    END IF;
    SELECT * INTO v_product FROM public.course_products WHERE id = v_alert.product_id;
    IF NOT FOUND OR v_product.status <> 'open' OR NOT v_product.is_public OR v_product.archived_at IS NOT NULL THEN
        RETURN 'skipped_closed';
    END IF;
    RETURN 'send';
END $$;

-- 11. Privileges: helpers for nobody, RPCs for service_role only.
REVOKE ALL ON FUNCTION public.fn_course_open_alert_new_token() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_course_open_alert_has_course(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_course_open_alert_attempt_check(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_course_open_alert_subscribe(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_course_open_alert_unsubscribe(text, text, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_course_open_alerts_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_course_open_alerts_enqueue(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_course_open_alerts_rekey(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_course_open_alert_send_check(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_course_open_alert_attempt_check(text, text),
                          public.fn_course_open_alert_subscribe(text, text, uuid),
                          public.fn_course_open_alert_unsubscribe(text, text, uuid, text),
                          public.fn_course_open_alerts_for_user(uuid, text),
                          public.fn_course_open_alerts_enqueue(integer),
                          public.fn_course_open_alerts_rekey(uuid, text, text),
                          public.fn_course_open_alert_send_check(uuid, text)
    TO service_role;

-- 12. Postcondition
DO $post$
DECLARE
    v_table regclass;
    v_fn    regprocedure;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['public.course_open_alerts'::regclass,
                                   'public.course_open_alert_attempts'::regclass] LOOP
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
            RAISE EXCEPTION 'rls_off: %', v_table;
        END IF;
        IF has_table_privilege('anon', v_table, 'SELECT') OR has_table_privilege('authenticated', v_table, 'SELECT')
           OR has_table_privilege('service_role', v_table, 'INSERT')
           OR has_table_privilege('service_role', v_table, 'UPDATE')
           OR has_table_privilege('service_role', v_table, 'DELETE') THEN
            RAISE EXCEPTION 'table_privilege_leak: %', v_table;
        END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY ARRAY[
        'public.fn_course_open_alert_attempt_check(text,text)'::regprocedure,
        'public.fn_course_open_alert_subscribe(text,text,uuid)'::regprocedure,
        'public.fn_course_open_alert_unsubscribe(text,text,uuid,text)'::regprocedure,
        'public.fn_course_open_alerts_for_user(uuid,text)'::regprocedure,
        'public.fn_course_open_alerts_enqueue(integer)'::regprocedure,
        'public.fn_course_open_alerts_rekey(uuid,text,text)'::regprocedure,
        'public.fn_course_open_alert_send_check(uuid,text)'::regprocedure] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
           OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'function_privilege_wrong: %', v_fn;
        END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY ARRAY[
        'public.fn_course_open_alert_new_token()'::regprocedure,
        'public.fn_course_open_alert_has_course(uuid,uuid,text)'::regprocedure] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
           OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'helper_privilege_leak: %', v_fn;
        END IF;
    END LOOP;
END;
$post$;

COMMIT;
