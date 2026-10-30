-- Migration: 340_ai_budget_hardening.sql
--
-- AIBUDGET-0033 hardening (PC-J85), fixing the Security Auditor's read-only
-- audit of migration 333 (PC-J67, 2026-10-29, staging 8f639ee1b): three P2
-- and two P3 findings. 333 is already applied on staging and is never edited;
-- this forward file replaces five 333 function bodies, adds one internal
-- helper and five CHECK constraints, and extends the postconditions. It
-- writes no business data. Every 333 RPC keeps its name, arguments, return
-- type, owner, SECURITY DEFINER, pinned search_path and ACL (16 RPCs
-- executable by service_role, 12 helpers by no API role).
--
--   F01 (P2) Non-finite money. numeric accepts 'NaN' (a valid JSON string),
--       and 'NaN' <= 0 is false, so a NaN cap granted past the cap and a NaN
--       actual turned the provider and total counters into NaN (333 :601,
--       :673, :680, :688, :760, :763, :779). Now:
--       - the new internal fn_ai_budget_assert_finite(numeric, text) raises
--         SQLSTATE 22023 `ai_budget_non_finite_amount: <field>` for NaN,
--         Infinity and -Infinity (NULL passes; callers keep their own NULL
--         rules). No API role may execute it;
--       - fn_ai_budget_reserve checks every month/day cap of every scope in
--         p_caps (hard, soft and total alike) and every estimate before any
--         counter row is created or locked; fn_ai_budget_settle checks the
--         actual; fn_ai_budget_raise_grant checks the amount and the base
--         month/day caps before any write;
--       - CHECK constraints *_finite_usd on every money column of
--         ai_budget_counters (cap, settled, reserved; 333 :154),
--         ai_budget_reservations (estimate, actual; :173, :174),
--         ai_budget_raises, ai_budget_raise_events and ai_budget_alerts, added
--         NOT VALID and then validated. Existing non-finite rows abort the
--         migration with `ai_budget_non_finite_rows: <table>=<count>`; they
--         are never rewritten here (repair is a Leader decision).
--   F02 (P2) Empty Speaking result. fn_ai_deferred_commit defaulted a
--       missing `response` to {} and committed it: the response became
--       `completed` with no transcript or band and the job became `done`, so
--       nothing graded it again (333 :1102-1143). It now raises 22023
--       `ai_deferred_commit_invalid_result` for a null or non-object
--       p_result or `response`, an empty `response`, and
--       `ai_deferred_commit_result_incomplete: <field>` when a field the live
--       success mapper always writes is missing. The required set comes from
--       routers/grading.py at f69055f65 (STEP 7, the db_row of a successful grade):
--       - overall_band  :1058 `db_row["overall_band"] = grading["overall_band"]`
--                       -> a JSON number between 0 and 9;
--       - feedback      :1080 `db_row["feedback"] = _serialize_feedback(...)`
--                       -> a non-empty JSON object, or a non-blank JSON
--                          string that is not "{}"/"null";
--       - transcript    :1022 `"transcript": transcript`, never empty for a
--                       graded answer (:717 rejects an empty transcript with
--                       422) -> non-blank after the patch: the patch value,
--                       or the stored one when the patch omits it (plan.md
--                       :428, the drain may keep the stored transcript);
--       - stt_status    :1031 `"stt_status": "completed"` -> 'completed'
--                       after the patch (patch value, else the stored one);
--       - grading_status :1032 stays the function's own 'completed' write.
--       A refusal raises, so the whole call rolls back: no response write, no
--       marker, persisted_at stays NULL, the job stays `running` and is
--       claimed again after its lease. A canonical payload commits once.
--   F03 (P2) Rollback guard. The 333 down script ignored a class-score sync
--       still owed (class_synced_generation < refreshed_generation; 333 :69,
--       :115, :221, :1426), so it could drop the obligation while
--       class_assignment_items.score was stale. 333's header cannot change
--       (applied); use ROLLBACK (b) below instead of it.
--   F04 (P3) Stale Writing worker. fn_ai_deferred_commit_writing checked the
--       token but not the job state (333 :1217-1229), so a worker whose job
--       had been returned to `queued` or `failed` with the token still set
--       could commit. It now returns `lease_lost` unless writing_jobs.status
--       = 'running', like Speaking (333 :1119). A reclaimed job (new token,
--       `running`) still commits.
--   F05 (P3) Residual policies. The postcondition now refuses any pg_policy
--       row on the eight budget tables (`ai_budget_policy_present:
--       <table>.<policy>`). Nothing is dropped automatically.
--
-- Caller contract changes (handed to T003/T006/T007, no backend change here):
--   - Any RPC may now raise 22023 `ai_budget_non_finite_amount`. T003 checks
--     estimates/actuals are finite before the RPC and treats every RPC error
--     as FR-005 (not only 22023).
--   - T006 validates the Speaking result before fn_ai_deferred_commit; a
--     refused payload leaves the job to be reclaimed after its lease.
--   - T007 returns a Writing job to `queued` (and clears the token and
--     lease) in one mutation; only a `running` job commits.
--
-- Order. Needs 333 (the precondition aborts without its 8 tables and 28
-- functions). Same forward-policy group as 333: apply with
-- MIGRATION_FEATURES=ai_budget through the advisory-locked runner, on staging
-- first and on production only at an authorised staging -> main promotion
-- together with 333, before the 0033 backend. One transaction,
-- lock_timeout 5s, re-runnable, runs as the NOSUPERUSER owner. Re-running
-- 333 after 340 would restore the weak bodies: re-run 340 after it.
--
-- ROLLBACK. A new forward migration (never an edit of this file or of 333),
-- approved and run by the Leader.
--
-- ROLLBACK (a): down 340 only, keeping 333. Not needed before (b), which drops
-- the helper and every table with its constraints itself. Paste the five 333
-- function blocks verbatim where marked (333 sections 7a fn_ai_budget_reserve,
-- 7b fn_ai_budget_settle, 7i fn_ai_deferred_commit, 7k
-- fn_ai_deferred_commit_writing, 10b fn_ai_budget_raise_grant; CREATE OR
-- REPLACE keeps owner and ACL), so the helper is dropped only after nothing
-- calls it:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   -- <the five 333 function blocks, verbatim>
--   ALTER TABLE public.ai_budget_counters DROP CONSTRAINT IF EXISTS ai_budget_counters_finite_usd;
--   ALTER TABLE public.ai_budget_reservations DROP CONSTRAINT IF EXISTS ai_budget_reservations_finite_usd;
--   ALTER TABLE public.ai_budget_raises DROP CONSTRAINT IF EXISTS ai_budget_raises_finite_usd;
--   ALTER TABLE public.ai_budget_raise_events DROP CONSTRAINT IF EXISTS ai_budget_raise_events_finite_usd;
--   ALTER TABLE public.ai_budget_alerts DROP CONSTRAINT IF EXISTS ai_budget_alerts_finite_usd;
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_assert_finite(numeric, text);
--   COMMIT;
--
-- ROLLBACK (b): down the whole ai_budget group (333 + 340), after the
-- pre-0033 backend is deployed. It replaces the 333 header script: same
-- guards plus the class-sync guard (F03), with the writers locked out first
-- so no owed work appears between the guards and the drops. Export
-- ai_budget_raise_events first (\copy public.ai_budget_raise_events TO
-- 'raise-events.csv' CSV HEADER); the table, its append-only trigger and that
-- trigger's function are kept as the audit record.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   LOCK TABLE public.responses, public.writing_jobs, public.ai_deferred_grading_jobs,
--       public.ai_deferred_session_refresh, public.ai_budget_raises IN SHARE ROW EXCLUSIVE MODE;
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
--       IF EXISTS (SELECT 1 FROM public.ai_deferred_session_refresh r
--                    JOIN public.sessions s ON s.id = r.session_id AND s.class_assignment_item_id IS NOT NULL
--                   WHERE r.class_synced_generation < r.refreshed_generation) THEN
--           RAISE EXCEPTION 'rollback_unsafe_class_sync_owed';
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
--   DROP FUNCTION IF EXISTS public.fn_ai_budget_assert_finite(numeric, text);
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

