-- G09-T22 / ADMINIA-0074 FR-080, FR-081, FR-084 (plan 5.3 row 440, 5.6).
-- Admin settings store plus an append-only change log, and the
-- `ops_thresholds` key seeded with the proposed defaults of plan 5.6.
--
-- Apply through the advisory-locked runner, staging first. Every apply needs
-- anh Andy's own typed approval for that window; this PR does not authorize
-- any hosted apply. Rollback: rollback/440_admin_settings.sql (refuses once an
-- admin has changed a setting).
--
-- Both tables are backend-only (spec 0039): RLS on, no policy for
-- anon/authenticated, service_role reads and writes through
-- fn_admin_settings_merge, which writes the new value and its log row in one
-- transaction. Plan 5.6 defaults also live in services/ops_thresholds.py,
-- which is the only other place the numbers may appear (plan section 8).

BEGIN;
SET LOCAL lock_timeout = '5s';
-- service_role can CREATE in public; exclude it from builtin resolution.
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.admin_settings (
    key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
    value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_settings_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    actor_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_admin_settings_log_key_created
    ON public.admin_settings_log (key, created_at DESC, id DESC);

-- Append-only like class_action_log (mig 198/356): no UPDATE, DELETE or
-- TRUNCATE, enforced by triggers as well as by the missing privileges.
CREATE OR REPLACE FUNCTION public.fn_admin_settings_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
        'admin_settings_log chỉ THÊM: không sửa, không xoá (mig 440).';
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_settings_log_append_only()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_admin_settings_log_append_only
    BEFORE UPDATE OR DELETE ON public.admin_settings_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_admin_settings_log_append_only();
CREATE OR REPLACE TRIGGER trg_admin_settings_log_no_truncate
    BEFORE TRUNCATE ON public.admin_settings_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_admin_settings_log_append_only();

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.admin_settings_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.admin_settings TO service_role;
GRANT SELECT, INSERT ON public.admin_settings_log TO service_role;

-- Merge `p_changes` into the object stored under `p_key` and log old -> new,
-- in one transaction. A merge that changes nothing writes nothing. The
-- advisory lock serialises writers of one key, including the first write of a
-- key that has no row yet.
CREATE OR REPLACE FUNCTION public.fn_admin_settings_merge(
    p_key text, p_changes jsonb, p_reason text, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    previous jsonb;
    merged jsonb;
BEGIN
    IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_settings_changes_not_object';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key, 440));
    SELECT s.value INTO previous FROM public.admin_settings s WHERE s.key = p_key FOR UPDATE;
    merged := COALESCE(previous, '{}'::jsonb) OPERATOR(pg_catalog.||) p_changes;
    IF previous IS NOT DISTINCT FROM merged THEN
        RETURN pg_catalog.jsonb_build_object('value', merged, 'changed', false);
    END IF;
    INSERT INTO public.admin_settings AS s (key, value, updated_by, updated_at)
    VALUES (p_key, merged, p_actor, pg_catalog.now())
    ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
    INSERT INTO public.admin_settings_log (key, old_value, new_value, reason, actor_id)
    VALUES (p_key, previous, merged, p_reason, p_actor);
    RETURN pg_catalog.jsonb_build_object('value', merged, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_settings_merge(text, jsonb, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_settings_merge(text, jsonb, text, uuid) TO service_role;

-- Plan 5.6 proposed defaults (Q15: the owner edits them on /admin/settings).
-- The two retention rows are read-only and come from G04 configuration, and
-- the two GOI-12 rows load only when that part opens, so none is stored here.
INSERT INTO public.admin_settings (key, value)
VALUES ('ops_thresholds', jsonb_build_object(
    'order_confirm_hours', 24,
    'writing_review_hours', 48,
    'regrade_hours', 48,
    'speaking_mock_hours', 72,
    'incident_unclaimed_hours', 24,
    'feedback_unanswered_hours', 72,
    'late_streak_count', 2,
    'inactive_days', 7,
    'course_expiring_days', 7,
    'low_credits', 3,
    'code_expiring_days', 14,
    'exam_idle_minutes', 5,
    'import_error_report_days', 30,
    'too_fast_sec_per_question', NULL,
    'many_retakes_count', NULL,
    'stalled_hours', 24,
    'lesson_review_pct', 60,
    'survey_min_respondents', 5,
    'survey_remaining_sessions', NULL,
    'band_dist_min_papers', NULL
))
ON CONFLICT (key) DO NOTHING;

DO $postcondition$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class
                WHERE oid IN ('public.admin_settings'::regclass, 'public.admin_settings_log'::regclass)
                  AND NOT relrowsecurity) THEN
        RAISE EXCEPTION 'admin_settings_440_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid IN ('public.admin_settings'::regclass, 'public.admin_settings_log'::regclass)) THEN
        RAISE EXCEPTION 'admin_settings_440_unexpected_policy';
    END IF;
    IF has_table_privilege('anon', 'public.admin_settings', 'SELECT')
       OR has_table_privilege('authenticated', 'public.admin_settings', 'SELECT')
       OR has_table_privilege('anon', 'public.admin_settings_log', 'SELECT')
       OR has_table_privilege('authenticated', 'public.admin_settings_log', 'SELECT')
       OR has_table_privilege('service_role', 'public.admin_settings_log', 'UPDATE')
       OR has_table_privilege('service_role', 'public.admin_settings_log', 'DELETE') THEN
        RAISE EXCEPTION 'admin_settings_440_unexpected_privilege';
    END IF;
END;
$postcondition$;

COMMIT;
