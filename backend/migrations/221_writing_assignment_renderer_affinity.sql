-- Migration: 221_writing_assignment_renderer_affinity.sql
--
-- Pin an active Writing assignment to the dashboard implementation that first
-- opens its workspace. Writing was already admitted to Next before the Gate E
-- affinity protocol existed, while the Legacy rollback URL remained live, so
-- historical rows cannot be truthfully backfilled to either renderer. They
-- stay NULL until a versioned player atomically claims them.

BEGIN;

ALTER TABLE public.writing_assignments
    ADD COLUMN IF NOT EXISTS renderer_affinity TEXT;

DO $$
BEGIN
    ALTER TABLE public.writing_assignments
        ADD CONSTRAINT writing_assignments_renderer_affinity_valid
        CHECK (renderer_affinity IN ('legacy', 'next')) NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.writing_assignments
    VALIDATE CONSTRAINT writing_assignments_renderer_affinity_valid;

CREATE OR REPLACE FUNCTION public.fn_claim_writing_assignment_renderer_affinity(
    p_assignment_id uuid,
    p_student_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(assignment_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    UPDATE public.writing_assignments AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity)
     WHERE target.id = p_assignment_id
       AND target.student_id = p_student_id
       AND target.status IN ('pending', 'in_progress')
    RETURNING target.id, target.renderer_affinity;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_writing_assignment_renderer_affinity(
    uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_writing_assignment_renderer_affinity(
    uuid, uuid, text
) TO service_role;

COMMENT ON COLUMN public.writing_assignments.renderer_affinity IS
    'Stable Writing workspace claimed on first versioned player boot. NULL means not yet claimed; historical rows stay NULL because Writing was already Next-canonical while Legacy remained a live rollback path.';
COMMENT ON FUNCTION public.fn_claim_writing_assignment_renderer_affinity(
    uuid, uuid, text
) IS
    'Atomically claim an owned active Writing assignment renderer, or return its immutable existing claim; service-role backend only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
