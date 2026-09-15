-- Migration 278 — never detach a started timed Course attempt by deleting its
-- parent assignment.
--
-- The previous delete RPC only treated a completed quiz session as evidence.
-- A timed bank read creates an open session and anchors opened_at before any
-- answer is submitted, so an admin could still delete the assignment while the
-- learner was working.  ON DELETE SET NULL would then turn that session into an
-- apparently untimed one and remove the only path to a canonical Course verdict.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_delete_class_assignment_if_unsubmitted(
    p_assignment_id UUID,
    p_cohort_id     UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_timed_started BOOLEAN;
    v_evidence      BOOLEAN;
BEGIN
    SELECT ca.timed_started_at IS NOT NULL
      INTO v_timed_started
      FROM public.class_assignments AS ca
     WHERE ca.id = p_assignment_id
       AND ca.cohort_id = p_cohort_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM 1 FROM public.class_assignment_items
      WHERE assignment_id = p_assignment_id
      FOR UPDATE;

    PERFORM 1 FROM public.sessions s
      JOIN public.class_assignment_items i ON i.id = s.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF s;
    PERFORM 1 FROM public.reading_test_attempts r
      JOIN public.class_assignment_items i ON i.id = r.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF r;
    PERFORM 1 FROM public.listening_test_attempts l
      JOIN public.class_assignment_items i ON i.id = l.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF l;
    PERFORM 1 FROM public.quiz_sessions q
      JOIN public.class_assignment_items i ON i.id = q.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF q;
    PERFORM 1 FROM public.course_writing_submissions w
      JOIN public.class_assignment_items i ON i.id = w.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF w;
    PERFORM 1 FROM public.course_section_submissions c
      JOIN public.class_assignment_items i ON i.id = c.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF c;
    PERFORM 1 FROM public.course_pronunciation_submissions p
      JOIN public.class_assignment_items i ON i.id = p.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF p;

    SELECT v_timed_started OR EXISTS (
        SELECT 1
          FROM public.class_assignment_items i
         WHERE i.assignment_id = p_assignment_id
           AND (
                i.submitted_at IS NOT NULL
             OR i.opened_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.sessions s
                         WHERE s.class_assignment_item_id = i.id
                           AND s.status = 'completed')
             OR EXISTS (SELECT 1 FROM public.reading_test_attempts r
                         WHERE r.class_assignment_item_id = i.id
                           AND r.status = 'submitted')
             OR EXISTS (SELECT 1 FROM public.listening_test_attempts l
                         WHERE l.class_assignment_item_id = i.id
                           AND l.status = 'submitted')
             -- Any attached Course quiz session is durable learner work.  An
             -- open/paused row is especially important: detaching it would
             -- bypass the timed progress and finalization boundary.
             OR EXISTS (SELECT 1 FROM public.quiz_sessions q
                         WHERE q.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.course_writing_submissions w
                         WHERE w.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.course_section_submissions c
                         WHERE c.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.course_pronunciation_submissions p
                         WHERE p.class_assignment_item_id = i.id)
           )
    ) INTO v_evidence;

    IF v_evidence THEN
        RETURN FALSE;
    END IF;

    DELETE FROM public.class_assignments WHERE id = p_assignment_id;
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid) IS
'Delete an assignment only before any learner work starts. Migration 278 also
protects timed_started_at, item.opened_at, and every attached Course quiz
session, including open or paused sessions, under the same row locks.';

REVOKE EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

COMMIT;

