-- Mock sitting: Writing not applicable (owner-requested hotfix, anh Andy 2026-11-26,
-- spec MOCKLRONLY-0104).
--
-- A sequential mock always counts Writing as a section the sitting must submit
-- (mock_exam_service._configured_sections), so a sitting that only ever took
-- Listening and Reading never reaches all_submitted, never gets a review row
-- and its results cannot be released. The admin action
-- POST /admin/mock-exams/sittings/{id}/writing-not-applicable records, on that
-- one sitting, that Writing does not apply: who, when and why. Every reader
-- then drops Writing for that sitting only; every other sitting is unchanged.
--
-- Three nullable columns, no default, no backfill, no index, no privilege change.
-- No apply on merge: pending_feature mock_writing_na. Apply through the
-- advisory-locked runner, staging first, only with anh Andy's own typed
-- approval; production before the matching hotfix code reaches main.
-- Rollback: rollback/510_mock_sitting_writing_not_applicable.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.mock_exam_sittings
    ADD COLUMN IF NOT EXISTS writing_not_applicable_at     timestamptz,
    ADD COLUMN IF NOT EXISTS writing_not_applicable_by     uuid,
    ADD COLUMN IF NOT EXISTS writing_not_applicable_reason text;

COMMENT ON COLUMN public.mock_exam_sittings.writing_not_applicable_at IS
'Set once by an admin when this sitting took no Writing (room closed before
Writing ever opened). Writing then is not a required section or band for this
sitting only. NULL = normal sitting.';
COMMENT ON COLUMN public.mock_exam_sittings.writing_not_applicable_by IS
'Admin user id that recorded writing_not_applicable_at.';
COMMENT ON COLUMN public.mock_exam_sittings.writing_not_applicable_reason IS
'Admin-entered reason for writing_not_applicable_at (audit).';

DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'mock_exam_sittings'
           AND column_name IN ('writing_not_applicable_at',
                               'writing_not_applicable_by',
                               'writing_not_applicable_reason')) <> 3 THEN
        RAISE EXCEPTION '510_postcondition: writing_not_applicable columns missing';
    END IF;
END;
$$;

COMMIT;
