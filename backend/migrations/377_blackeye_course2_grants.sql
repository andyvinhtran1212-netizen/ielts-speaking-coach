-- BLACKEYE-0052 T005 / FR-027. Reserved 377, pending_feature. No apply on merge.
-- CV-1 is unresolved: no HTTP writer, no seed grants, creator-only fallback.
BEGIN;
CREATE TABLE public.blackeye_course2_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
    grantee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('teacher', 'assigner')),
    action text NOT NULL CHECK (action IN ('grant', 'revoke')),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    CHECK (actor_id <> grantee_id)
);
CREATE TABLE public.blackeye_course2_grant_log (
    event_id uuid PRIMARY KEY REFERENCES public.blackeye_course2_grants(id) ON DELETE RESTRICT,
    cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
    grantee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('teacher', 'assigner')),
    action text NOT NULL CHECK (action IN ('grant', 'revoke')),
    occurred_at timestamptz NOT NULL,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    CHECK (actor_id <> grantee_id)
);
ALTER TABLE public.blackeye_course2_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blackeye_course2_grant_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blackeye_course2_grants, public.blackeye_course2_grant_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.blackeye_course2_grants TO service_role;
GRANT SELECT ON TABLE public.blackeye_course2_grant_log TO service_role;

CREATE FUNCTION public.fn_blackeye_grant_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'blackeye_grant_append_only';
END $$;
REVOKE ALL ON FUNCTION public.fn_blackeye_grant_append_only() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER blackeye_grants_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
    ON public.blackeye_course2_grants FOR EACH STATEMENT EXECUTE FUNCTION public.fn_blackeye_grant_append_only();
CREATE TRIGGER blackeye_grant_log_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
    ON public.blackeye_course2_grant_log FOR EACH STATEMENT EXECUTE FUNCTION public.fn_blackeye_grant_append_only();

CREATE FUNCTION public.fn_blackeye_audit_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR NEW.actor_id = NEW.grantee_id THEN
        RAISE EXCEPTION 'blackeye_grant_forbidden';
    END IF;
    INSERT INTO public.blackeye_course2_grant_log
        (event_id, cohort_id, grantee_id, actor_id, role, action, occurred_at, reason)
    VALUES (NEW.id, NEW.cohort_id, NEW.grantee_id, NEW.actor_id, NEW.role, NEW.action, NEW.occurred_at, NEW.reason);
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_blackeye_audit_grant() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER blackeye_grants_audit AFTER INSERT ON public.blackeye_course2_grants
    FOR EACH ROW EXECUTE FUNCTION public.fn_blackeye_audit_grant();
COMMENT ON TABLE public.blackeye_course2_grants IS 'Dormant FR-027 grant/revoke event list. Latest event per cohort/grantee/role determines future access; CV-1 unresolved, not consumed for authorization.';
COMMENT ON TABLE public.blackeye_course2_grant_log IS 'Append-only copy of each FR-027 grant/revoke event; no client access.';
COMMIT;
