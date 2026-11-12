-- Exercise-book D1, D↔E SQL contract v1.3.2 §8.15. RESERVED / pending_feature; no apply on merge.
-- Service identity is asserted by the verified backend, as in 332/376.
-- An empty grant_owners table fails closed. No owner UUID or owner seed.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Declarative adapter registry, shared by grants, admission and the resolver.
CREATE TABLE public.exercise_book_registry (
    programme_id text PRIMARY KEY,
    course_code text NOT NULL,
    metadata_key text NOT NULL,
    review_key text NOT NULL,
    collection_id text NOT NULL,
    source_contract text NOT NULL,
    unit_id text NOT NULL,
    unit_title text NOT NULL,
    activity_pattern text NOT NULL,
    locked_activities text[] NOT NULL,
    interactions text[] NOT NULL,
    scoring_modes text[] NOT NULL,
    cell_rules jsonb NOT NULL,
    scoring_policy text NOT NULL CHECK (scoring_policy IN ('report_only','objective'))
);
INSERT INTO public.exercise_book_registry VALUES
 ('blackeye-v5-upper-listening','C2','blackeye','blackeye_review','blackeye-v5-upper',
  'blackeye_u1_v1','U1','Black Eye — Unit 1','^U1-A(0[1-9]|1[0-9]|20)$',
  ARRAY['U1-A08','U1-A14','U1-A19'],ARRAY['text','keep_change'],ARRAY['SELF-CHECK'],
  '{"U1-A13":{"count":48},"U1-A03":{"interaction":"keep_change"},"U1-A04":{"interaction":"keep_change"}}','report_only');

CREATE TABLE public.exercise_book_grant_owners (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
    step_up_max_seconds integer NOT NULL DEFAULT 600 CHECK (step_up_max_seconds = 600),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton)
);
CREATE TABLE public.exercise_book_grant_owner_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    op text NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
    db_user text NOT NULL,
    source text NOT NULL CHECK (source IN ('service','out_of_band')),
    before jsonb,
    after jsonb
);
CREATE TABLE public.exercise_book_cohort_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
    programme_id text NOT NULL REFERENCES public.exercise_book_registry(programme_id) ON DELETE RESTRICT,
    grantee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('assigner','teacher')),
    action text NOT NULL CHECK (action IN ('grant','revoke')),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    request_id uuid NOT NULL UNIQUE,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    step_up_at timestamptz NOT NULL,
    auth_session_id text CHECK (auth_session_id IS NULL OR auth_session_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
    CHECK (actor_id <> grantee_id)
);
CREATE INDEX exercise_book_grants_latest ON public.exercise_book_cohort_grants
 (cohort_id,programme_id,grantee_id,role,seq DESC);
CREATE TABLE public.exercise_book_cohort_grant_log (
    event_id uuid PRIMARY KEY REFERENCES public.exercise_book_cohort_grants(id) ON DELETE RESTRICT,
    seq bigint NOT NULL UNIQUE,
    cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
    programme_id text NOT NULL,
    grantee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    role text NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    request_id uuid NOT NULL UNIQUE,
    occurred_at timestamptz NOT NULL,
    step_up_at timestamptz NOT NULL,
    auth_session_id text CHECK (auth_session_id IS NULL OR auth_session_id ~ '^[A-Za-z0-9._:-]{1,64}$')
);

CREATE FUNCTION public.fn_eb_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'exercise_book_append_only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER exercise_book_grants_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.exercise_book_cohort_grants FOR EACH STATEMENT EXECUTE FUNCTION public.fn_eb_append_only();
CREATE TRIGGER exercise_book_log_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.exercise_book_cohort_grant_log FOR EACH STATEMENT EXECUTE FUNCTION public.fn_eb_append_only();

