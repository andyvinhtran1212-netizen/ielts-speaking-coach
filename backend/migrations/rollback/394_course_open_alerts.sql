-- Rollback of 394_course_open_alerts.sql (ENROLL-0060 T22, plan 5.7).
-- Run only after the pre-T22 backend is deployed (the T22 routes then stop
-- calling these functions) and before rollback/383. Drops the functions first,
-- then the two tables: subscriptions are not accounting evidence (plan 5.7,
-- "bảng này không phải sổ lịch sử"). Queued course_open_alert rows stay in
-- learner_email_outbox; before rolling back, mark the pending ones skipped
-- (the G04 dispatcher cannot run fn_course_open_alert_send_check after this):
--   UPDATE public.learner_email_outbox SET status = 'skipped',
--          last_error_code = 'open_alerts_rolled_back'
--    WHERE template = 'course_open_alert' AND status = 'pending';
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP FUNCTION IF EXISTS public.fn_course_open_alert_send_check(uuid, text);
DROP FUNCTION IF EXISTS public.fn_course_open_alerts_rekey(uuid, text, text);
DROP FUNCTION IF EXISTS public.fn_course_open_alerts_enqueue(integer);
DROP FUNCTION IF EXISTS public.fn_course_open_alerts_for_user(uuid, text);
DROP FUNCTION IF EXISTS public.fn_course_open_alert_unsubscribe(text, text, uuid, text);
DROP FUNCTION IF EXISTS public.fn_course_open_alert_subscribe(text, text, uuid);
DROP FUNCTION IF EXISTS public.fn_course_open_alert_attempt_check(text, text);
DROP FUNCTION IF EXISTS public.fn_course_open_alert_has_course(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_course_open_alert_new_token();
DROP TABLE IF EXISTS public.course_open_alert_attempts;
DROP TABLE IF EXISTS public.course_open_alerts;

COMMIT;
