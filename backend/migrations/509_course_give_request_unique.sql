-- Course-bank give idempotency (owner-requested hotfix, anh Andy 2026-11-25).
--
-- A course bank may now be given again to the same class on purpose (the old
-- per-class 409 is gone), so a retry of the SAME give must not fan out a second
-- assignment. The Next editor sends one `give_request_id` per give intent; the
-- route reads it before inserting and replays the stored receipt. That read
-- alone cannot stop two requests with the same id that are both still in
-- flight: both see "nothing yet" and both insert. This partial unique index is
-- what decides that race, exactly like `uq_grammar_lesson_give_request` (312)
-- does for Grammar lessons. The losing insert raises 23505 naming this index;
-- `create_assignment` then replays the winner's receipt.
--
-- Only rows that carry a request id are covered: every existing course give
-- (none has one) and every deliberate re-give with a NEW id stays allowed.
-- No row is changed and no privilege is changed.
--
-- No apply on merge: pending_feature group course_give_request. Apply through
-- the advisory-locked runner, staging first, only with anh Andy's own typed
-- approval; production before the matching hotfix code is relied on. The code
-- works without it (sequential retries still replay), so order is not fragile.
-- Rollback: rollback/509_course_give_request_unique.sql (drops the index).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_give_request
    ON public.class_assignments (
        cohort_id, (content_config ->> 'give_request_id')
    )
    WHERE skill = 'course'
      AND content_config ? 'give_request_id';

COMMENT ON INDEX public.uq_course_give_request IS
'One course-bank give per (class, give_request_id). A retry of the same give
replays its receipt; a deliberate re-give carries a new id and is allowed.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'uq_course_give_request'
           AND c.relnamespace = 'public'::regnamespace
           AND i.indisunique AND i.indisvalid
    ) THEN
        RAISE EXCEPTION '509_postcondition: uq_course_give_request missing or invalid';
    END IF;
END;
$$;

COMMIT;
