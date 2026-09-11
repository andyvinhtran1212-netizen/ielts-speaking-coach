-- Prospective Writing origin and first-activity proof. Requires 247–248.
-- Control is EMPTY/OFF after migration: no backfill, capture or enrollment.
-- Activating DB capture is a separate operational approval, not an app deploy.
BEGIN;

DO $$ BEGIN
    PERFORM essay_id FROM public.writing_assignments LIMIT 0;
END $$;

CREATE TABLE IF NOT EXISTS public.core_writing_capture_control (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.core_writing_origins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Deliberately no source FK: deleting/reusing a source UUID must not erase
    -- its origin/history. No erasure/purge API is authorized by this migration.
    assignment_id UUID NOT NULL UNIQUE,
    student_id UUID NOT NULL,
    birth_epoch_id UUID NOT NULL REFERENCES public.core_admission_epochs(id) ON DELETE CASCADE,
    manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
    first_activity TEXT CHECK (first_activity IN ('admitted','unclaimed')),
    first_activity_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((first_activity IS NULL) = (first_activity_at IS NULL))
);
CREATE INDEX IF NOT EXISTS core_writing_origins_epoch ON public.core_writing_origins(birth_epoch_id);
ALTER TABLE public.core_writing_capture_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_writing_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_writing_capture_control,public.core_writing_origins
    FROM PUBLIC,anon,authenticated,service_role;

