-- Disable product RPCs; retain grants, log, owner config and 332 audit/outbox.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.fn_create_exercise_book_assignment(uuid,uuid,uuid,text,jsonb,uuid[],timestamptz,text,text,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'exercise_book_rollback_378_first' USING ERRCODE='55000'; END IF;
END $$;
LOCK TABLE public.exercise_book_registry,public.exercise_book_grant_owners,public.exercise_book_cohort_grants,public.exercise_book_cohort_grant_log IN ACCESS EXCLUSIVE MODE;
DROP FUNCTION public.fn_exercise_book_actor_access(uuid,uuid,text);
DROP FUNCTION public.fn_read_cohort_grant_log(uuid,uuid,text,integer,bigint);
DROP FUNCTION public.fn_list_cohort_grants(uuid,uuid,text);
DROP FUNCTION public.fn_record_cohort_grant(uuid,timestamptz,uuid,text,uuid,text,text,text,uuid);
DO $$ BEGIN
 IF to_regprocedure('public.fn_record_cohort_grant(uuid,timestamptz,uuid,text,uuid,text,text,text,uuid)') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_grant_owners'::regclass
   AND tgname='exercise_book_owner_audit' AND tgenabled='O') THEN
   RAISE EXCEPTION 'exercise_book_rollback_postcondition'; END IF;
END $$;
COMMIT;
