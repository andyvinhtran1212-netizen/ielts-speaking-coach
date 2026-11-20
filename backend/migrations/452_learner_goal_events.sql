-- G09-T04b / ADMINIA-0074 FR-030 (plan 5.4 POST /admin/learners/{ref}/goal/resolve).
-- When the admin's goal (students.target_band/target_date) and the learner's
-- own (users.target_band/exam_date) differ, the admin picks one source and it
-- is written to BOTH rows, with one append-only event row, in one transaction.
-- Number 452 is from the G09 reserve band 452–459, chosen by anh Andy on
-- 20/11 ("Migration 452, bảng mới").
--
-- Apply through the advisory-locked runner, staging first. Every apply needs
-- anh Andy's own typed approval for that window; this PR does not authorize
-- any hosted apply. Rollback: rollback/452_learner_goal_events.sql (refuses
-- once a goal was resolved).
--
-- Backend-only (spec 0039): RLS on, no policy, no grant to anon/authenticated.
-- service_role reads the events and writes only through
-- fn_learner_goal_resolve. The event row keeps the ids without foreign keys,
-- so an account removal is never blocked by this history (like
-- admin_settings_log.actor_id, mig 440).

BEGIN;
SET LOCAL lock_timeout = '5s';
-- service_role can CREATE in public; exclude it from builtin resolution.
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.learner_goal_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id uuid NOT NULL,
    user_id uuid NOT NULL,
    used text NOT NULL CHECK (used IN ('admin', 'learner')),
    -- {admin: {target_band, target_date}, learner: {target_band, exam_date}}
    before jsonb NOT NULL CHECK (jsonb_typeof(before) = 'object'),
    -- {target_band, target_date}: the value now stored in both rows
    after jsonb NOT NULL CHECK (jsonb_typeof(after) = 'object'),
    actor_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_learner_goal_events_student_created
    ON public.learner_goal_events (student_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_learner_goal_events_user_created
    ON public.learner_goal_events (user_id, created_at DESC, id DESC);

-- Append-only like admin_settings_log (mig 440): no UPDATE, DELETE or
-- TRUNCATE, enforced by triggers as well as by the missing privileges.
CREATE OR REPLACE FUNCTION public.fn_learner_goal_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
        'learner_goal_events chỉ THÊM: không sửa, không xoá (mig 452).';
END;
$$;
REVOKE ALL ON FUNCTION public.fn_learner_goal_events_append_only()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_learner_goal_events_append_only
    BEFORE UPDATE OR DELETE ON public.learner_goal_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_learner_goal_events_append_only();
CREATE OR REPLACE TRIGGER trg_learner_goal_events_no_truncate
    BEFORE TRUNCATE ON public.learner_goal_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_learner_goal_events_append_only();

ALTER TABLE public.learner_goal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learner_goal_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.learner_goal_events TO service_role;

-- Copy one source's goal onto both rows and log it. Refuses with
-- `no_conflict` unless some field (band or date) is held by both sources with
-- different values (the same rule as the overview's `goal.conflict`), and
-- with `learner_not_linked` unless the profile belongs to that account. A
-- field the chosen source leaves empty keeps the other source's value, so
-- choosing never erases information. Both rows are locked first, so two
-- admins resolving at once cannot interleave.
CREATE OR REPLACE FUNCTION public.fn_learner_goal_resolve(
    p_student_id uuid, p_user_id uuid, p_use text, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s_band numeric;
    s_date date;
    u_band numeric;
    u_date date;
    new_band numeric;
    new_date date;
    chosen jsonb;
BEGIN
    IF p_use IS NULL OR p_use NOT IN ('admin', 'learner') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'learner_goal_use_invalid';
    END IF;
    SELECT s.target_band, s.target_date INTO s_band, s_date
      FROM public.students s
     WHERE s.id = p_student_id AND s.user_id = p_user_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'learner_not_linked';
    END IF;
    SELECT u.target_band, u.exam_date INTO u_band, u_date
      FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'learner_not_linked';
    END IF;
    IF NOT ((s_band IS NOT NULL AND u_band IS NOT NULL AND s_band <> u_band)
            OR (s_date IS NOT NULL AND u_date IS NOT NULL AND s_date <> u_date)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_conflict';
    END IF;

    IF p_use = 'admin' THEN
        new_band := COALESCE(s_band, u_band); new_date := COALESCE(s_date, u_date);
    ELSE
        new_band := COALESCE(u_band, s_band); new_date := COALESCE(u_date, s_date);
    END IF;
    UPDATE public.students SET target_band = new_band, target_date = new_date WHERE id = p_student_id;
    UPDATE public.users SET target_band = new_band, exam_date = new_date WHERE id = p_user_id;

    chosen := pg_catalog.jsonb_build_object('target_band', new_band, 'target_date', new_date);
    INSERT INTO public.learner_goal_events (student_id, user_id, used, before, after, actor_id)
    VALUES (p_student_id, p_user_id, p_use,
            pg_catalog.jsonb_build_object(
                'admin', pg_catalog.jsonb_build_object('target_band', s_band, 'target_date', s_date),
                'learner', pg_catalog.jsonb_build_object('target_band', u_band, 'exam_date', u_date)),
            chosen, p_actor);
    RETURN chosen;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_learner_goal_resolve(uuid, uuid, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_learner_goal_resolve(uuid, uuid, text, uuid) TO service_role;

DO $postcondition$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class
                WHERE oid = 'public.learner_goal_events'::regclass AND NOT relrowsecurity) THEN
        RAISE EXCEPTION 'learner_goal_events_452_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.learner_goal_events'::regclass) THEN
        RAISE EXCEPTION 'learner_goal_events_452_unexpected_policy';
    END IF;
    IF has_table_privilege('anon', 'public.learner_goal_events', 'SELECT')
       OR has_table_privilege('authenticated', 'public.learner_goal_events', 'SELECT')
       OR has_table_privilege('service_role', 'public.learner_goal_events', 'UPDATE')
       OR has_table_privilege('service_role', 'public.learner_goal_events', 'DELETE')
       OR has_function_privilege('anon', 'public.fn_learner_goal_resolve(uuid, uuid, text, uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_learner_goal_resolve(uuid, uuid, text, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'learner_goal_events_452_unexpected_privilege';
    END IF;
END;
$postcondition$;

COMMIT;
