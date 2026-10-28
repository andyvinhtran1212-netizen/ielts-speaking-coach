-- Migration: 321_writing_grade_ratings_feedback_version.sql
--
-- Schema drift repair for writing_grade_ratings (migration 116).
--
-- Root cause. Staging and production were migrated with an early draft of
-- 116 (commit df4fce621): one rating per essay, `UNIQUE (essay_id)` (auto-named
-- `writing_grade_ratings_essay_id_key`) and no `feedback_version` column. 116
-- was later revised to key the rating to the graded run —
-- `feedback_version int NOT NULL` + `UNIQUE (essay_id, feedback_version)` — but
-- it uses CREATE TABLE IF NOT EXISTS and is already in both ledgers, so the
-- revision can never reach those databases. essay_service.get_grade_rating /
-- upsert_grade_rating filter and upsert on (essay_id, feedback_version), and
-- fail with 42703 "column writing_grade_ratings.feedback_version does not
-- exist" against the drifted table.
--
-- Read-only checks 2026-10-26: staging and production both have the draft
-- shape and 0 rows.
--
-- This migration converges either shape to the revised 116 shape:
--   1. add `feedback_version int` (nullable first);
--   2. backfill NULLs from writing_essays.current_version (see below);
--   3. SET NOT NULL;
--   4. drop every UNIQUE constraint on exactly (essay_id), by name and by
--      definition;
--   5. add `writing_grade_ratings_essay_id_feedback_version_key
--      UNIQUE (essay_id, feedback_version)` — the name 116 produces on a fresh
--      database — unless an equivalent constraint already exists;
--   6. a postcondition aborts the transaction if the result is not that shape.
-- On a database where 116 already created the revised shape, every step is a
-- no-op. Safe to re-apply.
--
-- Backfill. `feedback_version` is the writing_feedback.version of the run the
-- admin rated: upsert_grade_rating stores the `version` of
-- writing_feedback_current, i.e. the row whose version equals
-- writing_essays.current_version (109). Under the draft schema a rating was
-- per essay and was always shown next to the essay's current run, so mapping a
-- legacy row to the essay's current_version keeps what the admin page showed.
-- The draft UNIQUE (essay_id) guarantees at most one legacy row per essay, so
-- the backfill cannot collide with the new composite key. current_version is
-- NOT NULL DEFAULT 1 (109); COALESCE(..., 1) is only a defensive floor.
--
-- RLS and privileges are untouched: the table keeps RLS with no policy
-- (backend-only, service_role), and no client grant is added (320).
--
-- Rollback (manual, only if no rating has a second version per essay):
--   ALTER TABLE public.writing_grade_ratings
--     DROP CONSTRAINT IF EXISTS writing_grade_ratings_essay_id_feedback_version_key;
--   ALTER TABLE public.writing_grade_ratings
--     ADD CONSTRAINT writing_grade_ratings_essay_id_key UNIQUE (essay_id);
--   ALTER TABLE public.writing_grade_ratings DROP COLUMN IF EXISTS feedback_version;
-- Rolling back breaks the current backend's rating read/upsert again.

BEGIN;

ALTER TABLE public.writing_grade_ratings ADD COLUMN IF NOT EXISTS feedback_version int;

UPDATE public.writing_grade_ratings r
   SET feedback_version = COALESCE(
           (SELECT e.current_version FROM public.writing_essays e WHERE e.id = r.essay_id), 1)
 WHERE r.feedback_version IS NULL;

ALTER TABLE public.writing_grade_ratings ALTER COLUMN feedback_version SET NOT NULL;

ALTER TABLE public.writing_grade_ratings DROP CONSTRAINT IF EXISTS writing_grade_ratings_essay_id_key;

DO $$
DECLARE
    rel   CONSTANT regclass := 'public.writing_grade_ratings'::regclass;
    essay CONSTANT smallint := (SELECT attnum FROM pg_attribute
                                 WHERE attrelid = 'public.writing_grade_ratings'::regclass
                                   AND attname = 'essay_id' AND NOT attisdropped);
    fv    CONSTANT smallint := (SELECT attnum FROM pg_attribute
                                 WHERE attrelid = 'public.writing_grade_ratings'::regclass
                                   AND attname = 'feedback_version' AND NOT attisdropped);
    con   record;
BEGIN
    -- A single-column UNIQUE (essay_id) under any other name also blocks a
    -- second graded run's rating.
    FOR con IN SELECT conname FROM pg_constraint
                WHERE conrelid = rel AND contype = 'u' AND conkey = ARRAY[essay]
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel, con.conname);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = rel AND contype IN ('u', 'p')
                      AND conkey @> ARRAY[essay, fv] AND conkey <@ ARRAY[essay, fv]) THEN
        ALTER TABLE public.writing_grade_ratings
            ADD CONSTRAINT writing_grade_ratings_essay_id_feedback_version_key
            UNIQUE (essay_id, feedback_version);
    END IF;
END $$;

-- Postcondition: the revised 116 shape, or abort.
DO $$
DECLARE
    rel   CONSTANT regclass := 'public.writing_grade_ratings'::regclass;
    col   record;
    essay smallint;
    fv    smallint;
BEGIN
    SELECT a.attnum, a.attnotnull, a.atttypid INTO col
      FROM pg_attribute a
     WHERE a.attrelid = rel AND a.attname = 'feedback_version' AND NOT a.attisdropped;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'writing_grade_ratings_feedback_version_missing';
    END IF;
    IF col.atttypid <> 'integer'::regtype THEN
        RAISE EXCEPTION 'writing_grade_ratings_feedback_version_not_integer: %', col.atttypid::regtype;
    END IF;
    IF NOT col.attnotnull THEN
        RAISE EXCEPTION 'writing_grade_ratings_feedback_version_nullable';
    END IF;
    fv := col.attnum;
    SELECT attnum INTO essay FROM pg_attribute
     WHERE attrelid = rel AND attname = 'essay_id' AND NOT attisdropped;

    -- Unique constraints and standalone unique indexes alike.
    IF EXISTS (SELECT 1 FROM pg_index i
                WHERE i.indrelid = rel AND i.indisunique
                  AND i.indnkeyatts = 1 AND i.indkey[0] = essay) THEN
        RAISE EXCEPTION 'writing_grade_ratings_single_essay_unique_survives';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = rel AND contype IN ('u', 'p')
                      AND conkey @> ARRAY[essay, fv] AND conkey <@ ARRAY[essay, fv]) THEN
        RAISE EXCEPTION 'writing_grade_ratings_essay_feedback_version_unique_missing';
    END IF;
END $$;

COMMIT;