-- A boolean, not a private origin UUID/capability exposed by existing SELECT *.
-- Old rows stay false without pretending their history was observed.
ALTER TABLE public.writing_assignments ADD COLUMN IF NOT EXISTS core_admission_tracked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.fn_guard_core_writing_origin()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
    IF (to_jsonb(NEW)-ARRAY['first_activity','first_activity_at','deleted_at','invalidated_at','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['first_activity','first_activity_at','deleted_at','invalidated_at','updated_at'])
       OR (OLD.first_activity IS NOT NULL AND
           (NEW.first_activity IS DISTINCT FROM OLD.first_activity OR NEW.first_activity_at IS DISTINCT FROM OLD.first_activity_at))
       OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
       OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) THEN
        RAISE EXCEPTION 'writing_origin_immutable' USING ERRCODE='ZA004';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS core_writing_origin_immutable ON public.core_writing_origins;
CREATE TRIGGER core_writing_origin_immutable BEFORE UPDATE ON public.core_writing_origins
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_writing_origin();

CREATE OR REPLACE FUNCTION public.fn_capture_writing_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE control public.core_writing_capture_control%ROWTYPE; epoch_id UUID;
BEGIN
    IF NEW.core_admission_tracked THEN
        RAISE EXCEPTION 'writing_origin_client_claim' USING ERRCODE='ZA001';
    END IF;
    SELECT * INTO control FROM public.core_writing_capture_control WHERE singleton FOR SHARE;
    IF NOT FOUND OR NOT control.enabled THEN RETURN NEW; END IF;
    SELECT id INTO epoch_id FROM public.core_admission_epochs
        WHERE domain='writing_assignment' AND state='open'
          AND enrollment_digest=control.manifest_digest FOR SHARE;
    IF epoch_id IS NULL THEN
        RAISE EXCEPTION 'writing_origin_epoch_unavailable' USING ERRCODE='ZA003';
    END IF;
    INSERT INTO public.core_writing_origins(assignment_id,student_id,birth_epoch_id,manifest_digest,
        first_activity,first_activity_at)
        VALUES(NEW.id,NEW.student_id,epoch_id,control.manifest_digest,
            CASE WHEN NEW.status='pending' AND NEW.started_at IS NULL AND NEW.essay_id IS NULL THEN NULL ELSE 'unclaimed' END,
            CASE WHEN NEW.status='pending' AND NEW.started_at IS NULL AND NEW.essay_id IS NULL THEN NULL ELSE clock_timestamp() END);
    NEW.core_admission_tracked := TRUE;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS core_capture_writing_origin ON public.writing_assignments;
CREATE TRIGGER core_capture_writing_origin BEFORE INSERT ON public.writing_assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_writing_origin();

CREATE OR REPLACE FUNCTION public.fn_mark_writing_first_activity(p_assignment_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE origin public.core_writing_origins%ROWTYPE; classification TEXT;
BEGIN
    SELECT * INTO origin FROM public.core_writing_origins WHERE assignment_id=p_assignment_id FOR UPDATE;
    IF NOT FOUND OR origin.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'writing_origin_missing' USING ERRCODE='ZA004';
    END IF;
    IF origin.first_activity IS NOT NULL THEN RETURN; END IF;
    -- Only the private executor can insert a binding. It does so BEFORE its
    -- source write, in the same transaction. A failed execution rolls both back.
    classification := CASE WHEN EXISTS (
        SELECT 1 FROM public.core_admission_bindings
        WHERE canonical_id=p_assignment_id AND domain='writing_assignment'
    ) THEN 'admitted' ELSE 'unclaimed' END;
    UPDATE public.core_writing_origins SET first_activity=classification,first_activity_at=clock_timestamp()
        WHERE id=origin.id;
END $$;

CREATE OR REPLACE FUNCTION public.fn_track_writing_origin_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        IF OLD.core_admission_tracked THEN
            UPDATE public.core_writing_origins SET deleted_at=clock_timestamp()
                WHERE assignment_id=OLD.id AND deleted_at IS NULL;
            IF NOT FOUND THEN RAISE EXCEPTION 'writing_origin_missing' USING ERRCODE='ZA004'; END IF;
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.core_admission_tracked IS DISTINCT FROM OLD.core_admission_tracked THEN
        RAISE EXCEPTION 'writing_origin_client_claim' USING ERRCODE='ZA001';
    END IF;
    IF NOT OLD.core_admission_tracked THEN RETURN NEW; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
        -- Preserve existing admin reassignment semantics, but never present a
        -- changed identity as pristine original-owner provenance.
        UPDATE public.core_writing_origins SET invalidated_at=clock_timestamp()
            WHERE assignment_id=OLD.id AND invalidated_at IS NULL;
        RETURN NEW;
    END IF;
    -- Existing in-progress saves/submits need no origin-store read or update.
    -- Only the first transition out of the previously unstarted state is tracked.
    IF OLD.started_at IS NULL AND OLD.status='pending'
       AND (NEW.started_at IS NOT NULL OR NEW.status <> 'pending' OR NEW.essay_id IS NOT NULL) THEN
        PERFORM public.fn_mark_writing_first_activity(OLD.id);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS core_track_writing_origin_activity ON public.writing_assignments;
CREATE TRIGGER core_track_writing_origin_activity BEFORE UPDATE OR DELETE ON public.writing_assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_track_writing_origin_activity();

CREATE OR REPLACE FUNCTION public.fn_track_writing_origin_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.writing_assignments%ROWTYPE;
BEGIN
    -- Same parent lock as guard 224, including when draft insertion is first.
    SELECT * INTO a FROM public.writing_assignments WHERE id=NEW.assignment_id FOR UPDATE;
    IF a.core_admission_tracked AND a.started_at IS NULL AND a.status='pending' THEN
        PERFORM public.fn_mark_writing_first_activity(a.id);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS core_track_writing_origin_draft ON public.writing_drafts;
CREATE TRIGGER core_track_writing_origin_draft BEFORE INSERT OR UPDATE ON public.writing_drafts
    FOR EACH ROW EXECUTE FUNCTION public.fn_track_writing_origin_draft();

-- Preserve execution implementation 248 privately; the public RPC now checks
-- durable origin under the same scope/student/assignment locks before calling B.
DO $$ BEGIN
    IF to_regprocedure('public.fn_execute_writing_admission_v248(uuid,uuid,uuid,uuid,integer)') IS NULL THEN
        ALTER FUNCTION public.fn_execute_writing_admission(UUID,UUID,UUID,UUID,INTEGER)
            RENAME TO fn_execute_writing_admission_v248;
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_execute_writing_admission_v248(UUID,UUID,UUID,UUID,INTEGER)
    FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_assert_writing_origin(p_assignment_id UUID,p_student_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE origin public.core_writing_origins%ROWTYPE;
BEGIN
    SELECT * INTO origin FROM public.core_writing_origins
        WHERE assignment_id=p_assignment_id AND student_id=p_student_id FOR UPDATE;
    IF NOT FOUND OR origin.deleted_at IS NOT NULL OR origin.invalidated_at IS NOT NULL
       OR origin.first_activity='unclaimed' THEN
        RAISE EXCEPTION 'writing_admission_baseline_conflict' USING ERRCODE='ZA007';
    END IF;
    IF origin.first_activity='admitted' AND NOT EXISTS (
        SELECT 1 FROM public.core_admission_bindings
        WHERE canonical_id=p_assignment_id AND domain='writing_assignment'
    ) THEN
        -- A lost binding cannot turn a previously admitted source into a new
        -- start, even if a privileged writer also clears its timer/status.
        RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_execute_writing_admission(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_command_id UUID,p_generation INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE scope_id UUID; a public.writing_assignments%ROWTYPE;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'writing_admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    SELECT scope.id INTO scope_id FROM public.core_admission_commands c
        JOIN public.core_attempt_episodes e ON e.id=c.episode_id
        JOIN public.core_admission_scopes scope ON scope.id=e.scope_id
        WHERE c.id=p_command_id AND c.principal_id=p_user_id AND c.domain='writing_assignment'
          AND scope.scope_key=p_assignment_id AND scope.resource_id=p_assignment_id;
    IF scope_id IS NULL THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    PERFORM id FROM public.core_admission_scopes WHERE id=scope_id FOR UPDATE;
    PERFORM id FROM public.students WHERE id=p_student_id AND user_id=p_user_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    SELECT * INTO a FROM public.writing_assignments WHERE id=p_assignment_id AND student_id=p_student_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    IF NOT a.core_admission_tracked THEN
        RAISE EXCEPTION 'writing_admission_baseline_conflict' USING ERRCODE='ZA007';
    END IF;
    PERFORM public.fn_assert_writing_origin(a.id,a.student_id);
    RETURN public.fn_execute_writing_admission_v248(p_user_id,p_student_id,p_assignment_id,p_command_id,p_generation);
END $$;

REVOKE ALL ON FUNCTION public.fn_guard_core_writing_origin(),public.fn_capture_writing_origin(),
    public.fn_mark_writing_first_activity(UUID),public.fn_track_writing_origin_activity(),
    public.fn_track_writing_origin_draft(),public.fn_assert_writing_origin(UUID,UUID),
    public.fn_execute_writing_admission(UUID,UUID,UUID,UUID,INTEGER)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_execute_writing_admission(UUID,UUID,UUID,UUID,INTEGER) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