-- Separate append-only owner history; no shared 332 event or alert outbox.
CREATE FUNCTION public.fn_eb_owner_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    INSERT INTO public.exercise_book_grant_owner_audit(op,db_user,source,before,after)
      VALUES (TG_OP,session_user,
        CASE WHEN auth.role()='service_role' THEN 'service' ELSE 'out_of_band' END,
        CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
    RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER exercise_book_owner_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.exercise_book_grant_owner_audit FOR EACH STATEMENT EXECUTE FUNCTION public.fn_eb_append_only();
CREATE TRIGGER exercise_book_owner_audit AFTER INSERT OR UPDATE OR DELETE
 ON public.exercise_book_grant_owners FOR EACH ROW EXECUTE FUNCTION public.fn_eb_owner_audit();
CREATE TRIGGER exercise_book_owner_no_truncate BEFORE TRUNCATE
 ON public.exercise_book_grant_owners FOR EACH STATEMENT EXECUTE FUNCTION public.fn_eb_append_only();

CREATE FUNCTION public.fn_eb_require_owner(p_actor_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1
      FROM public.exercise_book_grant_owners o JOIN public.users u ON u.id=o.user_id
     WHERE o.user_id=p_actor_id AND u.is_active AND u.suspended_at IS NULL AND u.role='admin'
     FOR SHARE OF o,u;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_owner' USING ERRCODE='EB403'; END IF;
    RETURN 600;
END $$;
CREATE FUNCTION public.fn_eb_require_cohort(p_cohort_id uuid,p_programme_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1 FROM public.cohorts c JOIN public.courses co ON co.id=c.course_id
      JOIN public.exercise_book_registry r ON r.course_code=co.code
     WHERE c.id=p_cohort_id AND r.programme_id=p_programme_id
       AND c.is_active AND co.is_active FOR SHARE OF c,co,r;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
END $$;
CREATE FUNCTION public.fn_eb_grant_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM public.fn_eb_require_owner(NEW.actor_id);
    IF NEW.actor_id=NEW.grantee_id THEN RAISE EXCEPTION 'self_grant' USING ERRCODE='EB422'; END IF;
    IF NEW.step_up_at IS NULL OR NEW.step_up_at<clock_timestamp()-interval '600 seconds'
       OR NEW.step_up_at>clock_timestamp()+interval '30 seconds' THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE='EB403';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER exercise_book_grant_owner_guard BEFORE INSERT ON public.exercise_book_cohort_grants
 FOR EACH ROW EXECUTE FUNCTION public.fn_eb_grant_insert_guard();
CREATE FUNCTION public.fn_eb_grant_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    INSERT INTO public.exercise_book_cohort_grant_log
      (event_id,seq,cohort_id,programme_id,grantee_id,actor_id,role,action,reason,request_id,occurred_at,step_up_at,auth_session_id)
    VALUES (NEW.id,NEW.seq,NEW.cohort_id,NEW.programme_id,NEW.grantee_id,NEW.actor_id,
      NEW.role,NEW.action,NEW.reason,NEW.request_id,NEW.occurred_at,NEW.step_up_at,NEW.auth_session_id);
    RETURN NEW;
END $$;
CREATE TRIGGER exercise_book_grant_audit AFTER INSERT ON public.exercise_book_cohort_grants
 FOR EACH ROW EXECUTE FUNCTION public.fn_eb_grant_audit();

CREATE FUNCTION public.fn_record_cohort_grant(
 p_actor_id uuid,p_step_up_at timestamptz,p_cohort_id uuid,p_programme_id text,
 p_grantee_id uuid,p_role text,p_action text,p_reason text,p_request_id uuid,p_auth_session_id text DEFAULT NULL)
RETURNS TABLE(event_id uuid,seq bigint,occurred_at timestamptz,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE old_event public.exercise_book_cohort_grants%ROWTYPE; latest_action text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('eb_grant:'||p_cohort_id||':'||p_programme_id,0));
    PERFORM public.fn_eb_require_owner(p_actor_id);
    IF p_step_up_at IS NULL OR p_step_up_at<clock_timestamp()-interval '600 seconds'
       OR p_step_up_at>clock_timestamp()+interval '30 seconds' THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE='EB403';
    END IF;
    PERFORM public.fn_eb_require_cohort(p_cohort_id,p_programme_id);
    IF p_grantee_id=p_actor_id THEN RAISE EXCEPTION 'self_grant' USING ERRCODE='EB422'; END IF;
    PERFORM 1 FROM public.users u WHERE u.id=p_grantee_id
      AND (p_action IS DISTINCT FROM 'grant' OR
        (u.is_active AND u.suspended_at IS NULL AND u.role='admin')) FOR SHARE;
    IF NOT FOUND OR p_role IS NULL OR p_role NOT IN ('assigner','teacher')
      OR p_action IS NULL OR p_action NOT IN ('grant','revoke') OR p_request_id IS NULL
      OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422';
    END IF;
    IF p_auth_session_id IS NOT NULL AND p_auth_session_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422';
    END IF;
    -- Session correlation is not a replay fingerprint: retain the first session.
    -- The request lock also isolates request_id collisions across cohorts.
    PERFORM pg_advisory_xact_lock(hashtextextended('eb_grant_request:'||p_request_id,0));
    SELECT g.* INTO old_event FROM public.exercise_book_cohort_grants g WHERE g.request_id=p_request_id;
    IF FOUND THEN
        IF ROW(old_event.actor_id,old_event.cohort_id,old_event.programme_id,old_event.grantee_id,
          old_event.role,old_event.action,old_event.reason) IS DISTINCT FROM
          ROW(p_actor_id,p_cohort_id,p_programme_id,p_grantee_id,p_role,p_action,btrim(p_reason)) THEN
            RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='EB409';
        END IF;
        RETURN QUERY SELECT old_event.id,old_event.seq,old_event.occurred_at,true; RETURN;
    END IF;
    SELECT g.action INTO latest_action FROM public.exercise_book_cohort_grants g
      WHERE g.cohort_id=p_cohort_id AND g.programme_id=p_programme_id
        AND g.grantee_id=p_grantee_id AND g.role=p_role ORDER BY g.seq DESC LIMIT 1;
    IF (p_action='grant' AND latest_action='grant') OR
       (p_action='revoke' AND latest_action IS DISTINCT FROM 'grant') THEN
        RAISE EXCEPTION 'grant_state_unchanged' USING ERRCODE='EB409';
    END IF;
    INSERT INTO public.exercise_book_cohort_grants
      (actor_id,step_up_at,cohort_id,programme_id,grantee_id,role,action,reason,request_id,auth_session_id)
    VALUES (p_actor_id,p_step_up_at,p_cohort_id,p_programme_id,p_grantee_id,p_role,p_action,btrim(p_reason),p_request_id,p_auth_session_id)
    RETURNING * INTO old_event;
    RETURN QUERY SELECT old_event.id,old_event.seq,old_event.occurred_at,false;
END $$;

CREATE FUNCTION public.fn_list_cohort_grants(p_actor_id uuid,p_step_up_at timestamptz,p_cohort_id uuid,p_programme_id text)
RETURNS TABLE(grantee_id uuid,display_name text,role text,state text,last_event_seq bigint,last_event_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM public.fn_eb_require_owner(p_actor_id);
    IF p_step_up_at IS NULL OR p_step_up_at<clock_timestamp()-interval '600 seconds'
       OR p_step_up_at>clock_timestamp()+interval '30 seconds' THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE='EB403';
    END IF;
    PERFORM public.fn_eb_require_cohort(p_cohort_id,p_programme_id);
    RETURN QUERY SELECT g.grantee_id,COALESCE(NULLIF(btrim(u.display_name),''),u.email,'Người dùng'),g.role,
      CASE g.action WHEN 'grant' THEN 'granted' ELSE 'revoked' END,g.seq,g.occurred_at
    FROM (SELECT DISTINCT ON (x.grantee_id,x.role) x.* FROM public.exercise_book_cohort_grants x
      WHERE x.cohort_id=p_cohort_id AND x.programme_id=p_programme_id ORDER BY x.grantee_id,x.role,x.seq DESC) g
    JOIN public.users u ON u.id=g.grantee_id
    ORDER BY COALESCE(NULLIF(btrim(u.display_name),''),u.email,'Người dùng'),g.grantee_id,g.role;
END $$;
CREATE FUNCTION public.fn_read_cohort_grant_log(p_actor_id uuid,p_step_up_at timestamptz,p_cohort_id uuid,p_programme_id text,
 p_limit integer DEFAULT 50,p_before_seq bigint DEFAULT NULL)
RETURNS TABLE(event_id uuid,seq bigint,actor_id uuid,grantee_id uuid,role text,action text,
 occurred_at timestamptz,reason text,request_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM public.fn_eb_require_owner(p_actor_id);
    IF p_step_up_at IS NULL OR p_step_up_at<clock_timestamp()-interval '600 seconds'
       OR p_step_up_at>clock_timestamp()+interval '30 seconds' THEN
        RAISE EXCEPTION 'step_up_required' USING ERRCODE='EB403';
    END IF;
    PERFORM public.fn_eb_require_cohort(p_cohort_id,p_programme_id);
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    RETURN QUERY SELECT g.event_id,g.seq,g.actor_id,g.grantee_id,g.role,g.action,g.occurred_at,g.reason,g.request_id
      FROM public.exercise_book_cohort_grant_log g WHERE g.cohort_id=p_cohort_id AND g.programme_id=p_programme_id
        AND (p_before_seq IS NULL OR g.seq<p_before_seq) ORDER BY g.seq DESC LIMIT p_limit;
END $$;
CREATE FUNCTION public.fn_exercise_book_actor_access(p_actor_id uuid,p_cohort_id uuid,p_programme_id text)
RETURNS TABLE(is_owner boolean,roles text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE owner_found boolean:=false; granted_roles text[]:='{}';
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('eb_grant:'||p_cohort_id||':'||p_programme_id,0));
    PERFORM 1 FROM public.users u WHERE u.id=p_actor_id AND u.is_active
      AND u.suspended_at IS NULL AND u.role='admin' FOR SHARE;
    IF NOT FOUND THEN RETURN QUERY SELECT false,granted_roles; RETURN; END IF;
    PERFORM public.fn_eb_require_cohort(p_cohort_id,p_programme_id);
    SELECT true INTO owner_found FROM public.exercise_book_grant_owners o WHERE o.user_id=p_actor_id FOR SHARE;
    IF COALESCE(owner_found,false) THEN RETURN QUERY SELECT true,ARRAY['assigner']; RETURN; END IF;
    SELECT COALESCE(array_agg(g.role ORDER BY g.role),'{}') INTO granted_roles FROM
      (SELECT DISTINCT ON (x.role) x.role,x.action FROM public.exercise_book_cohort_grants x
       WHERE x.cohort_id=p_cohort_id AND x.programme_id=p_programme_id AND x.grantee_id=p_actor_id
       ORDER BY x.role,x.seq DESC) g WHERE g.action='grant';
    RETURN QUERY SELECT false,granted_roles;
END $$;

-- Fail closed under both PostgreSQL and Supabase default privileges.
REVOKE ALL ON FUNCTION public.fn_eb_append_only() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_owner_audit() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_require_owner(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_require_cohort(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_grant_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_grant_audit() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_record_cohort_grant(uuid,timestamptz,uuid,text,uuid,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_cohort_grant(uuid,timestamptz,uuid,text,uuid,text,text,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_list_cohort_grants(uuid,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_cohort_grants(uuid,timestamptz,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_read_cohort_grant_log(uuid,timestamptz,uuid,text,integer,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_read_cohort_grant_log(uuid,timestamptz,uuid,text,integer,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.fn_exercise_book_actor_access(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_exercise_book_actor_access(uuid,uuid,text) TO service_role;
ALTER TABLE public.exercise_book_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exercise_book_registry FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.exercise_book_registry TO service_role;
ALTER TABLE public.exercise_book_grant_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exercise_book_grant_owners FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.exercise_book_grant_owners TO service_role;
ALTER TABLE public.exercise_book_grant_owner_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exercise_book_grant_owner_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.exercise_book_grant_owner_audit TO service_role;
ALTER TABLE public.exercise_book_cohort_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exercise_book_cohort_grants FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.exercise_book_cohort_grants TO service_role;
ALTER TABLE public.exercise_book_cohort_grant_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exercise_book_cohort_grant_log FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.exercise_book_cohort_grant_log TO service_role;
REVOKE ALL ON SEQUENCE public.exercise_book_cohort_grants_seq_seq,public.exercise_book_grant_owner_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE signature text; function_oid oid; relation_name text; relation_oid oid; allowed boolean;
BEGIN
    signature:='public.fn_eb_append_only()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_owner_audit()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_require_owner(uuid)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_require_cohort(uuid,text)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_grant_insert_guard()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_grant_audit()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_record_cohort_grant(uuid,timestamptz,uuid,text,uuid,text,text,text,uuid,text)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_list_cohort_grants(uuid,timestamptz,uuid,text)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_read_cohort_grant_log(uuid,timestamptz,uuid,text,integer,bigint)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_exercise_book_actor_access(uuid,uuid,text)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.exercise_book_registry';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.exercise_book_grant_owners';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.exercise_book_grant_owner_audit';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.exercise_book_cohort_grants';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.exercise_book_cohort_grant_log';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_grant_owners'::regclass AND tgname='exercise_book_owner_audit'
      AND tgfoid='public.fn_eb_owner_audit()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_grant_owners'::regclass AND tgname='exercise_book_owner_no_truncate'
      AND tgfoid='public.fn_eb_append_only()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_cohort_grants'::regclass AND tgname='exercise_book_grants_immutable'
      AND tgfoid='public.fn_eb_append_only()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_cohort_grant_log'::regclass AND tgname='exercise_book_log_immutable'
      AND tgfoid='public.fn_eb_append_only()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_cohort_grants'::regclass AND tgname='exercise_book_grant_owner_guard'
      AND tgfoid='public.fn_eb_grant_insert_guard()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_cohort_grants'::regclass AND tgname='exercise_book_grant_audit'
      AND tgfoid='public.fn_eb_grant_audit()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    FOREACH relation_name IN ARRAY ARRAY['public.exercise_book_cohort_grants_seq_seq','public.exercise_book_grant_owner_audit_id_seq'] LOOP
      relation_oid:=to_regclass(relation_name);
      IF relation_oid IS NULL OR EXISTS (
        SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) a
        WHERE c.oid=relation_oid AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) THEN
        RAISE EXCEPTION 'exercise_book_sequence_postcondition' USING ERRCODE='55000';
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.exercise_book_grant_owners'::regclass
      AND contype='c' AND pg_get_constraintdef(oid)='CHECK ((step_up_max_seconds = 600))') THEN
      RAISE EXCEPTION 'exercise_book_step_up_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_grant_owner_audit'::regclass
      AND tgname='exercise_book_owner_audit_immutable' AND tgfoid='public.fn_eb_append_only()'::regprocedure
      AND tgtype=58 AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
END $$;
COMMIT;