-- 0. Preconditions: every 333 table and function.
DO $$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(x.name, ', ' ORDER BY x.name) INTO v_missing FROM (
        SELECT t.rel AS name
          FROM (VALUES ('ai_budget_counters'), ('ai_budget_reservations'), ('ai_deferred_grading_jobs'),
                       ('ai_deferred_session_refresh'), ('ai_budget_raises'), ('ai_budget_raise_events'),
                       ('ai_budget_alerts'), ('ai_budget_heartbeat')) t(rel)
         WHERE to_regclass('public.' || t.rel) IS NULL
        UNION ALL
        SELECT f.sig
          FROM (VALUES ('fn_ai_budget_raise_events_append_only()'), ('fn_ai_budget_thresholds(text,text)'),
                       ('fn_ai_budget_lock_counter(text,text,date)'), ('fn_ai_budget_alert_crossings(text,text,date)'),
                       ('fn_ai_budget_active_raise(text)'), ('fn_ai_response_revision(uuid,text)'),
                       ('fn_ai_patch_row(text,uuid,jsonb,text[])'), ('fn_ai_insert_row(text,jsonb,text[])'),
                       ('fn_ai_budget_ensure_refresh(uuid)'),
                       ('fn_ai_budget_raise_record_end(uuid,text,uuid,text,text,text)'),
                       ('fn_ai_budget_recompute(date)'), ('fn_ai_session_generation_bump()'),
                       ('fn_ai_budget_reserve(text,jsonb,jsonb,integer)'), ('fn_ai_budget_settle(uuid,numeric)'),
                       ('fn_ai_budget_release(uuid)'), ('fn_ai_budget_expire(timestamptz)'),
                       ('fn_ai_budget_close_scope(text,date,text)'), ('fn_ai_deferred_save(jsonb,jsonb)'),
                       ('fn_ai_deferred_claim(integer,integer)'), ('fn_ai_deferred_commit(uuid,uuid,jsonb)'),
                       ('fn_ai_deferred_claim_writing(integer,integer)'),
                       ('fn_ai_deferred_commit_writing(uuid,uuid,jsonb)'),
                       ('fn_ai_deferred_aggregate_write(uuid,bigint,jsonb)'),
                       ('fn_ai_session_bands_write(uuid,bigint,jsonb,boolean,boolean)'),
                       ('fn_ai_class_sync(uuid)'),
                       ('fn_ai_budget_raise_grant(text,numeric,integer,text,uuid,text,jsonb,text)'),
                       ('fn_ai_budget_raise_end(uuid,uuid,text,text,text)'),
                       ('fn_ai_budget_raise_expire_sweep(timestamptz)')) f(sig)
         WHERE to_regprocedure('public.' || f.sig) IS NULL) x;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_hardening_requires_333: %', v_missing;
    END IF;
