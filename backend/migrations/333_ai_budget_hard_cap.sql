-- Migration: 333_ai_budget_hard_cap.sql
--
-- AIBUDGET-0033 (specs/0033-ai-budget-hard-cap, plan.md "Migration 333",
-- task T002). Paid AI spend had no hard stop: provider calls were made with no
-- budget check, budget errors fell back to the next provider, and a refused
-- Speaking submission was lost. This migration adds the database half of the
-- budget; it writes no data and the deployed (N-1) backend never calls it.
--
--   1. ai_budget_counters: one row per scope (total, anthropic, google,
--      openai, elevenlabs, azure) and UTC period (month, day). Every line is
--      counted on its provider scope AND on total (FR-002, decision (b)).
--   2. ai_budget_reservations: one row per reserved provider line, keyed by
--      (request_key, provider, line_no); status reserved → settled | released
--      | expired.
--   3. ai_deferred_grading_jobs (deferred Speaking grading, FR-011..FR-013)
--      and ai_deferred_session_refresh (the session's refresh generation, the
--      generation its persisted band reflects, and the class-score sync
--      generation; FR-013, FR-024).
--   4. writing_jobs budget-drain columns (budget_deferred_at, drain lease,
--      drain count and persistence marker). attempt_count is never touched.
--   5. ai_budget_alerts: threshold alerts exactly once per scope, period and
--      threshold (FR-015) and one row per raise grant/end/expiry (FR-022).
--   6. ai_budget_heartbeat: the sweeper's single heartbeat row (FR-014).
--   7. SECURITY DEFINER functions, service_role EXECUTE only:
--        fn_ai_budget_reserve / _settle / _release / _expire / _close_scope,
--        fn_ai_deferred_save / _claim / _commit, fn_ai_deferred_claim_writing /
--        fn_ai_deferred_commit_writing, fn_ai_deferred_aggregate_write,
--        fn_ai_session_bands_write, fn_ai_class_sync, and the operator-only
--        fn_ai_budget_recompute (owner only, not even service_role).
--      Soft scopes (anthropic, total; FR-002, FR-021) are counted and alerted
--      but never compared with a cap. A hard scope's effective cap is its base
--      cap plus its active raise, read after the counter rows are locked.
--   8. Postconditions (the transaction aborts on any mismatch).
--  10. Budget raise (FR-022): ai_budget_raises (hard scopes only, whole
--      dollars, at most 100% of the base monthly cap, 1–24 hours, aal2 actor,
--      one active raise per scope), the append-only ai_budget_raise_events, and
--      fn_ai_budget_raise_grant / _end / _expire_sweep.
--  11. trg_ai_session_generation on responses (FR-024): any insert, delete or
--      update of overall_band, final_band_p, final_overall_band, feedback or
--      grading_status advances the session's refresh generation in the
--      writer's transaction.
--
-- Lock order, everywhere: job row → responses row → sessions row → refresh
-- row → class_assignment_items row. Budget counter rows are always locked in
-- (scope, period_kind, period_start) order, before any raise row.
--
-- Order and compatibility: additive and re-runnable. Apply with
-- MIGRATION_FEATURES=ai_budget (forward-policy group) through the
-- advisory-locked runner, on staging first (rollout.md S1) and on production
-- only at an authorised promotion (P2), before the 0033 backend. The N-1
-- backend reads none of these objects; the new writing_jobs columns are
-- nullable or have a constant default; the only change it sees is one
-- refresh-row upsert per band-bearing response write, done by a SECURITY
-- DEFINER trigger that needs no caller privilege and changes no response
-- column.
--
-- ROLLBACK (a new forward migration, never an edit of this file; rollout.md
-- §Rollback and repair). Export ai_budget_raise_events first
-- (\copy public.ai_budget_raise_events TO 'raise-events.csv' CSV HEADER); the
-- table, its append-only trigger and that trigger's function are kept as the
-- audit record. The guard refuses while saved work still waits for grading.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DO $$
--   BEGIN
--       IF EXISTS (SELECT 1 FROM public.ai_deferred_grading_jobs WHERE status IN ('queued', 'running')) THEN
--           RAISE EXCEPTION 'rollback_unsafe_deferred_jobs_pending';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.ai_deferred_session_refresh r
--                    JOIN public.sessions s ON s.id = r.session_id AND s.status = 'completed'
--                   WHERE r.refreshed_generation < r.generation) THEN
--           RAISE EXCEPTION 'rollback_unsafe_session_refresh_owed';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.writing_jobs
--                   WHERE budget_deferred_at IS NOT NULL AND status IN ('queued', 'running')) THEN
--           RAISE EXCEPTION 'rollback_unsafe_writing_jobs_deferred';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.ai_budget_raises WHERE ended_at IS NULL AND expires_at > now()) THEN
--           RAISE EXCEPTION 'rollback_unsafe_raise_active';
--       END IF;
--   END $$;
--   DROP TRIGGER IF EXISTS trg_ai_session_generation ON public.responses;
--   DROP FUNCTION IF EXISTS public.fn_ai_session_generation_bump();
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_reserve(text, jsonb, jsonb, integer);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_settle(uuid, numeric);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_release(uuid);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_expire(timestamptz);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_close_scope(text, date, text);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_recompute(date);
--   DROP FUNCTION IF EXISTS public.fn_ai_deferred_save(jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.fn_ai_deferred_claim(integer, integer);
--   DROP FUNCTION IF EXISTS public.fn_ai_deferred_commit(uuid, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.fn_ai_deferred_claim_writing(integer, integer);
--   DROP FUNCTION IF EXISTS public.fn_ai_deferred_commit_writing(uuid, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.fn_ai_deferred_aggregate_write(uuid, bigint, jsonb);
--   DROP FUNCTION IF EXISTS public.fn_ai_session_bands_write(uuid, bigint, jsonb, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.fn_ai_class_sync(uuid);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_raise_grant(text, numeric, integer, text, uuid, text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_raise_end(uuid, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_raise_expire_sweep(timestamptz);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_raise_record_end(uuid, text, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_alert_crossings(text, text, date);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_lock_counter(text, text, date);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_thresholds(text, text);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_active_raise(text);
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_ensure_refresh(uuid);
--   DROP FUNCTION IF EXISTS public.fn_ai_patch_row(text, uuid, jsonb, text[]);
--   DROP FUNCTION IF EXISTS public.fn_ai_insert_row(text, jsonb, text[]);
--   DROP FUNCTION IF EXISTS public.fn_ai_response_revision(uuid, text);
--   DROP TABLE IF EXISTS public.ai_budget_alerts;
--   DROP TABLE IF EXISTS public.ai_budget_raises;
--   DROP TABLE IF EXISTS public.ai_budget_reservations;
--   DROP TABLE IF EXISTS public.ai_budget_counters;
--   DROP TABLE IF EXISTS public.ai_deferred_grading_jobs;
--   DROP TABLE IF EXISTS public.ai_deferred_session_refresh;
--   DROP TABLE IF EXISTS public.ai_budget_heartbeat;
--   DROP INDEX IF EXISTS public.idx_writing_jobs_budget_deferred;
--   ALTER TABLE public.writing_jobs
--       DROP COLUMN IF EXISTS budget_deferred_at, DROP COLUMN IF EXISTS budget_lease_token,
--       DROP COLUMN IF EXISTS budget_lease_until, DROP COLUMN IF EXISTS budget_drain_count,
--       DROP COLUMN IF EXISTS budget_persisted_at, DROP COLUMN IF EXISTS budget_commit_count;
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: the tables the functions write must already exist.
DO $$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_missing
      FROM (VALUES ('responses'), ('sessions'), ('writing_jobs'), ('writing_essays'),
                   ('writing_feedback'), ('grammar_recommendations'), ('class_assignment_items')) t(name)
     WHERE to_regclass('public.' || t.name) IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_precondition_missing: %', v_missing;
    END IF;
END $$;

-- 1. Counters. Written only by the functions below.
CREATE TABLE IF NOT EXISTS public.ai_budget_counters (
    scope         text NOT NULL
        CHECK (scope IN ('total', 'anthropic', 'google', 'openai', 'elevenlabs', 'azure')),
    period_kind   text NOT NULL CHECK (period_kind IN ('month', 'day')),
    period_start  date NOT NULL,
    cap_usd       numeric(12,4),
    settled_usd   numeric(14,6) NOT NULL DEFAULT 0,
    reserved_usd  numeric(14,6) NOT NULL DEFAULT 0,
    closed_reason text CHECK (closed_reason IS NULL OR closed_reason = 'provider_spend_limit'),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, period_kind, period_start),
    CHECK (settled_usd >= 0 AND reserved_usd >= 0),
    CHECK (closed_reason IS NULL OR (period_kind = 'day' AND scope <> 'total'))
);

-- 2. Reservations.
CREATE TABLE IF NOT EXISTS public.ai_budget_reservations (
    id            uuid PRIMARY KEY,
    request_key   text NOT NULL,
    line_no       integer NOT NULL,
    provider      text NOT NULL
        CHECK (provider IN ('anthropic', 'google', 'openai', 'elevenlabs', 'azure')),
    model         text NOT NULL,
    feature       text NOT NULL,
    operation     text,
    user_id       uuid,
    resource_type text,
    resource_id   text,
    month_start   date NOT NULL,
    day_start     date NOT NULL,
    estimate_usd  numeric(14,6) NOT NULL CHECK (estimate_usd > 0),
    actual_usd    numeric(14,6) CHECK (actual_usd IS NULL OR actual_usd >= 0),
    status        text NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    settled_at    timestamptz,
    CHECK ((status = 'settled') = (actual_usd IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_budget_reservations_key
    ON public.ai_budget_reservations (request_key, provider, line_no);
CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_open
    ON public.ai_budget_reservations (status, expires_at) WHERE status = 'reserved';

-- 3. Deferred Speaking jobs and the per-session refresh obligation.
CREATE TABLE IF NOT EXISTS public.ai_deferred_grading_jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                text NOT NULL DEFAULT 'speaking_response' CHECK (kind IN ('speaking_response')),
    resource_id         uuid NOT NULL,
    submission_revision text NOT NULL,
    user_id             uuid NOT NULL,
    status              text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'superseded')),
    reason              text,
    grading_attempt_id  uuid,
    persisted_at        timestamptz,
    commit_count        integer NOT NULL DEFAULT 0 CHECK (commit_count BETWEEN 0 AND 1),
    attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_until         timestamptz,
    lease_token         uuid,
    enqueued_at         timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    last_error          text,
    CHECK ((status = 'done') = (persisted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_deferred_grading_jobs_revision
    ON public.ai_deferred_grading_jobs (kind, resource_id, submission_revision);
CREATE INDEX IF NOT EXISTS idx_ai_deferred_grading_jobs_queue
    ON public.ai_deferred_grading_jobs (status, enqueued_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_ai_deferred_grading_jobs_lease
    ON public.ai_deferred_grading_jobs (lease_until) WHERE status = 'running';

-- No FK to sessions: the generation trigger runs inside a session's cascade
-- delete, and the obligation must never block that delete.
CREATE TABLE IF NOT EXISTS public.ai_deferred_session_refresh (
    session_id              uuid PRIMARY KEY,
    generation              bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
    refreshed_generation    bigint NOT NULL DEFAULT 0 CHECK (refreshed_generation >= 0),
    class_synced_generation bigint NOT NULL DEFAULT 0 CHECK (class_synced_generation >= 0),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (refreshed_generation <= generation)
);
CREATE INDEX IF NOT EXISTS idx_ai_deferred_session_refresh_owed
    ON public.ai_deferred_session_refresh (session_id) WHERE refreshed_generation < generation;

-- 4. Writing budget-drain columns (separate from attempt_count/max_attempts).
ALTER TABLE public.writing_jobs
    ADD COLUMN IF NOT EXISTS budget_deferred_at  timestamptz,
    ADD COLUMN IF NOT EXISTS budget_lease_token  uuid,
    ADD COLUMN IF NOT EXISTS budget_lease_until  timestamptz,
    ADD COLUMN IF NOT EXISTS budget_drain_count  integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS budget_persisted_at timestamptz,
    ADD COLUMN IF NOT EXISTS budget_commit_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_writing_jobs_budget_deferred
    ON public.writing_jobs (budget_deferred_at, id)
    WHERE budget_deferred_at IS NOT NULL AND status IN ('queued', 'running');

-- 10. Budget raises (created before the alerts, which reference them).
CREATE TABLE IF NOT EXISTS public.ai_budget_raises (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope              text NOT NULL CHECK (scope IN ('google', 'azure', 'openai', 'elevenlabs')),
    amount_usd         numeric(10,2) NOT NULL CHECK (amount_usd >= 1 AND amount_usd = trunc(amount_usd)),
    base_month_cap_usd numeric(12,4) NOT NULL CHECK (base_month_cap_usd > 0),
    granted_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    granted_by         uuid NOT NULL,
    granted_aal        text NOT NULL CHECK (granted_aal = 'aal2'),
    reason             text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    ended_at           timestamptz,
    ended_by           uuid,
    end_kind           text CHECK (end_kind IN ('ended_early', 'expired')),
    end_reason         text,
    request_id         text,
    CHECK (amount_usd <= base_month_cap_usd),
    CHECK (expires_at >= granted_at + interval '1 hour' AND expires_at <= granted_at + interval '24 hours'),
    CHECK ((ended_at IS NULL) = (end_kind IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_budget_raises_one_active
    ON public.ai_budget_raises (scope) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_budget_raises_scope_granted
    ON public.ai_budget_raises (scope, granted_at);

-- Append-only; no FK, so the audit survives a rollback that drops the raises.
CREATE TABLE IF NOT EXISTS public.ai_budget_raise_events (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raise_id                uuid NOT NULL,
    event                   text NOT NULL CHECK (event IN ('granted', 'ended_early', 'expired')),
    scope                   text NOT NULL,
    amount_usd              numeric(10,2) NOT NULL,
    base_month_cap_usd      numeric(12,4) NOT NULL,
    effective_month_cap_usd numeric(12,4) NOT NULL,
    expires_at              timestamptz NOT NULL,
    actor_id                uuid,
    actor_aal               text,
    request_id              text,
    reason                  text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CHECK ((event = 'expired') = (actor_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_budget_raise_events_once
    ON public.ai_budget_raise_events (raise_id, event);

CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'ai_budget_raise_events_append_only' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE TRIGGER trg_ai_budget_raise_events_append_only
    BEFORE UPDATE OR DELETE ON public.ai_budget_raise_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_ai_budget_raise_events_append_only();
CREATE OR REPLACE TRIGGER trg_ai_budget_raise_events_no_truncate
    BEFORE TRUNCATE ON public.ai_budget_raise_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ai_budget_raise_events_append_only();

-- 5. Alerts. Inserted only inside the functions; service_role may update the
-- send columns (the sweeper's dispatch state) and nothing else.
CREATE TABLE IF NOT EXISTS public.ai_budget_alerts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text NOT NULL DEFAULT 'threshold'
        CHECK (kind IN ('threshold', 'raise_granted', 'raise_ended', 'raise_expired')),
    raise_id        uuid REFERENCES public.ai_budget_raises(id),
    scope           text NOT NULL
        CHECK (scope IN ('total', 'anthropic', 'google', 'openai', 'elevenlabs', 'azure')),
    period_kind     text NOT NULL CHECK (period_kind IN ('month', 'day')),
    period_start    date NOT NULL,
    threshold       integer CHECK (threshold IN (50, 80, 100)),
    trigger         text CHECK (trigger IN ('crossing', 'cap_refusal', 'provider_spend_limit')),
    committed_usd   numeric(14,6),
    cap_usd         numeric(12,4),
    created_at      timestamptz NOT NULL DEFAULT now(),
    send_status     text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending', 'sent', 'failed')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    last_error      text,
    CHECK (CASE WHEN kind = 'threshold'
                THEN threshold IS NOT NULL AND trigger IS NOT NULL AND raise_id IS NULL
                ELSE raise_id IS NOT NULL AND threshold IS NULL AND trigger IS NULL END)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_budget_alerts_threshold_once
    ON public.ai_budget_alerts (scope, period_kind, period_start, threshold) WHERE kind = 'threshold';
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_budget_alerts_raise_once
    ON public.ai_budget_alerts (raise_id, kind) WHERE kind <> 'threshold';
CREATE INDEX IF NOT EXISTS idx_ai_budget_alerts_pending
    ON public.ai_budget_alerts (next_attempt_at) WHERE send_status <> 'sent';

-- 6. Sweeper heartbeat (a single row).
CREATE TABLE IF NOT EXISTS public.ai_budget_heartbeat (
    id          boolean PRIMARY KEY DEFAULT true CHECK (id),
    last_run_at timestamptz,
    last_result jsonb
);

ALTER TABLE public.ai_budget_counters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_budget_reservations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_deferred_grading_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_deferred_session_refresh ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_budget_raises            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_budget_raise_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_budget_alerts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_budget_heartbeat         ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_budget_counters          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_budget_reservations      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_deferred_grading_jobs    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_deferred_session_refresh FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_budget_raises            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_budget_raise_events      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_budget_alerts            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_budget_heartbeat         FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ai_budget_counters          TO service_role;
GRANT SELECT ON public.ai_budget_reservations      TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_deferred_grading_jobs TO service_role;
GRANT SELECT ON public.ai_deferred_session_refresh TO service_role;
GRANT SELECT ON public.ai_budget_raises            TO service_role;
GRANT SELECT ON public.ai_budget_raise_events      TO service_role;
GRANT SELECT ON public.ai_budget_alerts            TO service_role;
GRANT UPDATE (send_status, attempts, next_attempt_at, sent_at, last_error)
    ON public.ai_budget_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_budget_heartbeat TO service_role;

-- 7. Functions. Internal helpers first (no role may execute them directly).

-- Monthly thresholds are fixed by FR-015 (anthropic 80/100, decision (f));
-- a daily period alerts at 100% only.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_thresholds(p_scope text, p_kind text)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_kind = 'day' THEN ARRAY[100]
                WHEN p_scope = 'anthropic' THEN ARRAY[80, 100]
                ELSE ARRAY[50, 80, 100] END;
$$;

-- Upserts one counter row and locks it. Callers lock in
-- (scope, period_kind, period_start) order.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_lock_counter(p_scope text, p_kind text, p_start date)
RETURNS public.ai_budget_counters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.ai_budget_counters;
BEGIN
    INSERT INTO public.ai_budget_counters (scope, period_kind, period_start)
    VALUES (p_scope, p_kind, p_start)
    ON CONFLICT (scope, period_kind, period_start) DO NOTHING;
    SELECT * INTO v_row FROM public.ai_budget_counters
     WHERE scope = p_scope AND period_kind = p_kind AND period_start = p_start
       FOR UPDATE;
    RETURN v_row;
END;
$$;

-- Inserts the threshold alerts the (locked) counter row has reached. A row
-- without a cap snapshot (a soft scope whose variable is invalid) alerts
-- nothing. The unique index makes every threshold fire once per period.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_alert_crossings(p_scope text, p_kind text, p_start date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.ai_budget_counters;
    v_threshold integer;
BEGIN
    SELECT * INTO v_row FROM public.ai_budget_counters
     WHERE scope = p_scope AND period_kind = p_kind AND period_start = p_start;
    IF NOT FOUND OR v_row.cap_usd IS NULL OR v_row.cap_usd <= 0 THEN
        RETURN;
    END IF;
    FOREACH v_threshold IN ARRAY public.fn_ai_budget_thresholds(p_scope, p_kind) LOOP
        IF v_row.settled_usd + v_row.reserved_usd >= v_row.cap_usd * v_threshold / 100 THEN
            INSERT INTO public.ai_budget_alerts
                (kind, scope, period_kind, period_start, threshold, trigger, committed_usd, cap_usd)
            VALUES ('threshold', p_scope, p_kind, p_start, v_threshold, 'crossing',
                    v_row.settled_usd + v_row.reserved_usd, v_row.cap_usd)
            ON CONFLICT (scope, period_kind, period_start, threshold) WHERE kind = 'threshold' DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

-- The active raise of a scope counts only while it is not ended and
-- now() < expires_at, so the cap reverts at expires_at with no sweeper run.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_active_raise(p_scope text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(sum(amount_usd), 0) FROM public.ai_budget_raises
     WHERE scope = p_scope AND ended_at IS NULL AND expires_at > now();
$$;

-- The Python submission_revision(): sha256 of "<response id>:<audio path>".
CREATE OR REPLACE FUNCTION public.fn_ai_response_revision(p_response_id uuid, p_audio_storage_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p_response_id IS NULL THEN 'absent'
                ELSE encode(sha256(convert_to(p_response_id::text || ':' || COALESCE(p_audio_storage_path, ''),
                                              'UTF8')), 'hex') END;
$$;

-- Applies an allow-listed jsonb patch to one row of a fixed table. Values are
-- cast by jsonb_populate_record to the column's own type.
CREATE OR REPLACE FUNCTION public.fn_ai_patch_row(p_table text, p_id uuid, p_patch jsonb, p_allowed text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bad text;
    v_cols text;
    v_vals text;
BEGIN
    IF p_table NOT IN ('responses', 'sessions', 'writing_essays', 'writing_feedback') THEN
        RAISE EXCEPTION 'ai_budget_patch_table_not_allowed: %', p_table USING ERRCODE = '22023';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'ai_budget_patch_not_object' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (p_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(quote_ident(k), ', ' ORDER BY k), string_agg('x.' || quote_ident(k), ', ' ORDER BY k)
      INTO v_cols, v_vals
      FROM jsonb_object_keys(p_patch) k;
    IF v_cols IS NULL THEN
        RETURN;
    END IF;
    EXECUTE format('UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) x) '
                   'WHERE t.id = $2', p_table, v_cols, v_vals, p_table)
        USING p_patch, p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_ai_insert_row(p_table text, p_row jsonb, p_allowed text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bad text;
    v_cols text;
    v_vals text;
    v_id uuid;
BEGIN
    IF p_table NOT IN ('responses', 'writing_feedback') THEN
        RAISE EXCEPTION 'ai_budget_patch_table_not_allowed: %', p_table USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM jsonb_object_keys(p_row) k WHERE NOT (k = ANY (p_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(quote_ident(k), ', ' ORDER BY k), string_agg('x.' || quote_ident(k), ', ' ORDER BY k)
      INTO v_cols, v_vals
      FROM jsonb_object_keys(p_row) k;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) x '
                   'RETURNING id', p_table, v_cols, v_vals, p_table)
        INTO v_id USING p_row;
    RETURN v_id;
END;
$$;

-- Inserts the session's refresh row when absent and locks it. Callers hold
-- the sessions row lock first.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_ensure_refresh(p_session_id uuid)
RETURNS public.ai_deferred_session_refresh
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.ai_deferred_session_refresh;
BEGIN
    INSERT INTO public.ai_deferred_session_refresh (session_id) VALUES (p_session_id)
    ON CONFLICT (session_id) DO NOTHING;
    SELECT * INTO v_row FROM public.ai_deferred_session_refresh WHERE session_id = p_session_id FOR UPDATE;
    RETURN v_row;
END;
$$;

-- 7a. Reserve. All-or-nothing over every line; soft scopes never refuse for
-- a cap; a replayed request key never authorises a provider request.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_reserve(
    p_request_key text, p_lines jsonb, p_caps jsonb, p_ttl_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_month    date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_day      date := (now() AT TIME ZONE 'UTC')::date;
    v_line     jsonb;
    v_lines    jsonb := '[]'::jsonb;
    v_provider text;
    v_estimate numeric;
    v_scopes   text[];
    v_scope    text;
    v_kind     text;
    v_start    date;
    v_cap      jsonb;
    v_soft     boolean;
    v_base     numeric;
    v_raise    numeric;
    v_eff      jsonb := '{}'::jsonb;
    v_sum      numeric;
    v_row      public.ai_budget_counters;
    v_refusals jsonb := '[]'::jsonb;
    v_first    jsonb;
    v_out      jsonb;
BEGIN
    IF p_request_key IS NULL OR btrim(p_request_key) = '' OR length(p_request_key) > 200 THEN
        RAISE EXCEPTION 'ai_budget_invalid_request_key' USING ERRCODE = '22023';
    END IF;
    IF p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'ai_budget_invalid_ttl' USING ERRCODE = '22023';
    END IF;
    IF p_caps IS NULL OR jsonb_typeof(p_caps) <> 'object' THEN
        RAISE EXCEPTION 'ai_budget_invalid_caps' USING ERRCODE = '22023';
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'ai_budget_invalid_lines' USING ERRCODE = '22023';
    END IF;

    -- Normalise the lines. Estimates are rounded UP to the stored precision,
    -- so the stored estimate is still an upper bound.
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        v_provider := v_line->>'provider';
        IF v_provider IS NULL OR v_provider NOT IN ('anthropic', 'google', 'openai', 'elevenlabs', 'azure') THEN
            RAISE EXCEPTION 'ai_budget_invalid_provider: %', v_provider USING ERRCODE = '22023';
        END IF;
        IF (v_line->>'line_no') IS NULL OR COALESCE(btrim(v_line->>'model'), '') = ''
           OR COALESCE(btrim(v_line->>'feature'), '') = '' THEN
            RAISE EXCEPTION 'ai_budget_invalid_line' USING ERRCODE = '22023';
        END IF;
        v_estimate := ceil((v_line->>'estimate_usd')::numeric * 1000000) / 1000000;
        IF v_estimate IS NULL OR v_estimate <= 0 THEN
            RAISE EXCEPTION 'ai_budget_invalid_estimate' USING ERRCODE = '22023';
        END IF;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'line_no', (v_line->>'line_no')::integer, 'provider', v_provider,
            'model', v_line->>'model', 'feature', v_line->>'feature',
            'operation', v_line->>'operation', 'estimate_usd', v_estimate,
            'user_id', (v_line->>'user_id')::uuid, 'resource_type', v_line->>'resource_type',
            'resource_id', v_line->>'resource_id'));
    END LOOP;
    IF (SELECT count(DISTINCT (l->>'provider', l->>'line_no')) FROM jsonb_array_elements(v_lines) l)
       <> jsonb_array_length(v_lines) THEN
        RAISE EXCEPTION 'ai_budget_duplicate_line' USING ERRCODE = '22023';
    END IF;

    -- A concurrent duplicate waits here until the first transaction ends,
    -- then sees its rows as a replay.
    PERFORM pg_advisory_xact_lock(333, hashtext(p_request_key));
    SELECT jsonb_agg(jsonb_build_object('line_no', line_no, 'provider', provider, 'status', status)
                     ORDER BY provider, line_no)
      INTO v_out
      FROM public.ai_budget_reservations WHERE request_key = p_request_key;
    IF v_out IS NOT NULL THEN
        RETURN jsonb_build_object('granted', false, 'replay', true, 'lines', v_out);
    END IF;

    SELECT array_agg(s ORDER BY s) INTO v_scopes
      FROM (SELECT DISTINCT l->>'provider' AS s FROM jsonb_array_elements(v_lines) l
            UNION SELECT 'total') u;

    -- Lock every touched counter row in (scope, period_kind) order.
    FOR v_scope, v_kind IN
        SELECT s, k FROM unnest(v_scopes) s CROSS JOIN (VALUES ('day'), ('month')) p(k) ORDER BY s, k
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_scope, v_kind,
                                                 CASE v_kind WHEN 'month' THEN v_month ELSE v_day END);
    END LOOP;

    -- A provider spend-limit closure refuses every scope, soft ones included.
    SELECT * INTO v_row FROM public.ai_budget_counters
     WHERE scope = ANY (v_scopes)
       AND ((period_kind = 'month' AND period_start = v_month) OR (period_kind = 'day' AND period_start = v_day))
       AND closed_reason IS NOT NULL
     ORDER BY scope, period_kind LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('granted', false, 'replay', false, 'reason', 'provider_spend_limit',
                                  'scope', v_row.scope, 'period_kind', v_row.period_kind);
    END IF;

    FOREACH v_scope IN ARRAY v_scopes LOOP
        v_soft := v_scope IN ('anthropic', 'total');
        v_cap := p_caps -> v_scope;
        IF v_cap IS NOT NULL AND jsonb_typeof(v_cap) <> 'object' THEN
            RAISE EXCEPTION 'ai_budget_invalid_caps: %', v_scope USING ERRCODE = '22023';
        END IF;
        -- The enforcement mode is fixed by the spec (FR-003), never by the caller.
        IF v_cap ? 'mode' AND v_cap->>'mode' IS DISTINCT FROM (CASE WHEN v_soft THEN 'soft' ELSE 'hard' END) THEN
            RAISE EXCEPTION 'ai_budget_mode_mismatch: %', v_scope USING ERRCODE = '22023';
        END IF;
        IF v_cap ? 'thresholds' AND jsonb_typeof(v_cap->'thresholds') <> 'null'
           AND ARRAY(SELECT jsonb_array_elements_text(v_cap->'thresholds')::integer ORDER BY 1)
               IS DISTINCT FROM public.fn_ai_budget_thresholds(v_scope, 'month') THEN
            RAISE EXCEPTION 'ai_budget_thresholds_mismatch: %', v_scope USING ERRCODE = '22023';
        END IF;
        v_raise := CASE WHEN v_soft THEN 0 ELSE public.fn_ai_budget_active_raise(v_scope) END;
        SELECT COALESCE(sum((l->>'estimate_usd')::numeric), 0) INTO v_sum
          FROM jsonb_array_elements(v_lines) l
         WHERE v_scope = 'total' OR l->>'provider' = v_scope;

        FOREACH v_kind IN ARRAY ARRAY['month', 'day'] LOOP
            v_start := CASE v_kind WHEN 'month' THEN v_month ELSE v_day END;
            v_base := (v_cap->>v_kind)::numeric;
            IF v_soft THEN
                -- Counted and alerted, never compared (FR-002, FR-021).
                v_eff := v_eff || jsonb_build_object(v_scope || ':' || v_kind,
                                                     CASE WHEN v_base > 0 THEN v_base END);
                CONTINUE;
            END IF;
            IF v_base IS NULL OR v_base <= 0 THEN
                v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
                    'scope', v_scope, 'period_kind', v_kind, 'reason', 'config_invalid'));
                CONTINUE;
            END IF;
            SELECT * INTO v_row FROM public.ai_budget_counters
             WHERE scope = v_scope AND period_kind = v_kind AND period_start = v_start;
            v_eff := v_eff || jsonb_build_object(v_scope || ':' || v_kind, v_base + v_raise);
            IF v_row.settled_usd + v_row.reserved_usd + v_sum > v_base + v_raise THEN
                v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
                    'scope', v_scope, 'period_kind', v_kind,
                    'reason', CASE v_kind WHEN 'month' THEN 'monthly_cap' ELSE 'daily_cap' END,
                    'committed_usd', v_row.settled_usd + v_row.reserved_usd,
                    'cap_usd', v_base + v_raise, 'period_start', v_start));
            END IF;
        END LOOP;
    END LOOP;

    IF jsonb_array_length(v_refusals) > 0 THEN
        -- The only write of a refusal: the 100% alert of each refusing scope
        -- and period, once (FR-015).
        INSERT INTO public.ai_budget_alerts
            (kind, scope, period_kind, period_start, threshold, trigger, committed_usd, cap_usd)
        SELECT 'threshold', r->>'scope', r->>'period_kind', (r->>'period_start')::date, 100, 'cap_refusal',
               (r->>'committed_usd')::numeric, (r->>'cap_usd')::numeric
          FROM jsonb_array_elements(v_refusals) r
         WHERE r->>'reason' IN ('monthly_cap', 'daily_cap')
        ON CONFLICT (scope, period_kind, period_start, threshold) WHERE kind = 'threshold' DO NOTHING;
        SELECT r INTO v_first FROM jsonb_array_elements(v_refusals) WITH ORDINALITY e(r, n)
         ORDER BY CASE r->>'reason' WHEN 'config_invalid' THEN 0 WHEN 'monthly_cap' THEN 1 ELSE 2 END, n
         LIMIT 1;
        RETURN jsonb_build_object('granted', false, 'replay', false, 'reason', v_first->>'reason',
                                  'scope', v_first->>'scope', 'period_kind', v_first->>'period_kind',
                                  'refusals', v_refusals);
    END IF;

    INSERT INTO public.ai_budget_reservations
        (id, request_key, line_no, provider, model, feature, operation, user_id, resource_type, resource_id,
         month_start, day_start, estimate_usd, status, expires_at)
    SELECT md5(p_request_key || ':' || (l->>'provider') || ':' || (l->>'line_no'))::uuid, p_request_key,
           (l->>'line_no')::integer, l->>'provider', l->>'model', l->>'feature', l->>'operation',
           (l->>'user_id')::uuid, l->>'resource_type', l->>'resource_id', v_month, v_day,
           (l->>'estimate_usd')::numeric, 'reserved', now() + make_interval(secs => p_ttl_seconds)
      FROM jsonb_array_elements(v_lines) l;

    FOREACH v_scope IN ARRAY v_scopes LOOP
        SELECT COALESCE(sum((l->>'estimate_usd')::numeric), 0) INTO v_sum
          FROM jsonb_array_elements(v_lines) l
         WHERE v_scope = 'total' OR l->>'provider' = v_scope;
        FOREACH v_kind IN ARRAY ARRAY['day', 'month'] LOOP
            v_start := CASE v_kind WHEN 'month' THEN v_month ELSE v_day END;
            UPDATE public.ai_budget_counters
               SET reserved_usd = reserved_usd + v_sum,
                   cap_usd = (v_eff->>(v_scope || ':' || v_kind))::numeric,
                   updated_at = now()
             WHERE scope = v_scope AND period_kind = v_kind AND period_start = v_start;
            PERFORM public.fn_ai_budget_alert_crossings(v_scope, v_kind, v_start);
        END LOOP;
    END LOOP;

    SELECT jsonb_agg(jsonb_build_object('id', id, 'line_no', line_no, 'provider', provider,
                                        'estimate_usd', estimate_usd, 'expires_at', expires_at)
                     ORDER BY provider, line_no)
      INTO v_out
      FROM public.ai_budget_reservations WHERE request_key = p_request_key;
    RETURN jsonb_build_object('granted', true, 'replay', false, 'month_start', v_month, 'day_start', v_day,
                              'reservations', v_out);
END;
$$;

-- 7b. Settle a reserved line at its provider-reported cost. Any other state
-- is a no-op, so a second call changes nothing.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_settle(p_reservation_id uuid, p_actual_usd numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res public.ai_budget_reservations;
    v_actual numeric := round(p_actual_usd, 6);
    v_key record;
BEGIN
    IF v_actual IS NULL OR v_actual < 0 THEN
        RAISE EXCEPTION 'ai_budget_invalid_actual' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_res FROM public.ai_budget_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_res.status <> 'reserved' THEN
        RETURN jsonb_build_object('status', 'noop', 'reservation_status', v_res.status);
    END IF;
    FOR v_key IN
        SELECT s AS scope, k AS kind, CASE k WHEN 'month' THEN v_res.month_start ELSE v_res.day_start END AS start
          FROM unnest(ARRAY[v_res.provider, 'total']) s CROSS JOIN (VALUES ('day'), ('month')) p(k)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters
           SET reserved_usd = GREATEST(reserved_usd - v_res.estimate_usd, 0),
               settled_usd = settled_usd + v_actual, updated_at = now()
         WHERE scope = v_key.scope AND period_kind = v_key.kind AND period_start = v_key.start;
        PERFORM public.fn_ai_budget_alert_crossings(v_key.scope, v_key.kind, v_key.start);
    END LOOP;
    UPDATE public.ai_budget_reservations
       SET status = 'settled', actual_usd = v_actual, settled_at = now()
     WHERE id = p_reservation_id;
    RETURN jsonb_build_object('status', 'settled', 'estimate_usd', v_res.estimate_usd, 'actual_usd', v_actual);
END;
$$;

-- 7c. Release a line that provably was not sent.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_release(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res public.ai_budget_reservations;
    v_key record;
BEGIN
    SELECT * INTO v_res FROM public.ai_budget_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_res.status <> 'reserved' THEN
        RETURN jsonb_build_object('status', 'noop', 'reservation_status', v_res.status);
    END IF;
    FOR v_key IN
        SELECT s AS scope, k AS kind, CASE k WHEN 'month' THEN v_res.month_start ELSE v_res.day_start END AS start
          FROM unnest(ARRAY[v_res.provider, 'total']) s CROSS JOIN (VALUES ('day'), ('month')) p(k)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters
           SET reserved_usd = GREATEST(reserved_usd - v_res.estimate_usd, 0), updated_at = now()
         WHERE scope = v_key.scope AND period_kind = v_key.kind AND period_start = v_key.start;
    END LOOP;
    UPDATE public.ai_budget_reservations SET status = 'released', settled_at = now() WHERE id = p_reservation_id;
    RETURN jsonb_build_object('status', 'released');
END;
$$;

-- 7d. Expire: settle every overdue reserved line at its estimate. The rows
-- are claimed first and every counter is then locked once in global order,
-- so a long batch cannot deadlock against a reservation.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_expire(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now timestamptz := LEAST(COALESCE(p_now, now()), now());
    v_ids uuid[];
    v_key record;
BEGIN
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
        SELECT id FROM public.ai_budget_reservations
         WHERE status = 'reserved' AND expires_at <= v_now
         ORDER BY id FOR UPDATE SKIP LOCKED) c;
    IF v_ids IS NULL THEN
        RETURN 0;
    END IF;
    FOR v_key IN
        SELECT DISTINCT s AS scope, k AS kind, CASE k WHEN 'month' THEN r.month_start ELSE r.day_start END AS start
          FROM public.ai_budget_reservations r
         CROSS JOIN LATERAL unnest(ARRAY[r.provider, 'total']) s
         CROSS JOIN (VALUES ('day'), ('month')) p(k)
         WHERE r.id = ANY (v_ids)
         ORDER BY 1, 2, 3
    LOOP
        PERFORM public.fn_ai_budget_lock_counter(v_key.scope, v_key.kind, v_key.start);
        UPDATE public.ai_budget_counters c
           SET reserved_usd = GREATEST(c.reserved_usd - x.amount, 0),
               settled_usd = c.settled_usd + x.amount, updated_at = now()
          FROM (SELECT sum(r.estimate_usd) AS amount FROM public.ai_budget_reservations r
                 WHERE r.id = ANY (v_ids) AND (v_key.scope = 'total' OR r.provider = v_key.scope)
                   AND CASE v_key.kind WHEN 'month' THEN r.month_start ELSE r.day_start END = v_key.start) x
         WHERE c.scope = v_key.scope AND c.period_kind = v_key.kind AND c.period_start = v_key.start;
    END LOOP;
    UPDATE public.ai_budget_reservations SET status = 'expired', settled_at = now() WHERE id = ANY (v_ids);
    RETURN cardinality(v_ids);
END;
$$;

-- 7e. A provider spend-limit response closes that provider for the UTC day
-- (FR-009) and alerts 100% daily once.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_close_scope(p_scope text, p_day date, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_day date := COALESCE(p_day, (now() AT TIME ZONE 'UTC')::date);
    v_row public.ai_budget_counters;
BEGIN
    IF p_scope IS NULL OR p_scope NOT IN ('anthropic', 'google', 'openai', 'elevenlabs', 'azure') THEN
        RAISE EXCEPTION 'ai_budget_invalid_scope: %', p_scope USING ERRCODE = '22023';
    END IF;
    IF p_reason IS DISTINCT FROM 'provider_spend_limit' THEN
        RAISE EXCEPTION 'ai_budget_invalid_close_reason: %', p_reason USING ERRCODE = '22023';
    END IF;
    v_row := public.fn_ai_budget_lock_counter(p_scope, 'day', v_day);
    IF v_row.closed_reason IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_closed', 'scope', p_scope, 'day', v_day);
    END IF;
    UPDATE public.ai_budget_counters SET closed_reason = p_reason, updated_at = now()
     WHERE scope = p_scope AND period_kind = 'day' AND period_start = v_day;
    INSERT INTO public.ai_budget_alerts
        (kind, scope, period_kind, period_start, threshold, trigger, committed_usd, cap_usd)
    VALUES ('threshold', p_scope, 'day', v_day, 100, 'provider_spend_limit',
            v_row.settled_usd + v_row.reserved_usd, v_row.cap_usd)
    ON CONFLICT (scope, period_kind, period_start, threshold) WHERE kind = 'threshold' DO NOTHING;
    RETURN jsonb_build_object('status', 'closed', 'scope', p_scope, 'day', v_day);
END;
$$;

-- 7f. Operator-only repair (owner, never service_role): recompute the
-- counters of one period start from the reservations (plan.md V3 identity).
CREATE OR REPLACE FUNCTION public.fn_ai_budget_recompute(p_period_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_key record;
    v_count integer := 0;
BEGIN
    IF p_period_start IS NULL THEN
        RAISE EXCEPTION 'ai_budget_invalid_period' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN
        SELECT scope, period_kind, period_start FROM public.ai_budget_counters
         WHERE period_start = p_period_start
         ORDER BY scope, period_kind, period_start
           FOR UPDATE
    LOOP
        UPDATE public.ai_budget_counters c
           SET settled_usd = x.settled, reserved_usd = x.reserved, updated_at = now()
          FROM (SELECT COALESCE(sum(r.actual_usd) FILTER (WHERE r.status = 'settled'), 0)
                       + COALESCE(sum(r.estimate_usd) FILTER (WHERE r.status = 'expired'), 0) AS settled,
                       COALESCE(sum(r.estimate_usd) FILTER (WHERE r.status = 'reserved'), 0) AS reserved
                  FROM public.ai_budget_reservations r
                 WHERE (v_key.scope = 'total' OR r.provider = v_key.scope)
                   AND CASE v_key.period_kind WHEN 'month' THEN r.month_start ELSE r.day_start END
                       = v_key.period_start) x
         WHERE c.scope = v_key.scope AND c.period_kind = v_key.period_kind
           AND c.period_start = v_key.period_start;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- 7g. Deferred Speaking save: the awaiting_budget response row and its job
-- in one transaction, under save_response's token and revision checks
-- (services/speaking_submission.py). No path writes one without the other.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_save(p_response jsonb, p_job jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_token_re CONSTANT text := '/[^/]+\.([0-9a-f-]{36})\.[0-9a-f]{64}\.[a-z0-9]+$';
    c_allowed CONSTANT text[] := ARRAY['audio_url', 'audio_storage_path', 'duration_seconds', 'transcript',
                                       'raw_transcript_text', 'transcript_model', 'transcript_reliability',
                                       'stt_status', 'feedback'];
    v_session  uuid := (p_response->>'session_id')::uuid;
    v_question uuid := (p_response->>'question_id')::uuid;
    v_token    text := p_response->>'submission_token';
    v_path     text := p_response->>'audio_storage_path';
    v_expected text := p_response->>'expected_revision';
    v_row      jsonb := COALESCE(p_response->'row', '{}'::jsonb);
    v_user     uuid := (p_job->>'user_id')::uuid;
    v_found    boolean;
    v_cur_id   uuid;
    v_cur_path text;
    v_id       uuid;
    v_revision text;
    v_job      uuid;
    v_attempt  integer := 0;
BEGIN
    IF v_session IS NULL OR v_question IS NULL OR v_user IS NULL OR v_expected IS NULL
       OR v_token IS NULL OR v_path IS NULL OR substring(v_path FROM c_token_re) IS DISTINCT FROM v_token
       OR jsonb_typeof(v_row) <> 'object'
       OR (v_row ? 'audio_storage_path' AND v_row->>'audio_storage_path' IS DISTINCT FROM v_path) THEN
        RAISE EXCEPTION 'ai_deferred_save_invalid_input' USING ERRCODE = '22023';
    END IF;
    v_row := v_row || jsonb_build_object('audio_storage_path', v_path);

    LOOP
        v_attempt := v_attempt + 1;
        v_cur_id := NULL;
        v_cur_path := NULL;
        SELECT id, audio_storage_path INTO v_cur_id, v_cur_path FROM public.responses
         WHERE session_id = v_session AND question_id = v_question
         LIMIT 1 FOR UPDATE;
        v_found := FOUND;
        IF v_found AND substring(COALESCE(v_cur_path, '') FROM c_token_re) = v_token THEN
            IF v_cur_path IS DISTINCT FROM v_path THEN
                RETURN jsonb_build_object('status', 'audio_changed', 'response_id', v_cur_id);
            END IF;
            SELECT id INTO v_job FROM public.ai_deferred_grading_jobs
             WHERE kind = 'speaking_response' AND resource_id = v_cur_id
               AND submission_revision = public.fn_ai_response_revision(v_cur_id, v_cur_path);
            RETURN jsonb_build_object('status', 'replay', 'response_id', v_cur_id, 'job_id', v_job);
        END IF;
        IF public.fn_ai_response_revision(v_cur_id, v_cur_path) IS DISTINCT FROM v_expected THEN
            RETURN jsonb_build_object('status', 'superseded', 'response_id', v_cur_id);
        END IF;
        IF v_found THEN
            v_id := v_cur_id;
            PERFORM public.fn_ai_patch_row('responses', v_id, v_row, c_allowed);
            EXIT;
        END IF;
        BEGIN
            v_id := public.fn_ai_insert_row('responses',
                        v_row || jsonb_build_object('session_id', v_session, 'question_id', v_question),
                        c_allowed || ARRAY['session_id', 'question_id']);
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            -- The unique (session_id, question_id) index arbitrates an insert
            -- race; re-read and re-check against the winner.
            IF v_attempt >= 2 THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    UPDATE public.responses
       SET grading_status = 'awaiting_budget', overall_band = NULL, final_overall_band = NULL, final_band_p = NULL
     WHERE id = v_id;
    v_revision := public.fn_ai_response_revision(v_id, v_path);
    -- Earlier revisions still queued are superseded, so they are never graded.
    UPDATE public.ai_deferred_grading_jobs
       SET status = 'superseded', finished_at = now()
     WHERE kind = 'speaking_response' AND resource_id = v_id AND status = 'queued'
       AND submission_revision <> v_revision;
    INSERT INTO public.ai_deferred_grading_jobs
        (kind, resource_id, submission_revision, user_id, reason, grading_attempt_id)
    VALUES ('speaking_response', v_id, v_revision, v_user, p_job->>'reason',
            (p_job->>'grading_attempt_id')::uuid)
    ON CONFLICT (kind, resource_id, submission_revision) DO NOTHING
    RETURNING id INTO v_job;
    IF v_job IS NULL THEN
        SELECT id INTO v_job FROM public.ai_deferred_grading_jobs
         WHERE kind = 'speaking_response' AND resource_id = v_id AND submission_revision = v_revision;
    END IF;
    RETURN jsonb_build_object('status', 'saved', 'response_id', v_id, 'job_id', v_job,
                              'submission_revision', v_revision);
END;
$$;

-- 7h. Claim queued jobs, and reclaim running jobs whose lease passed. Each
-- claim bumps attempts, so a reclaimed run gets a new request key. A job
-- whose response moved to another revision is superseded, never claimed.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_claim(p_limit integer, p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job public.ai_deferred_grading_jobs;
    v_out jsonb := '[]'::jsonb;
    v_current text;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
        RAISE EXCEPTION 'ai_deferred_claim_invalid_input' USING ERRCODE = '22023';
    END IF;
    FOR v_job IN
        SELECT * FROM public.ai_deferred_grading_jobs
         WHERE status = 'queued' OR (status = 'running' AND lease_until < now())
         ORDER BY enqueued_at, id
           FOR UPDATE SKIP LOCKED
    LOOP
        SELECT public.fn_ai_response_revision(r.id, r.audio_storage_path) INTO v_current
          FROM public.responses r WHERE r.id = v_job.resource_id;
        IF v_current IS DISTINCT FROM v_job.submission_revision THEN
            UPDATE public.ai_deferred_grading_jobs
               SET status = 'superseded', finished_at = now(), lease_until = NULL
             WHERE id = v_job.id;
            CONTINUE;
        END IF;
        UPDATE public.ai_deferred_grading_jobs
           SET status = 'running', lease_token = gen_random_uuid(),
               lease_until = now() + make_interval(secs => p_lease_seconds), attempts = attempts + 1
         WHERE id = v_job.id
        RETURNING * INTO v_job;
        v_out := v_out || jsonb_build_array(to_jsonb(v_job));
        EXIT WHEN jsonb_array_length(v_out) >= p_limit;
    END LOOP;
    RETURN v_out;
END;
$$;

-- 7i. Commit a deferred Speaking result: the response, its grammar
-- recommendations and the job's persistence marker in one transaction. The
-- response update fires item 11, which advances the session generation.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_commit(p_job_id uuid, p_lease_token uuid, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_allowed CONSTANT text[] := ARRAY['transcript', 'raw_transcript_text', 'transcript_model',
                                       'transcript_reliability', 'score_confidence', 'stt_status',
                                       'duration_seconds', 'feedback', 'overall_band', 'final_band_p',
                                       'final_overall_band', 'pronunciation_score', 'pronunciation_fluency',
                                       'pronunciation_accuracy', 'pronunciation_completeness',
                                       'pronunciation_status', 'pronunciation_provider',
                                       'pronunciation_locale', 'pronunciation_payload'];
    v_job public.ai_deferred_grading_jobs;
    v_response record;
    v_patch jsonb := COALESCE(p_result->'response', '{}'::jsonb);
    v_recs jsonb := COALESCE(p_result->'grammar_recommendations', '[]'::jsonb);
    v_session_status text;
BEGIN
    IF jsonb_typeof(v_patch) <> 'object' OR jsonb_typeof(v_recs) <> 'array' OR v_patch ? 'grading_status' THEN
        RAISE EXCEPTION 'ai_deferred_commit_invalid_result' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_job FROM public.ai_deferred_grading_jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_job.status = 'done' OR v_job.persisted_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'duplicate');
    END IF;
    IF v_job.status = 'superseded' THEN
        RETURN jsonb_build_object('status', 'superseded');
    END IF;
    IF v_job.status <> 'running' OR v_job.lease_token IS DISTINCT FROM p_lease_token THEN
        RETURN jsonb_build_object('status', 'lease_lost');
    END IF;
    SELECT id, session_id, audio_storage_path INTO v_response
      FROM public.responses WHERE id = v_job.resource_id FOR UPDATE;
    IF NOT FOUND OR public.fn_ai_response_revision(v_response.id, v_response.audio_storage_path)
                    IS DISTINCT FROM v_job.submission_revision THEN
        UPDATE public.ai_deferred_grading_jobs
           SET status = 'superseded', finished_at = now(), lease_until = NULL
         WHERE id = p_job_id;
        RETURN jsonb_build_object('status', 'superseded');
    END IF;

    PERFORM public.fn_ai_patch_row('responses', v_response.id,
                                   v_patch || jsonb_build_object('grading_status', 'completed'),
                                   c_allowed || ARRAY['grading_status']);
    DELETE FROM public.grammar_recommendations WHERE response_id = v_response.id;
    INSERT INTO public.grammar_recommendations
        (id, user_id, session_id, response_id, grammar_issue, recommended_slug, recommended_category,
         recommended_title, similarity_score, recommended_anchor)
    SELECT COALESCE(x.id, gen_random_uuid()), x.user_id, v_response.session_id, v_response.id,
           x.grammar_issue, x.recommended_slug, x.recommended_category, x.recommended_title,
           x.similarity_score, x.recommended_anchor
      FROM jsonb_populate_recordset(NULL::public.grammar_recommendations, v_recs) x;
    UPDATE public.ai_deferred_grading_jobs
       SET status = 'done', persisted_at = now(), commit_count = commit_count + 1, finished_at = now(),
           lease_until = NULL, last_error = NULL
     WHERE id = p_job_id;
    SELECT status INTO v_session_status FROM public.sessions WHERE id = v_response.session_id;
    RETURN jsonb_build_object('status', 'committed', 'response_id', v_response.id,
                              'session_id', v_response.session_id, 'session_status', v_session_status);
END;
$$;

-- 7j. Writing budget drain: claim budget-deferred writing_jobs with their
-- own lease. attempt_count, max_attempts and started_at are never touched.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_claim_writing(p_limit integer, p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out jsonb;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
        RAISE EXCEPTION 'ai_deferred_claim_invalid_input' USING ERRCODE = '22023';
    END IF;
    WITH c AS (
        SELECT id FROM public.writing_jobs
         WHERE budget_deferred_at IS NOT NULL
           AND (status = 'queued' OR (status = 'running' AND budget_lease_until < now()))
         ORDER BY budget_deferred_at, id
         LIMIT p_limit
           FOR UPDATE SKIP LOCKED
    ), u AS (
        UPDATE public.writing_jobs w
           SET status = 'running', budget_lease_token = gen_random_uuid(),
               budget_lease_until = now() + make_interval(secs => p_lease_seconds),
               budget_drain_count = w.budget_drain_count + 1
          FROM c WHERE w.id = c.id
        RETURNING w.id, w.essay_id, w.budget_lease_token, w.budget_lease_until, w.budget_drain_count,
                  w.budget_deferred_at
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.budget_deferred_at, u.id), '[]'::jsonb) INTO v_out FROM u;
    RETURN v_out;
END;
$$;

-- 7k. Commit a drained Writing grade: the versioned writing_feedback row
-- (the essay_service GV-1b chain, idempotent on provenance job_id), the essay
-- and the job's drain marker in one transaction.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_commit_writing(
    p_writing_job_id uuid, p_lease_token uuid, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_feedback CONSTANT text[] := ARRAY['overall_band_score', 'band_main_criterion', 'band_coherence_cohesion',
                                        'band_lexical_resource', 'band_grammatical_range', 'feedback_json',
                                        'prompt_version', 'model_used', 'tokens_input', 'tokens_output',
                                        'cost_usd', 'grading_duration_ms', 'source'];
    v_job record;
    v_essay record;
    v_feedback jsonb := p_result->'feedback';
    v_essay_patch jsonb := COALESCE(p_result->'essay', '{}'::jsonb);
    v_live integer[] := ARRAY[]::integer[];
    v_version integer;
    v_parent integer;
    v_next integer;
    v_existing integer;
BEGIN
    IF v_feedback IS NULL OR jsonb_typeof(v_feedback) <> 'object' OR jsonb_typeof(v_essay_patch) <> 'object' THEN
        RAISE EXCEPTION 'ai_deferred_commit_invalid_result' USING ERRCODE = '22023';
    END IF;
    SELECT id, essay_id, status, budget_deferred_at, budget_lease_token, budget_persisted_at, budget_drain_count
      INTO v_job FROM public.writing_jobs WHERE id = p_writing_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    SELECT id, status, current_version INTO v_essay FROM public.writing_essays WHERE id = v_job.essay_id FOR UPDATE;
    IF v_job.budget_persisted_at IS NOT NULL OR v_job.status = 'completed' THEN
        RETURN jsonb_build_object('status', 'duplicate');
    END IF;
    IF v_job.budget_lease_token IS NULL OR v_job.budget_lease_token IS DISTINCT FROM p_lease_token THEN
        RETURN jsonb_build_object('status', 'lease_lost');
    END IF;
    IF v_essay.id IS NULL OR v_essay.status NOT IN ('pending', 'grading') OR v_job.budget_deferred_at IS NULL THEN
        RETURN jsonb_build_object('status', 'superseded');
    END IF;

    SELECT version INTO v_existing FROM public.writing_feedback
     WHERE essay_id = v_essay.id AND provenance->>'job_id' = v_job.id::text LIMIT 1;
    IF FOUND THEN
        v_version := v_existing;
        PERFORM public.fn_ai_patch_row('writing_feedback',
                    (SELECT id FROM public.writing_feedback WHERE essay_id = v_essay.id AND version = v_existing),
                    v_feedback, c_feedback);
    ELSE
        IF EXISTS (SELECT 1 FROM public.writing_feedback WHERE essay_id = v_essay.id) THEN
            v_next := COALESCE(v_essay.current_version, 1);
            WHILE v_next IS NOT NULL AND NOT (v_next = ANY (v_live)) LOOP
                SELECT parent_version INTO v_parent FROM public.writing_feedback
                 WHERE essay_id = v_essay.id AND version = v_next;
                EXIT WHEN NOT FOUND;
                v_live := v_live || v_next;
                v_next := v_parent;
            END LOOP;
            -- Rows outside the live chain are orphans of a crashed regrade.
            DELETE FROM public.writing_feedback WHERE essay_id = v_essay.id AND NOT (version = ANY (v_live));
        END IF;
        IF cardinality(v_live) > 0 THEN
            v_parent := (SELECT max(v) FROM unnest(v_live) v);
            v_version := v_parent + 1;
        ELSE
            v_parent := NULL;
            v_version := 1;
        END IF;
        PERFORM public.fn_ai_insert_row('writing_feedback',
                    jsonb_build_object('source', 'ai_pro') || v_feedback || jsonb_build_object(
                        'essay_id', v_essay.id, 'version', v_version, 'parent_version', v_parent,
                        'provenance', jsonb_build_object('job_id', v_job.id::text,
                                                         'budget_drain_count', v_job.budget_drain_count)),
                    c_feedback || ARRAY['essay_id', 'version', 'parent_version', 'provenance']);
    END IF;

    PERFORM public.fn_ai_patch_row('writing_essays', v_essay.id,
                v_essay_patch || jsonb_build_object('status', 'graded', 'error_message', NULL,
                                                    'current_version', v_version),
                ARRAY['grading_tier_metadata', 'status', 'error_message', 'current_version']);
    UPDATE public.writing_jobs
       SET status = 'completed', completed_at = now(), budget_persisted_at = now(),
           budget_commit_count = budget_commit_count + 1, budget_lease_until = NULL
     WHERE id = v_job.id;
    RETURN jsonb_build_object('status', 'committed', 'essay_id', v_essay.id, 'version', v_version);
END;
$$;

-- 7l. Sweeper refresh: write a recomputed aggregate only if no response of
-- the session changed since the caller read the generation.
CREATE OR REPLACE FUNCTION public.fn_ai_deferred_aggregate_write(
    p_session_id uuid, p_generation bigint, p_bands jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_allowed CONSTANT text[] := ARRAY['overall_band', 'band_fc', 'band_lr', 'band_gra', 'band_p'];
    v_status text;
    v_refresh public.ai_deferred_session_refresh;
    v_bad text;
BEGIN
    IF p_generation IS NULL OR p_bands IS NULL OR jsonb_typeof(p_bands) <> 'object' THEN
        RAISE EXCEPTION 'ai_deferred_aggregate_invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(p_bands) k WHERE NOT (k = ANY (c_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    SELECT status INTO v_status FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF v_refresh.generation <> p_generation THEN
        RETURN jsonb_build_object('status', 'stale', 'generation', v_refresh.generation);
    END IF;
    IF v_status IS DISTINCT FROM 'completed' THEN
        RETURN jsonb_build_object('status', 'not_completed');
    END IF;
    PERFORM public.fn_ai_patch_row('sessions', p_session_id, p_bands, c_allowed);
    UPDATE public.ai_deferred_session_refresh
       SET refreshed_generation = p_generation, updated_at = now()
     WHERE session_id = p_session_id;
    RETURN jsonb_build_object('status', 'written', 'generation', p_generation);
END;
$$;

-- 7m. The only request-path/admin writer of a session's band columns
-- (FR-024). p_acknowledge false writes the band but leaves the row owed when
-- a newer generation exists; p_from_in_progress keeps /complete's
-- conditional update (status in_progress and resume_expires_at > now()).
CREATE OR REPLACE FUNCTION public.fn_ai_session_bands_write(
    p_session_id uuid, p_generation bigint, p_patch jsonb, p_from_in_progress boolean, p_acknowledge boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_allowed CONSTANT text[] := ARRAY['overall_band', 'band_fc', 'band_lr', 'band_gra', 'band_p', 'status',
                                       'completed_at', 'error_code', 'error_message', 'failed_step',
                                       'last_error_at', 'last_regraded_at', 'last_regraded_by', 'regrade_count'];
    v_session record;
    v_refresh public.ai_deferred_session_refresh;
    v_patch jsonb := p_patch;
    v_row jsonb;
    v_bad text;
BEGIN
    IF p_generation IS NULL OR p_generation < 0 OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
       OR p_from_in_progress IS NULL OR p_acknowledge IS NULL THEN
        RAISE EXCEPTION 'ai_session_bands_invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (c_allowed));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_patch_key_not_allowed: %', v_bad USING ERRCODE = '22023';
    END IF;
    IF v_patch ? 'status' AND v_patch->>'status' IS DISTINCT FROM 'completed'
       AND v_patch->>'status' IS DISTINCT FROM 'grading_failed' THEN
        RAISE EXCEPTION 'ai_session_bands_invalid_status: %', v_patch->>'status' USING ERRCODE = '22023';
    END IF;
    SELECT id, status, resume_expires_at, completed_at INTO v_session
      FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF p_acknowledge AND v_refresh.generation <> p_generation THEN
        RETURN jsonb_build_object('status', 'stale', 'generation', v_refresh.generation);
    END IF;
    IF p_from_in_progress AND NOT (v_session.status = 'in_progress' AND v_session.resume_expires_at > now()) THEN
        RETURN jsonb_build_object('status', 'not_applied');
    END IF;
    -- completed_at is written only while unset (the original completion time).
    IF v_session.completed_at IS NOT NULL THEN
        v_patch := v_patch - 'completed_at';
    END IF;
    PERFORM public.fn_ai_patch_row('sessions', p_session_id, v_patch, c_allowed);
    UPDATE public.ai_deferred_session_refresh
       SET refreshed_generation = LEAST(p_generation, generation), updated_at = now()
     WHERE session_id = p_session_id;
    SELECT to_jsonb(s) INTO v_row FROM public.sessions s WHERE s.id = p_session_id;
    RETURN jsonb_build_object('status', 'written', 'acknowledged',
                              p_acknowledge OR v_refresh.generation = p_generation,
                              'generation', v_refresh.generation, 'session', v_row);
END;
$$;

-- 7n. Class-score sync: the band persisted at this moment onto the recorded
-- hand-in, under the same session → refresh lock as the band writers.
CREATE OR REPLACE FUNCTION public.fn_ai_class_sync(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_band numeric;
    v_item_id uuid;
    v_found_item uuid;
    v_kind text;
    v_artifact uuid;
    v_submitted timestamptz;
    v_refresh public.ai_deferred_session_refresh;
    v_result text;
BEGIN
    SELECT overall_band, class_assignment_item_id INTO v_band, v_item_id
      FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_refresh := public.fn_ai_budget_ensure_refresh(p_session_id);
    IF v_item_id IS NOT NULL THEN
        SELECT id, artifact_kind, artifact_id, submitted_at INTO v_found_item, v_kind, v_artifact, v_submitted
          FROM public.class_assignment_items WHERE id = v_item_id FOR UPDATE;
    END IF;
    IF v_found_item IS NULL
       OR (v_submitted IS NOT NULL
           AND (v_kind IS DISTINCT FROM 'session' OR v_artifact IS DISTINCT FROM p_session_id)) THEN
        v_result := 'no_item';
    ELSIF v_submitted IS NULL THEN
        -- The hand-in is not recorded yet: the sync stays owed.
        RETURN jsonb_build_object('status', 'pending_handin');
    ELSIF v_band IS NULL THEN
        -- Nothing to reflect (sync_class_item_score never writes a null score).
        v_result := 'no_band';
    ELSE
        UPDATE public.class_assignment_items
           SET score = v_band
         WHERE id = v_found_item AND artifact_kind = 'session' AND artifact_id = p_session_id
           AND submitted_at IS NOT NULL;
        v_result := 'synced';
    END IF;
    UPDATE public.ai_deferred_session_refresh
       SET class_synced_generation = refreshed_generation, updated_at = now()
     WHERE session_id = p_session_id;
    RETURN jsonb_build_object('status', v_result, 'class_synced_generation', v_refresh.refreshed_generation);
END;
$$;

-- 10a. Ends one raise (early or expired) with its event and alert.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_record_end(
    p_raise_id uuid, p_end_kind text, p_actor uuid, p_actor_aal text, p_reason text, p_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raise public.ai_budget_raises;
    v_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_counter public.ai_budget_counters;
BEGIN
    UPDATE public.ai_budget_raises
       SET ended_at = now(), end_kind = p_end_kind, ended_by = p_actor, end_reason = p_reason
     WHERE id = p_raise_id AND ended_at IS NULL
    RETURNING * INTO v_raise;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO v_counter FROM public.ai_budget_counters
     WHERE scope = v_raise.scope AND period_kind = 'month' AND period_start = v_month;
    -- effective_month_cap_usd is the cap in force after the event.
    INSERT INTO public.ai_budget_raise_events
        (raise_id, event, scope, amount_usd, base_month_cap_usd, effective_month_cap_usd, expires_at,
         actor_id, actor_aal, request_id, reason)
    VALUES (v_raise.id, p_end_kind, v_raise.scope, v_raise.amount_usd, v_raise.base_month_cap_usd,
            v_raise.base_month_cap_usd, v_raise.expires_at, p_actor, p_actor_aal, p_request_id, p_reason);
    INSERT INTO public.ai_budget_alerts (kind, raise_id, scope, period_kind, period_start, committed_usd, cap_usd)
    VALUES (CASE p_end_kind WHEN 'expired' THEN 'raise_expired' ELSE 'raise_ended' END, v_raise.id,
            v_raise.scope, 'month', v_month, v_counter.settled_usd + v_counter.reserved_usd,
            v_raise.base_month_cap_usd);
END;
$$;

-- 10b. Grant a temporary raise (FR-022). Input refusals write nothing; then
-- the scope's month counter is locked (the reserve function's lock), any
-- expired raise of the scope is recorded as expired, and the state refusals
-- are checked.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_grant(
    p_scope text, p_amount_usd numeric, p_hours integer, p_reason text, p_actor uuid, p_actor_aal text,
    p_base_caps jsonb, p_request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_base_month numeric := (p_base_caps -> p_scope ->> 'month')::numeric;
    v_base_day numeric := (p_base_caps -> p_scope ->> 'day')::numeric;
    v_counter public.ai_budget_counters;
    v_expired uuid;
    v_raise public.ai_budget_raises;
BEGIN
    IF p_actor_aal IS DISTINCT FROM 'aal2' THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'mfa_required');
    END IF;
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'ai_budget_raise_actor_required' USING ERRCODE = '22023';
    END IF;
    IF p_scope IS NULL OR p_scope NOT IN ('google', 'azure', 'openai', 'elevenlabs') THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'scope_not_raisable');
    END IF;
    IF v_base_month IS NULL OR v_base_month <= 0 OR (v_base_day IS NOT NULL AND v_base_day <= 0) THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'scope_config_invalid');
    END IF;
    IF p_amount_usd IS NULL OR p_amount_usd < 1 OR p_amount_usd <> trunc(p_amount_usd)
       OR p_amount_usd > v_base_month THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'amount_out_of_range');
    END IF;
    IF p_hours IS NULL OR p_hours NOT BETWEEN 1 AND 24 THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'duration_out_of_range');
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'reason_invalid');
    END IF;

    v_counter := public.fn_ai_budget_lock_counter(p_scope, 'month', v_month);
    FOR v_expired IN
        SELECT id FROM public.ai_budget_raises
         WHERE scope = p_scope AND ended_at IS NULL AND expires_at <= now()
           FOR UPDATE
    LOOP
        PERFORM public.fn_ai_budget_raise_record_end(v_expired, 'expired', NULL, NULL, NULL, NULL);
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.ai_budget_raises WHERE scope = p_scope AND ended_at IS NULL) THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'raise_active');
    END IF;
    IF (SELECT count(*) FROM public.ai_budget_raises
         WHERE scope = p_scope AND granted_at >= v_month::timestamp AT TIME ZONE 'UTC') >= 3 THEN
        RETURN jsonb_build_object('granted', false, 'error_code', 'raise_limit_reached');
    END IF;

    INSERT INTO public.ai_budget_raises
        (scope, amount_usd, base_month_cap_usd, granted_at, expires_at, granted_by, granted_aal, reason, request_id)
    VALUES (p_scope, p_amount_usd, v_base_month, now(), now() + make_interval(hours => p_hours), p_actor,
            p_actor_aal, btrim(p_reason), p_request_id)
    RETURNING * INTO v_raise;
    INSERT INTO public.ai_budget_raise_events
        (raise_id, event, scope, amount_usd, base_month_cap_usd, effective_month_cap_usd, expires_at,
         actor_id, actor_aal, request_id, reason)
    VALUES (v_raise.id, 'granted', p_scope, p_amount_usd, v_base_month, v_base_month + p_amount_usd,
            v_raise.expires_at, p_actor, p_actor_aal, p_request_id, v_raise.reason);
    INSERT INTO public.ai_budget_alerts (kind, raise_id, scope, period_kind, period_start, committed_usd, cap_usd)
    VALUES ('raise_granted', v_raise.id, p_scope, 'month', v_month,
            v_counter.settled_usd + v_counter.reserved_usd, v_base_month + p_amount_usd);
    RETURN jsonb_build_object('granted', true, 'raise', to_jsonb(v_raise),
                              'effective_month_cap_usd', v_base_month + p_amount_usd,
                              'effective_day_cap_usd', v_base_day + p_amount_usd);
END;
$$;

-- 10c. End an active raise early.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_end(
    p_raise_id uuid, p_actor uuid, p_actor_aal text, p_reason text, p_request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raise public.ai_budget_raises;
BEGIN
    IF p_actor_aal IS DISTINCT FROM 'aal2' THEN
        RETURN jsonb_build_object('ended', false, 'error_code', 'mfa_required');
    END IF;
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'ai_budget_raise_actor_required' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ended', false, 'error_code', 'reason_invalid');
    END IF;
    SELECT * INTO v_raise FROM public.ai_budget_raises WHERE id = p_raise_id FOR UPDATE;
    IF NOT FOUND OR v_raise.ended_at IS NOT NULL OR v_raise.expires_at <= now() THEN
        RETURN jsonb_build_object('ended', false, 'error_code', 'not_active');
    END IF;
    PERFORM public.fn_ai_budget_raise_record_end(p_raise_id, 'ended_early', p_actor, p_actor_aal,
                                                 btrim(p_reason), p_request_id);
    RETURN jsonb_build_object('ended', true, 'raise_id', p_raise_id, 'scope', v_raise.scope,
                              'effective_month_cap_usd', v_raise.base_month_cap_usd);
END;
$$;

-- 10d. Record every raise past expires_at as expired. The cap already
-- reverted at expires_at; this writes the event and the email row.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_raise_expire_sweep(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now timestamptz := LEAST(COALESCE(p_now, now()), now());
    v_id uuid;
    v_count integer := 0;
BEGIN
    FOR v_id IN
        SELECT id FROM public.ai_budget_raises
         WHERE ended_at IS NULL AND expires_at <= v_now
         ORDER BY id FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.fn_ai_budget_raise_record_end(v_id, 'expired', NULL, NULL, NULL, NULL);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- 11. Session generation trigger on responses (FR-024). It locks the
-- session row before the refresh row, so even a response DELETE (which the
-- 224/225 guard does not lock) keeps the global lock order. A session that
-- no longer exists (a cascade delete) is skipped.
CREATE OR REPLACE FUNCTION public.fn_ai_session_generation_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sessions uuid[];
    v_session uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_sessions := ARRAY[NEW.session_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_sessions := ARRAY[OLD.session_id];
    ELSE
        IF NEW.overall_band IS NOT DISTINCT FROM OLD.overall_band
           AND NEW.final_band_p IS NOT DISTINCT FROM OLD.final_band_p
           AND NEW.final_overall_band IS NOT DISTINCT FROM OLD.final_overall_band
           AND NEW.feedback::text IS NOT DISTINCT FROM OLD.feedback::text
           AND NEW.grading_status IS NOT DISTINCT FROM OLD.grading_status THEN
            RETURN NULL;
        END IF;
        v_sessions := ARRAY[OLD.session_id, NEW.session_id];
    END IF;
    FOR v_session IN SELECT DISTINCT s FROM unnest(v_sessions) s WHERE s IS NOT NULL ORDER BY s LOOP
        PERFORM 1 FROM public.sessions WHERE id = v_session FOR UPDATE;
        CONTINUE WHEN NOT FOUND;
        INSERT INTO public.ai_deferred_session_refresh AS r (session_id, generation, updated_at)
        VALUES (v_session, 1, now())
        ON CONFLICT (session_id) DO UPDATE SET generation = r.generation + 1, updated_at = now();
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_ai_session_generation
    AFTER INSERT OR DELETE OR UPDATE OF overall_band, final_band_p, final_overall_band, feedback, grading_status
    ON public.responses
    FOR EACH ROW EXECUTE FUNCTION public.fn_ai_session_generation_bump();

-- Function ACLs: service_role executes the RPCs; helpers, trigger functions
-- and the operator repair are executable by no API role.
REVOKE ALL ON FUNCTION public.fn_ai_budget_raise_events_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_thresholds(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_lock_counter(text, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_alert_crossings(text, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_active_raise(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_response_revision(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_patch_row(text, uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_insert_row(text, jsonb, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_ensure_refresh(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_raise_record_end(uuid, text, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_recompute(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_session_generation_bump() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_ai_budget_reserve(text, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_settle(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_release(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_expire(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_close_scope(text, date, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_save(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_claim(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_commit(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_claim_writing(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_commit_writing(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_aggregate_write(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_session_bands_write(uuid, bigint, jsonb, boolean, boolean)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_class_sync(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_raise_grant(text, numeric, integer, text, uuid, text, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_raise_end(uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_raise_expire_sweep(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.fn_ai_budget_reserve(text, jsonb, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_settle(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_release(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_expire(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_close_scope(text, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_save(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_claim(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_commit(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_claim_writing(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_commit_writing(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_aggregate_write(uuid, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_session_bands_write(uuid, bigint, jsonb, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_class_sync(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_raise_grant(text, numeric, integer, text, uuid, text, jsonb, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_raise_end(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_raise_expire_sweep(timestamptz) TO service_role;

-- 8. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    -- MAINTAIN only exists on PG 17+; has_table_privilege rejects it on PG 16.
    all_privileges CONSTANT text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                            'REFERENCES', 'TRIGGER']
        || CASE WHEN current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
    v_wrong text;
BEGIN
    SELECT string_agg(t.rel, ', ' ORDER BY t.rel) INTO v_wrong
      FROM (VALUES ('public.ai_budget_counters'), ('public.ai_budget_reservations'),
                   ('public.ai_deferred_grading_jobs'), ('public.ai_deferred_session_refresh'),
                   ('public.ai_budget_raises'), ('public.ai_budget_raise_events'),
                   ('public.ai_budget_alerts'), ('public.ai_budget_heartbeat')) t(rel)
     WHERE to_regclass(t.rel) IS NULL
        OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t.rel));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_table_missing_or_rls_off: %', v_wrong;
    END IF;

    -- Effective table privileges: clients nothing, service_role exactly its grant.
    SELECT string_agg(format('%s:%s:%s', t.rel, r.rolname, p.priv), ', '
                      ORDER BY t.rel, r.rolname, p.priv) INTO v_wrong
      FROM (VALUES ('public.ai_budget_counters',          ARRAY['SELECT']),
                   ('public.ai_budget_reservations',      ARRAY['SELECT']),
                   ('public.ai_deferred_grading_jobs',    ARRAY['SELECT', 'INSERT', 'UPDATE']),
                   ('public.ai_deferred_session_refresh', ARRAY['SELECT']),
                   ('public.ai_budget_raises',            ARRAY['SELECT']),
                   ('public.ai_budget_raise_events',      ARRAY['SELECT']),
                   ('public.ai_budget_alerts',            ARRAY['SELECT']),
                   ('public.ai_budget_heartbeat',         ARRAY['SELECT', 'INSERT', 'UPDATE'])
           ) t(rel, service_grant)
     CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     CROSS JOIN unnest(all_privileges) p(priv)
     WHERE has_table_privilege(r.rolname, t.rel, p.priv)
           IS DISTINCT FROM (r.rolname = 'service_role' AND p.priv = ANY (t.service_grant));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_table_privileges_wrong: %', v_wrong;
    END IF;
    SELECT string_agg(format('%s:%s', r.rolname, a.attname), ', ' ORDER BY r.rolname, a.attname) INTO v_wrong
      FROM pg_attribute a
     CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     WHERE a.attrelid = 'public.ai_budget_alerts'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(r.rolname, a.attrelid, a.attnum, 'UPDATE')
           IS DISTINCT FROM (r.rolname = 'service_role'
                             AND a.attname IN ('send_status', 'attempts', 'next_attempt_at', 'sent_at', 'last_error'));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_alert_column_privileges_wrong: %', v_wrong;
    END IF;

    SELECT string_agg(t.idx, ', ' ORDER BY t.idx) INTO v_wrong
      FROM (VALUES ('ux_ai_budget_reservations_key'), ('ux_ai_deferred_grading_jobs_revision'),
                   ('ux_ai_budget_raises_one_active'), ('ux_ai_budget_raise_events_once'),
                   ('ux_ai_budget_alerts_threshold_once'), ('ux_ai_budget_alerts_raise_once')) t(idx)
     WHERE NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relname = t.idx AND i.indisunique AND i.indisvalid);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_unique_index_missing: %', v_wrong;
    END IF;

    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'writing_jobs'
           AND column_name IN ('budget_deferred_at', 'budget_lease_token', 'budget_lease_until',
                               'budget_drain_count', 'budget_persisted_at', 'budget_commit_count')) <> 6 THEN
        RAISE EXCEPTION 'ai_budget_writing_jobs_columns_missing';
    END IF;

    SELECT string_agg(t.rel || '.' || t.name, ', ' ORDER BY t.name) INTO v_wrong
      FROM (VALUES ('public.responses', 'trg_ai_session_generation'),
                   ('public.ai_budget_raise_events', 'trg_ai_budget_raise_events_append_only'),
                   ('public.ai_budget_raise_events', 'trg_ai_budget_raise_events_no_truncate')) t(rel, name)
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid = t.rel::regclass AND g.tgname = t.name AND g.tgenabled = 'O');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_trigger_missing: %', v_wrong;
    END IF;

    -- Function security, search_path and EXECUTE (PUBLIC is grantee 0).
    SELECT string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_ai_budget_raise_events_append_only()', false, false),
                   ('public.fn_ai_budget_thresholds(text,text)', true, false),
                   ('public.fn_ai_budget_lock_counter(text,text,date)', true, false),
                   ('public.fn_ai_budget_alert_crossings(text,text,date)', true, false),
                   ('public.fn_ai_budget_active_raise(text)', true, false),
                   ('public.fn_ai_response_revision(uuid,text)', true, false),
                   ('public.fn_ai_patch_row(text,uuid,jsonb,text[])', true, false),
                   ('public.fn_ai_insert_row(text,jsonb,text[])', true, false),
                   ('public.fn_ai_budget_ensure_refresh(uuid)', true, false),
                   ('public.fn_ai_budget_raise_record_end(uuid,text,uuid,text,text,text)', true, false),
                   ('public.fn_ai_budget_recompute(date)', true, false),
                   ('public.fn_ai_session_generation_bump()', true, false),
                   ('public.fn_ai_budget_reserve(text,jsonb,jsonb,integer)', true, true),
                   ('public.fn_ai_budget_settle(uuid,numeric)', true, true),
                   ('public.fn_ai_budget_release(uuid)', true, true),
                   ('public.fn_ai_budget_expire(timestamptz)', true, true),
                   ('public.fn_ai_budget_close_scope(text,date,text)', true, true),
                   ('public.fn_ai_deferred_save(jsonb,jsonb)', true, true),
                   ('public.fn_ai_deferred_claim(integer,integer)', true, true),
                   ('public.fn_ai_deferred_commit(uuid,uuid,jsonb)', true, true),
                   ('public.fn_ai_deferred_claim_writing(integer,integer)', true, true),
                   ('public.fn_ai_deferred_commit_writing(uuid,uuid,jsonb)', true, true),
                   ('public.fn_ai_deferred_aggregate_write(uuid,bigint,jsonb)', true, true),
                   ('public.fn_ai_session_bands_write(uuid,bigint,jsonb,boolean,boolean)', true, true),
                   ('public.fn_ai_class_sync(uuid)', true, true),
                   ('public.fn_ai_budget_raise_grant(text,numeric,integer,text,uuid,text,jsonb,text)', true, true),
                   ('public.fn_ai_budget_raise_end(uuid,uuid,text,text,text)', true, true),
                   ('public.fn_ai_budget_raise_expire_sweep(timestamptz)', true, true)
           ) f(sig, definer, service_exec)
      JOIN pg_proc p ON p.oid = f.sig::regprocedure
     WHERE p.prosecdef IS DISTINCT FROM f.definer
        OR NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp'])
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM f.service_exec
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        OR p.proacl IS NULL;   -- NULL = default ACL, which includes PUBLIC EXECUTE
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_function_acl_wrong: %', v_wrong;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
