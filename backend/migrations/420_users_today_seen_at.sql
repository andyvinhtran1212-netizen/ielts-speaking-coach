-- G07-T13 / LEARNERCORE-0063 FR-025, FR-078 (plan "Migration (chỉ một cột)").
-- The "Vừa có kết quả" block on the new Today page shows results returned
-- after the learner's last-seen cursor. The cursor is a pair
-- (today_seen_at, today_seen_key), key = '<kind>:<id>' (writing:<essay_id>,
-- speaking:<session_id>) so ids of the two tables never collide and several
-- results returned at the same instant still advance one by one.
--
-- Nullable, no default, no index (read by primary key). Written only by the
-- backend (service role) through POST /api/student/today/seen; NOT added to
-- the learner self-update column list of migration 320.
--
-- Apply through the advisory-locked runner, staging first. Every apply needs
-- anh Andy's own typed approval for that window; this PR does not authorize
-- any hosted apply. Rollback: rollback/420_users_today_seen_at.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS today_seen_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS today_seen_key text;

COMMENT ON COLUMN public.users.today_seen_at IS
'LEARNERCORE-0063 (mig 420): last-seen cursor time of the Today "Vừa có kết quả" block; backend-only write.';
COMMENT ON COLUMN public.users.today_seen_key IS
'LEARNERCORE-0063 (mig 420): last-seen cursor key <kind>:<id> paired with today_seen_at; backend-only write.';

COMMIT;
