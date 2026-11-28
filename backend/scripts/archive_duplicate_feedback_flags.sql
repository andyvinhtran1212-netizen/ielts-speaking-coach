-- LEARNERCORE-0063 amendment 4, open question 14 (plan "Migration T31").
-- NOT a migration. Run only with anh Andy's own typed DB-write approval for
-- that database, and only when the read-only duplicate count before migration
-- 421 is non-zero.
--
-- In ONE transaction: copy every newer duplicate flag (same key as the 421
-- indexes; keep the row with the smallest created_at, ties by smallest id)
-- whole into user_feedback_flag_archive, then delete exactly the copied ids
-- from user_feedback. If the two counts differ the transaction raises and
-- rolls back. The full report history stays in the archive; the inbox keeps
-- one row per key, so migration 421's preflight then passes.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.user_feedback_flag_archive (
    LIKE public.user_feedback INCLUDING DEFAULTS,
    archived_at timestamptz NOT NULL DEFAULT now(),
    archived_reason text NOT NULL
);
ALTER TABLE public.user_feedback_flag_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_feedback_flag_archive FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.user_feedback_flag_archive TO service_role;

DO $$
DECLARE
    copied bigint;
    deleted bigint;
BEGIN
    CREATE TEMP TABLE _dup_flag_ids ON COMMIT DROP AS
    SELECT id FROM (
        SELECT id, row_number() OVER (
                   PARTITION BY attempt_id, coalesce(q_num, -1), created_by
                   ORDER BY created_at, id) AS rn
          FROM public.user_feedback
         WHERE type = 'flag' AND created_by IS NOT NULL AND attempt_id IS NOT NULL
        UNION ALL
        SELECT id, row_number() OVER (
                   PARTITION BY attempt_id, coalesce(q_num, -1), anon_id
                   ORDER BY created_at, id) AS rn
          FROM public.user_feedback
         WHERE type = 'flag' AND anon_id IS NOT NULL AND attempt_id IS NOT NULL
    ) ranked
    WHERE rn > 1;

    INSERT INTO public.user_feedback_flag_archive
    SELECT f.*, now(), 'duplicate flag before migration 421 (spec 0063 open question 14)'
      FROM public.user_feedback f
     WHERE f.id IN (SELECT id FROM _dup_flag_ids);
    GET DIAGNOSTICS copied = ROW_COUNT;

    DELETE FROM public.user_feedback WHERE id IN (SELECT id FROM _dup_flag_ids);
    GET DIAGNOSTICS deleted = ROW_COUNT;

    IF copied <> deleted THEN
        RAISE EXCEPTION 'archive mismatch: copied % rows, deleted % rows', copied, deleted;
    END IF;
    RAISE NOTICE 'archived % duplicate flag rows', copied;
END $$;

COMMIT;