END $$;

-- 1. F01: finite money columns. Added NOT VALID first (new writes are checked
-- from here on), then existing rows are counted and reported, never fixed,
-- then validated.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_budget_counters'::regclass
                                                 AND conname = 'ai_budget_counters_finite_usd') THEN
        ALTER TABLE public.ai_budget_counters ADD CONSTRAINT ai_budget_counters_finite_usd CHECK (
            cap_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND settled_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND reserved_usd NOT IN ('NaN', 'Infinity', '-Infinity')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_budget_reservations'::regclass
                                                 AND conname = 'ai_budget_reservations_finite_usd') THEN
        ALTER TABLE public.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_finite_usd CHECK (
            estimate_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND actual_usd NOT IN ('NaN', 'Infinity', '-Infinity')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_budget_raises'::regclass
                                                 AND conname = 'ai_budget_raises_finite_usd') THEN
        ALTER TABLE public.ai_budget_raises ADD CONSTRAINT ai_budget_raises_finite_usd CHECK (
            amount_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND base_month_cap_usd NOT IN ('NaN', 'Infinity', '-Infinity')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_budget_raise_events'::regclass
                                                 AND conname = 'ai_budget_raise_events_finite_usd') THEN
        ALTER TABLE public.ai_budget_raise_events ADD CONSTRAINT ai_budget_raise_events_finite_usd CHECK (
            amount_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND base_month_cap_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND effective_month_cap_usd NOT IN ('NaN', 'Infinity', '-Infinity')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_budget_alerts'::regclass
                                                 AND conname = 'ai_budget_alerts_finite_usd') THEN
        ALTER TABLE public.ai_budget_alerts ADD CONSTRAINT ai_budget_alerts_finite_usd CHECK (
            committed_usd NOT IN ('NaN', 'Infinity', '-Infinity')
            AND cap_usd NOT IN ('NaN', 'Infinity', '-Infinity')) NOT VALID;
    END IF;
