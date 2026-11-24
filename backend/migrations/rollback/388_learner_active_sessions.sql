-- Rollback of 388_learner_active_sessions.sql (COURSEACCESS-0055 T009).
-- Order: turn runtime flag `single_session_learners` off first (live within
-- 15 s), deploy the preceding backend, and roll back 389 (G04-T16, spec label "387", which
-- depends on this table) before this file (rollout.md spec labels: 387 before 384, i.e. real 389 before 388).
-- The start triggers only take a lock; dropping them changes no timed work.
-- Dropping the table is allowed (spec T009 step 1): it holds no learning data,
-- only which Auth session is current. No Auth session is touched; every
-- device stays signed in. Needs the same typed approval as the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $guard$
BEGIN
    IF pg_catalog.to_regclass('public.learner_login_events') IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'learner_login_events (389) still exists; roll back 389 before 388';
    END IF;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_learner_session_reading_start_ins ON public.reading_test_attempts;
DROP TRIGGER IF EXISTS trg_learner_session_reading_start_upd ON public.reading_test_attempts;
DROP TRIGGER IF EXISTS trg_learner_session_item_start_ins ON public.class_assignment_items;
DROP TRIGGER IF EXISTS trg_learner_session_item_start_upd ON public.class_assignment_items;
DROP TRIGGER IF EXISTS trg_learner_session_sitting_start_ins ON public.mock_exam_sittings;
DROP TRIGGER IF EXISTS trg_learner_session_sitting_start_upd ON public.mock_exam_sittings;
DROP TRIGGER IF EXISTS trg_learner_session_exam_start_upd ON public.mock_exams;
DROP FUNCTION IF EXISTS public.learner_session_guard_exam_start();
DROP FUNCTION IF EXISTS public.learner_session_guard_item_start();
DROP FUNCTION IF EXISTS public.learner_session_guard_user_start();
DROP FUNCTION IF EXISTS public.learner_session_guard_start(uuid, boolean);
DROP FUNCTION IF EXISTS public.learner_session_lock(uuid);
DROP TABLE IF EXISTS public.learner_active_sessions;

COMMIT;
