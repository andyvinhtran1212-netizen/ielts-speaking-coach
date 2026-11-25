-- Rollback of 389_learner_login_events.sql (COURSEACCESS-0055 T014, G04-T16).
-- Order: turn runtime flag `single_session_learners` off first (live within
-- 15 s) and deploy the preceding backend; roll this back before 388. Dropping
-- the table is allowed (spec T014 step 1): it holds no learning data, only
-- recent sign-in events. Needs the same typed approval as the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP TABLE IF EXISTS public.learner_login_events;

COMMIT;