END $$;

DO $$
DECLARE
    v_t record;
    v_pred text;
    v_count bigint;
    v_bad text;
BEGIN
    FOR v_t IN
        SELECT * FROM (VALUES
            ('ai_budget_counters', ARRAY['cap_usd', 'settled_usd', 'reserved_usd']),
            ('ai_budget_reservations', ARRAY['estimate_usd', 'actual_usd']),
            ('ai_budget_raises', ARRAY['amount_usd', 'base_month_cap_usd']),
            ('ai_budget_raise_events', ARRAY['amount_usd', 'base_month_cap_usd', 'effective_month_cap_usd']),
            ('ai_budget_alerts', ARRAY['committed_usd', 'cap_usd'])) t(rel, cols)
    LOOP
        SELECT string_agg(format('%I IN (''NaN'', ''Infinity'', ''-Infinity'')', c), ' OR ') INTO v_pred
          FROM unnest(v_t.cols) c;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_t.rel, v_pred) INTO v_count;
        IF v_count > 0 THEN
            v_bad := concat_ws(', ', v_bad, format('%s=%s', v_t.rel, v_count));
        END IF;
    END LOOP;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_non_finite_rows: %', v_bad
            USING HINT = 'Migration 340 never rewrites budget rows; the Leader decides the repair.';
    END IF;
END $$;

ALTER TABLE public.ai_budget_counters VALIDATE CONSTRAINT ai_budget_counters_finite_usd;
ALTER TABLE public.ai_budget_reservations VALIDATE CONSTRAINT ai_budget_reservations_finite_usd;
ALTER TABLE public.ai_budget_raises VALIDATE CONSTRAINT ai_budget_raises_finite_usd;
ALTER TABLE public.ai_budget_raise_events VALIDATE CONSTRAINT ai_budget_raise_events_finite_usd;
ALTER TABLE public.ai_budget_alerts VALIDATE CONSTRAINT ai_budget_alerts_finite_usd;

