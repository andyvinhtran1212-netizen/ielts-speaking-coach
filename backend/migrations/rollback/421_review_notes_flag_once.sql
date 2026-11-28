-- Roll back 421. Drops only the two flag-once indexes, so duplicate flags are
-- accepted again (the API's 409 pre-check still answers for the common case).
-- public.review_notes is deliberately kept: dropping it deletes learners'
-- private notes, which needs anh Andy's separate typed approval
-- (DROP TABLE IF EXISTS public.review_notes;). Needs the same typed approval
-- as the forward apply; revert routers/review_notes.py first if the table goes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP INDEX IF EXISTS public.uq_feedback_flag_anon;
DROP INDEX IF EXISTS public.uq_feedback_flag_user;

COMMIT;
