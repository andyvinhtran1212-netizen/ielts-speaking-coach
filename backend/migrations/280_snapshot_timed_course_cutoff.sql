-- Migration 280 — persist the effective cutoff for every timed Course item.
--
-- `opened_at + content_config.time_limit_minutes`, capped by `due_at`, used to
-- be recomputed on every read. A later config edit could therefore move the
-- learner's boundary after work had begun. Snapshot both inputs' result on the
-- item when the clock starts, then freeze the duration and item snapshot.

BEGIN;

ALTER TABLE public.class_assignment_items
    ADD COLUMN IF NOT EXISTS timed_limit_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS timed_expires_at TIMESTAMPTZ;

UPDATE public.class_assignment_items AS cai
   SET timed_limit_minutes = cfg.limit_minutes,
       timed_expires_at = LEAST(
           cai.opened_at + make_interval(mins => cfg.limit_minutes),
           COALESCE(ca.due_at, 'infinity'::TIMESTAMPTZ)
       )
  FROM public.class_assignments AS ca
 CROSS JOIN LATERAL (
      SELECT (ca.content_config ->> 'time_limit_minutes')::INTEGER AS limit_minutes
       WHERE ca.content_config ->> 'time_limit_minutes' ~ '^[0-9]+$'
         AND (ca.content_config ->> 'time_limit_minutes')::INTEGER BETWEEN 1 AND 720
 ) AS cfg
 WHERE ca.id = cai.assignment_id
   AND ca.skill = 'course'
   AND cai.opened_at IS NOT NULL
   AND cai.timed_limit_minutes IS NULL
   AND cai.timed_expires_at IS NULL;

ALTER TABLE public.class_assignment_items
    DROP CONSTRAINT IF EXISTS class_assignment_items_timed_snapshot_pair;
ALTER TABLE public.class_assignment_items
    ADD CONSTRAINT class_assignment_items_timed_snapshot_pair CHECK (
        (timed_limit_minutes IS NULL AND timed_expires_at IS NULL)
        OR (
            timed_limit_minutes BETWEEN 1 AND 720
            AND timed_expires_at IS NOT NULL
            AND opened_at IS NOT NULL
        )
    );

CREATE OR REPLACE FUNCTION public.snapshot_timed_course_item_cutoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_skill TEXT;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_due_at TIMESTAMPTZ;
BEGIN
    -- Locking the parent serializes this snapshot with a concurrent duration
    -- edit. The first non-null opened_at is the one and only clock start.
    IF NEW.opened_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.opened_at IS NULL) THEN
        SELECT ca.skill, ca.content_config ->> 'time_limit_minutes', ca.due_at
          INTO v_skill, v_limit_text, v_due_at
          FROM public.class_assignments AS ca
         WHERE ca.id = NEW.assignment_id
         FOR UPDATE;

        IF v_skill = 'course' AND v_limit_text IS NOT NULL THEN
            IF v_limit_text !~ '^[0-9]+$' THEN
                RAISE EXCEPTION 'timed_course_limit_invalid'
                    USING ERRCODE = '22023';
            END IF;
            v_limit_minutes := v_limit_text::INTEGER;
            IF v_limit_minutes < 1 OR v_limit_minutes > 720 THEN
                RAISE EXCEPTION 'timed_course_limit_invalid'
                    USING ERRCODE = '22023';
            END IF;
            NEW.timed_limit_minutes := v_limit_minutes;
            NEW.timed_expires_at := LEAST(
                NEW.opened_at + make_interval(mins => v_limit_minutes),
                COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)
            );
            UPDATE public.class_assignments
               SET timed_started_at = CASE
                   WHEN timed_started_at IS NULL THEN NEW.opened_at
                   ELSE LEAST(timed_started_at, NEW.opened_at)
               END
             WHERE id = NEW.assignment_id;
        END IF;
    ELSIF TG_OP = 'UPDATE' AND OLD.opened_at IS NOT NULL
          AND (
              NEW.timed_limit_minutes IS DISTINCT FROM OLD.timed_limit_minutes
              OR NEW.timed_expires_at IS DISTINCT FROM OLD.timed_expires_at
          ) THEN
        RAISE EXCEPTION 'timed_course_snapshot_immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_timed_course_item_cutoff
    ON public.class_assignment_items;
CREATE TRIGGER trg_snapshot_timed_course_item_cutoff
BEFORE INSERT OR UPDATE ON public.class_assignment_items
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_timed_course_item_cutoff();

CREATE OR REPLACE FUNCTION public.guard_started_timed_course_duration_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.skill = 'course'
       AND OLD.timed_started_at IS NOT NULL
       AND (NEW.content_config ->> 'time_limit_minutes') IS DISTINCT FROM
           (OLD.content_config ->> 'time_limit_minutes') THEN
        RAISE EXCEPTION 'timed_course_duration_locked_after_start'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_started_timed_course_duration_change
    ON public.class_assignments;
CREATE TRIGGER trg_guard_started_timed_course_duration_change
BEFORE UPDATE OF content_config ON public.class_assignments
FOR EACH ROW
EXECUTE FUNCTION public.guard_started_timed_course_duration_change();

COMMENT ON COLUMN public.class_assignment_items.timed_limit_minutes IS
'Immutable duration captured when a timed Course item first opens.';
COMMENT ON COLUMN public.class_assignment_items.timed_expires_at IS
'Immutable effective cutoff: min(opened_at + duration, assignment due_at).';

NOTIFY pgrst, 'reload schema';

COMMIT;
