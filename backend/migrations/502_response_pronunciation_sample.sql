-- G04-T13 / COURSEACCESS-0055 FR-035, FR-036 (plan 5.16, spec label "385").
-- Number 502 was assigned to this task by anh Andy on 2026-11-20
-- (approval-decision.md; register.tsv row 502).
--
-- With the runtime flag `pron_sample_window` on, Azure pronunciation receives
-- one sample of each answer (PRON_SAMPLE_SECONDS from the middle) and Part 1
-- sessions send only one answer. These three columns record, per response,
-- which part of the recording Azure heard:
--   pronunciation_sample_scope   'segment' (start/end set), 'full' (whole
--                                recording sent) or 'not_sampled' (Azure not
--                                called for this answer); NULL = written
--                                before 502 or with the flag off.
--   pronunciation_sample_start_s / _end_s   seconds into the recording.
-- Existing rows are not changed and table privileges are not changed. The
-- grading route writes the columns only when the flag is on, and the columns
-- are outside its _CORE_COLUMNS, so the core-row fallback drops them while
-- the schema lacks them.
--
-- No apply on merge: pending_feature group pron_sample. Apply through the
-- advisory-locked runner, staging first, only with anh Andy's own typed
-- approval for that window; production only at an authorised staging -> main
-- promotion. Apply 502 before turning `pron_sample_window` on.
-- Rollback: rollback/502_response_pronunciation_sample.sql (drops the three
-- columns; turn the flag off first).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.responses
    ADD COLUMN IF NOT EXISTS pronunciation_sample_start_s numeric(7,2) NULL,
    ADD COLUMN IF NOT EXISTS pronunciation_sample_end_s numeric(7,2) NULL,
    ADD COLUMN IF NOT EXISTS pronunciation_sample_scope text NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.responses'::regclass
                      AND conname = 'responses_pronunciation_sample_check') THEN
        -- NOT VALID + VALIDATE keeps the ACCESS EXCLUSIVE window short; every
        -- existing row has three NULLs, so validation cannot fail.
        ALTER TABLE public.responses
            ADD CONSTRAINT responses_pronunciation_sample_check CHECK (
                -- a segment has both ends, starts at >= 0 and ends after it
                (pronunciation_sample_scope IS NOT DISTINCT FROM 'segment'
                    AND pronunciation_sample_start_s IS NOT NULL
                    AND pronunciation_sample_end_s IS NOT NULL
                    AND pronunciation_sample_start_s >= 0
                    AND pronunciation_sample_end_s > pronunciation_sample_start_s)
                -- full / not_sampled / NULL carry no seconds
                OR ((pronunciation_sample_scope IS NULL
                        OR pronunciation_sample_scope IN ('full', 'not_sampled'))
                    AND pronunciation_sample_start_s IS NULL
                    AND pronunciation_sample_end_s IS NULL)
            ) NOT VALID;
    END IF;
END;
$$;
ALTER TABLE public.responses VALIDATE CONSTRAINT responses_pronunciation_sample_check;

COMMENT ON COLUMN public.responses.pronunciation_sample_scope IS
    'Phần bản ghi Azure đã nghe (mig 502): segment | full | not_sampled; NULL = trước 502 hoặc cờ pron_sample_window tắt.';
COMMENT ON COLUMN public.responses.pronunciation_sample_start_s IS
    'Giây bắt đầu đoạn gửi Azure khi scope = segment (mig 502).';
COMMENT ON COLUMN public.responses.pronunciation_sample_end_s IS
    'Giây kết thúc đoạn gửi Azure khi scope = segment (mig 502).';

DO $postcondition$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'responses'
           AND column_name IN ('pronunciation_sample_start_s', 'pronunciation_sample_end_s',
                               'pronunciation_sample_scope')) <> 3 THEN
        RAISE EXCEPTION 'migration_502_postcondition: sample columns missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.responses'::regclass
                      AND conname = 'responses_pronunciation_sample_check'
                      AND convalidated) THEN
        RAISE EXCEPTION 'migration_502_postcondition: sample CHECK missing or not validated';
    END IF;
END;
$postcondition$;

COMMIT;
