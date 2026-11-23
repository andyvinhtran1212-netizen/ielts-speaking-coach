-- Rollback of 388_learner_active_sessions.sql (COURSEACCESS-0055 T009).
-- Order: turn runtime flag `single_session_learners` off first (live within
-- 15 s), deploy the preceding backend, and roll back 389 (G04-T16, spec label "387", which
-- depends on this table) before this file (rollout.md spec labels: 387 before 384, i.e. real 389 before 388).
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

DROP TABLE IF EXISTS public.learner_active_sessions;

COMMIT;
