-- Roll back 420. Drops only the Today last-seen cursor; the worst effect is
-- that learners see up to two recent results again. Needs the same typed
-- approval as the forward apply, and the code that reads the columns
-- (services/student_today.py) must be reverted first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.users DROP COLUMN IF EXISTS today_seen_key;
ALTER TABLE public.users DROP COLUMN IF EXISTS today_seen_at;

COMMIT;
