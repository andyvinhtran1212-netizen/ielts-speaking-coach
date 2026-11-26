-- Rollback of 510_mock_sitting_writing_not_applicable.sql.
-- Revert the MOCKLRONLY-0104 code FIRST: the code reads these columns.
-- Drops the three columns; a sitting finalized with Writing not applicable keeps
-- its status and review row, only the audit stamp is lost (export it first:
-- select id, writing_not_applicable_at, writing_not_applicable_by,
-- writing_not_applicable_reason from mock_exam_sittings
-- where writing_not_applicable_at is not null).
-- Needs the same typed approval as the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.mock_exam_sittings
    DROP COLUMN IF EXISTS writing_not_applicable_reason,
    DROP COLUMN IF EXISTS writing_not_applicable_by,
    DROP COLUMN IF EXISTS writing_not_applicable_at;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'mock_exam_sittings'
                  AND column_name LIKE 'writing_not_applicable_%') THEN
        RAISE EXCEPTION 'rollback_510_postcondition: columns still present';
    END IF;
END;
$$;

COMMIT;