-- 2. F01: the internal finite check. NULL passes; the caller keeps its own
-- NULL rule.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_assert_finite(p_value numeric, p_field text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_value IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'ai_budget_non_finite_amount: %', p_field USING ERRCODE = '22023';
    END IF;
    RETURN p_value;
END;
$$;

-- 3. Reserve (333 7a) with F01: every cap and every estimate is finite before
-- any counter row is created or locked.
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
    -- F01: hard, soft and total caps alike, touched by this bundle or not.
    FOR v_scope, v_cap IN SELECT key, value FROM jsonb_each(p_caps) LOOP
        CONTINUE WHEN jsonb_typeof(v_cap) <> 'object';
        FOREACH v_kind IN ARRAY ARRAY['month', 'day'] LOOP
            PERFORM public.fn_ai_budget_assert_finite((v_cap->>v_kind)::numeric,
                                                      'caps.' || v_scope || '.' || v_kind);
        END LOOP;
    END LOOP;

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
        v_estimate := public.fn_ai_budget_assert_finite((v_line->>'estimate_usd')::numeric, 'estimate_usd');
        v_estimate := ceil(v_estimate * 1000000) / 1000000;
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

-- 4. Settle (333 7b) with F01: the actual is finite before any lock.
CREATE OR REPLACE FUNCTION public.fn_ai_budget_settle(p_reservation_id uuid, p_actual_usd numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_res public.ai_budget_reservations;
    v_actual numeric;
    v_key record;
BEGIN
    v_actual := round(public.fn_ai_budget_assert_finite(p_actual_usd, 'actual_usd'), 6);
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

-- 5. Deferred Speaking commit (333 7i) with F02: the result must carry what
-- the live success mapper writes (header), or nothing is written.
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
    v_patch jsonb := p_result->'response';
    v_recs jsonb := COALESCE(p_result->'grammar_recommendations', '[]'::jsonb);
    v_session_status text;
BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
       OR v_patch IS NULL OR jsonb_typeof(v_patch) <> 'object' OR v_patch = '{}'::jsonb
       OR jsonb_typeof(v_recs) <> 'array' OR v_patch ? 'grading_status' THEN
        RAISE EXCEPTION 'ai_deferred_commit_invalid_result' USING ERRCODE = '22023';
    END IF;
    IF NOT COALESCE(jsonb_typeof(v_patch->'overall_band') = 'number'
                    AND (v_patch->>'overall_band')::numeric BETWEEN 0 AND 9, false) THEN
        RAISE EXCEPTION 'ai_deferred_commit_result_incomplete: overall_band' USING ERRCODE = '22023';
    END IF;
    IF NOT COALESCE(CASE jsonb_typeof(v_patch->'feedback')
                        WHEN 'object' THEN v_patch->'feedback' <> '{}'::jsonb
                        WHEN 'string' THEN btrim(v_patch->>'feedback') NOT IN ('', '{}', 'null')
                        ELSE false END, false) THEN
        RAISE EXCEPTION 'ai_deferred_commit_result_incomplete: feedback' USING ERRCODE = '22023';
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
    SELECT id, session_id, audio_storage_path, transcript, stt_status INTO v_response
      FROM public.responses WHERE id = v_job.resource_id FOR UPDATE;
    IF NOT FOUND OR public.fn_ai_response_revision(v_response.id, v_response.audio_storage_path)
                    IS DISTINCT FROM v_job.submission_revision THEN
        UPDATE public.ai_deferred_grading_jobs
           SET status = 'superseded', finished_at = now(), lease_until = NULL
         WHERE id = p_job_id;
        RETURN jsonb_build_object('status', 'superseded');
    END IF;
    -- The stored transcript/STT status count when the patch leaves them out.
    IF COALESCE(btrim(CASE WHEN v_patch ? 'transcript' THEN v_patch->>'transcript'
                           ELSE v_response.transcript END), '') = '' THEN
        RAISE EXCEPTION 'ai_deferred_commit_result_incomplete: transcript' USING ERRCODE = '22023';
    END IF;
    IF (CASE WHEN v_patch ? 'stt_status' THEN v_patch->>'stt_status' ELSE v_response.stt_status END)
       IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'ai_deferred_commit_result_incomplete: stt_status' USING ERRCODE = '22023';
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

-- 6. Deferred Writing commit (333 7k) with F04: only a `running` job's
-- current token commits.
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
    IF v_job.status IS DISTINCT FROM 'running' OR v_job.budget_lease_token IS NULL
       OR v_job.budget_lease_token IS DISTINCT FROM p_lease_token THEN
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

-- 7. Raise grant (333 10b) with F01: the amount and the base caps are finite
-- before any check or write.
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
    PERFORM public.fn_ai_budget_assert_finite(p_amount_usd, 'amount_usd');
    PERFORM public.fn_ai_budget_assert_finite(v_base_month, 'base_caps.month');
    PERFORM public.fn_ai_budget_assert_finite(v_base_day, 'base_caps.day');
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

-- 8. ACLs, restated so a re-run converges: the helper is executable by no API
-- role; the five replaced RPCs keep service_role EXECUTE only.
REVOKE ALL ON FUNCTION public.fn_ai_budget_assert_finite(numeric, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_reserve(text, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_settle(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_commit(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_deferred_commit_writing(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_budget_raise_grant(text, numeric, integer, text, uuid, text, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_reserve(text, jsonb, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_settle(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_commit(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_deferred_commit_writing(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_budget_raise_grant(text, numeric, integer, text, uuid, text, jsonb, text)
    TO service_role;

-- 9. Postconditions (the transaction aborts on any mismatch).
DO $$
DECLARE
    v_wrong text;
BEGIN
    -- F05: RLS with no policy on every budget table.
    SELECT string_agg(c.relname || '.' || p.polname, ', ' ORDER BY c.relname, p.polname) INTO v_wrong
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polrelid IN ('public.ai_budget_counters'::regclass, 'public.ai_budget_reservations'::regclass,
                          'public.ai_deferred_grading_jobs'::regclass, 'public.ai_deferred_session_refresh'::regclass,
                          'public.ai_budget_raises'::regclass, 'public.ai_budget_raise_events'::regclass,
                          'public.ai_budget_alerts'::regclass, 'public.ai_budget_heartbeat'::regclass);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_policy_present: %', v_wrong
            USING HINT = 'Migration 340 drops no policy; the Leader removes it after review.';
    END IF;

    SELECT string_agg(t.con, ', ' ORDER BY t.con) INTO v_wrong
      FROM (VALUES ('public.ai_budget_counters', 'ai_budget_counters_finite_usd'),
                   ('public.ai_budget_reservations', 'ai_budget_reservations_finite_usd'),
                   ('public.ai_budget_raises', 'ai_budget_raises_finite_usd'),
                   ('public.ai_budget_raise_events', 'ai_budget_raise_events_finite_usd'),
                   ('public.ai_budget_alerts', 'ai_budget_alerts_finite_usd')) t(rel, con)
     WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k
                        WHERE k.conrelid = t.rel::regclass AND k.conname = t.con
                          AND k.contype = 'c' AND k.convalidated
                          AND pg_get_constraintdef(k.oid) LIKE '%NaN%Infinity%-Infinity%');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_finite_constraint_missing: %', v_wrong;
    END IF;

    -- The hardened bodies are the installed ones.
    SELECT string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_ai_budget_reserve(text,jsonb,jsonb,integer)', 'fn_ai_budget_assert_finite'),
                   ('public.fn_ai_budget_settle(uuid,numeric)', 'fn_ai_budget_assert_finite'),
                   ('public.fn_ai_budget_raise_grant(text,numeric,integer,text,uuid,text,jsonb,text)',
                    'fn_ai_budget_assert_finite'),
                   ('public.fn_ai_deferred_commit(uuid,uuid,jsonb)', 'ai_deferred_commit_result_incomplete'),
                   ('public.fn_ai_deferred_commit_writing(uuid,uuid,jsonb)',
                    'v_job.status IS DISTINCT FROM ''running''')) f(sig, marker)
      JOIN pg_proc p ON p.oid = f.sig::regprocedure
     WHERE strpos(p.prosrc, f.marker) = 0;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_budget_hardening_body_missing: %', v_wrong;
    END IF;

    -- Function security, search_path and EXECUTE (PUBLIC is grantee 0), the
    -- 333 contract plus the helper.
    SELECT string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_ai_budget_raise_events_append_only()', false, false),
                   ('public.fn_ai_budget_assert_finite(numeric,text)', true, false),
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
