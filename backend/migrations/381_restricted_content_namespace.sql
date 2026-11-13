-- FU-2281-NAMESPACE M-A. Pending feature: no apply on merge.
-- SA review and Vinh approval required for each run. PostgreSQL 16 compatible.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.content_access_namespaces (
    programme_id text PRIMARY KEY,
    metadata_key text,
    scope text NOT NULL CHECK (scope = 'assignment_only'),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.content_access_namespaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_access_namespaces FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.content_access_namespaces TO service_role;
INSERT INTO public.content_access_namespaces(programme_id, metadata_key, scope)
VALUES ('blackeye-v5-upper-listening', 'blackeye', 'assignment_only');

-- Retained columns make a reviewed rollback/reapply possible without losing stamps.
ALTER TABLE public.listening_tests ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
ALTER TABLE public.listening_content ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
ALTER TABLE public.listening_test_attempts ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
ALTER TABLE public.dictation_sessions ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.fn_namespace_matches(p_programme_id text, p_metadata jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
    SELECT (p_metadata IS NOT NULL AND pg_catalog.jsonb_typeof(p_metadata) NOT IN ('object', 'null'))
        OR EXISTS (
            SELECT 1 FROM public.content_access_namespaces AS ns
             WHERE ns.scope = 'assignment_only'
               AND (ns.programme_id = p_programme_id
                    OR (pg_catalog.jsonb_typeof(p_metadata) = 'object'
                        AND p_metadata ? ns.metadata_key))
        );
$$;

CREATE FUNCTION public.fn_content_is_restricted(p_kind text, p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE flag boolean;
BEGIN
    CASE p_kind
        WHEN 'listening' THEN SELECT t.restricted INTO flag FROM public.listening_tests AS t WHERE t.id = p_id;
        WHEN 'content' THEN SELECT c.restricted INTO flag FROM public.listening_content AS c WHERE c.id = p_id;
        WHEN 'attempt' THEN SELECT a.restricted INTO flag FROM public.listening_test_attempts AS a WHERE a.id = p_id;
        WHEN 'dictation' THEN SELECT s.restricted INTO flag FROM public.dictation_sessions AS s WHERE s.id = p_id;
        ELSE RETURN true;
    END CASE;
    RETURN COALESCE(flag, true);
END;
$$;

-- Walk the supplied NEW provenance, then persisted ancestors. UNION-style
-- visited detection fails closed on cycles without a recursion-depth cutoff.
CREATE FUNCTION public.fn_namespace_content_restricted(
    p_id uuid, p_test_id uuid, p_source_test_id uuid, p_parent_content_id uuid, p_metadata jsonb
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    seen uuid[] := ARRAY[p_id];
    parent_id uuid := p_parent_content_id;
    ancestor public.listening_content%ROWTYPE;
BEGIN
    IF public.fn_namespace_matches(NULL, p_metadata)
       OR (p_test_id IS NOT NULL AND public.fn_content_is_restricted('listening', p_test_id))
       OR (p_source_test_id IS NOT NULL AND public.fn_content_is_restricted('listening', p_source_test_id)) THEN
        RETURN true;
    END IF;
    WHILE parent_id IS NOT NULL LOOP
        IF parent_id = ANY(seen) THEN RETURN true; END IF;
        seen := pg_catalog.array_append(seen, parent_id);
        SELECT c.* INTO ancestor FROM public.listening_content AS c WHERE c.id = parent_id;
        IF NOT FOUND THEN RETURN true; END IF;
        IF ancestor.restricted IS DISTINCT FROM false
           OR public.fn_namespace_matches(NULL, ancestor.metadata)
           OR (ancestor.test_id IS NOT NULL AND public.fn_content_is_restricted('listening', ancestor.test_id))
           OR (ancestor.source_test_id IS NOT NULL AND public.fn_content_is_restricted('listening', ancestor.source_test_id)) THEN
            RETURN true;
        END IF;
        parent_id := ancestor.parent_content_id;
    END LOOP;
    RETURN false;
END;
$$;

CREATE FUNCTION public.fn_namespace_dictation_restricted(p_test_id uuid, p_external text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE matches bigint; unsafe boolean;
BEGIN
    IF p_test_id IS NOT NULL AND public.fn_content_is_restricted('listening', p_test_id) THEN RETURN true; END IF;
    IF NULLIF(pg_catalog.btrim(p_external), '') IS NOT NULL THEN
        SELECT pg_catalog.count(*), pg_catalog.bool_or(t.restricted IS DISTINCT FROM false
                   OR (p_test_id IS NOT NULL AND t.id <> p_test_id))
          INTO matches, unsafe FROM public.listening_tests AS t WHERE t.test_id = p_external;
        -- Ambiguous external identities are also fail closed, even if both are ordinary.
        RETURN matches <> 1 OR COALESCE(unsafe, true);
    END IF;
    RETURN p_test_id IS NULL;
END;
$$;

CREATE FUNCTION public.fn_stamp_content_namespace()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE calculated boolean := false;
BEGIN
    -- Deliberately unconditional: no custom GUC can authorize lowering a stamp.
    -- Unrestriction requires a separately reviewed owner migration, not an RPC.
    IF TG_OP = 'UPDATE' AND OLD.restricted IS TRUE AND NEW.restricted IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'content_namespace_restriction_is_sticky';
    END IF;
    CASE TG_TABLE_NAME
        WHEN 'listening_tests' THEN
            calculated := public.fn_namespace_matches(NEW.programme_id, NEW.metadata);
        WHEN 'listening_content' THEN
            calculated := public.fn_namespace_content_restricted(
                NEW.id, NEW.test_id, NEW.source_test_id, NEW.parent_content_id, NEW.metadata);
        WHEN 'listening_test_attempts' THEN
            calculated := public.fn_content_is_restricted('listening', NEW.test_id)
                OR EXISTS (
                    SELECT 1 FROM public.mock_paper_attempt_snapshots AS s
                     WHERE s.skill = 'listening' AND s.attempt_id = NEW.id
                       AND (pg_catalog.jsonb_typeof(s.paper_row) IS DISTINCT FROM 'object'
                            OR public.fn_namespace_matches(s.paper_row->>'programme_id', s.paper_row->'metadata'))
                );
        WHEN 'dictation_sessions' THEN
            calculated := public.fn_namespace_dictation_restricted(NEW.test_id, NEW.test_id_external);
        ELSE RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'unexpected_namespace_trigger_table';
    END CASE;
    NEW.restricted := COALESCE(NEW.restricted, false) OR COALESCE(calculated, true);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_content_namespace_stamp BEFORE INSERT OR UPDATE OF programme_id, metadata, restricted
ON public.listening_tests FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_content_namespace();
CREATE TRIGGER trg_content_namespace_stamp BEFORE INSERT OR UPDATE OF test_id, source_test_id, parent_content_id, metadata, restricted
ON public.listening_content FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_content_namespace();
CREATE TRIGGER trg_content_namespace_stamp BEFORE INSERT OR UPDATE OF test_id, restricted
ON public.listening_test_attempts FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_content_namespace();
CREATE TRIGGER trg_content_namespace_stamp BEFORE INSERT OR UPDATE OF test_id, test_id_external, restricted
ON public.dictation_sessions FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_content_namespace();

CREATE FUNCTION public.fn_cascade_content_namespace()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.restricted IS NOT TRUE OR (TG_OP = 'UPDATE' AND OLD.restricted IS TRUE) THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'listening_tests' THEN
        WITH RECURSIVE descendants(id) AS (
            SELECT c.id FROM public.listening_content AS c WHERE c.test_id = NEW.id OR c.source_test_id = NEW.id
            UNION
            SELECT c.id FROM public.listening_content AS c JOIN descendants AS d ON c.parent_content_id = d.id
        )
        UPDATE public.listening_content AS c SET restricted = true
         WHERE c.id IN (SELECT d.id FROM descendants AS d) AND c.restricted IS DISTINCT FROM true;
        UPDATE public.listening_test_attempts AS a SET restricted = true
         WHERE a.test_id = NEW.id AND a.restricted IS DISTINCT FROM true;
        UPDATE public.dictation_sessions AS s SET restricted = true
         WHERE (s.test_id = NEW.id OR s.test_id_external = NEW.test_id
                OR (TG_OP = 'UPDATE' AND s.test_id_external = OLD.test_id))
           AND s.restricted IS DISTINCT FROM true;
    ELSE
        WITH RECURSIVE descendants(id) AS (
            SELECT c.id FROM public.listening_content AS c WHERE c.parent_content_id = NEW.id
            UNION
            SELECT c.id FROM public.listening_content AS c JOIN descendants AS d ON c.parent_content_id = d.id
        )
        UPDATE public.listening_content AS c SET restricted = true
         WHERE c.id IN (SELECT d.id FROM descendants AS d) AND c.restricted IS DISTINCT FROM true;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_content_namespace_cascade AFTER INSERT OR UPDATE
ON public.listening_tests FOR EACH ROW EXECUTE FUNCTION public.fn_cascade_content_namespace();
CREATE TRIGGER trg_content_namespace_cascade AFTER INSERT OR UPDATE
ON public.listening_content FOR EACH ROW EXECUTE FUNCTION public.fn_cascade_content_namespace();

-- 306 captures a snapshot AFTER attempt insertion. Preserve its frozen namespace
-- as well as the current test's stamp, including historical snapshots at backfill.
CREATE FUNCTION public.fn_stamp_snapshot_content_namespace()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.skill = 'listening' AND (
        pg_catalog.jsonb_typeof(NEW.paper_row) IS DISTINCT FROM 'object'
        OR public.fn_namespace_matches(NEW.paper_row->>'programme_id', NEW.paper_row->'metadata')
    ) THEN
        UPDATE public.listening_test_attempts AS a SET restricted = true
         WHERE a.id = NEW.attempt_id AND a.restricted IS DISTINCT FROM true;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_content_namespace_snapshot AFTER INSERT ON public.mock_paper_attempt_snapshots
FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_snapshot_content_namespace();

-- UUID keyset batches bound each UPDATE. Existing true values never decrease.
-- Test stamps precede content ancestry and activity stamps; cascades also cover
-- descendants outside the current batch. Unresolved OLD dictation is restricted.
DO $$
DECLARE table_name text; cursor_id uuid; last_id uuid; unresolved bigint;
BEGIN
    SELECT pg_catalog.count(*) INTO unresolved FROM public.dictation_sessions AS s
     WHERE public.fn_namespace_dictation_restricted(s.test_id, s.test_id_external);
    RAISE NOTICE '381 dictation backfill: % restricted or unresolved rows', unresolved;
    FOREACH table_name IN ARRAY ARRAY['listening_tests', 'listening_content', 'listening_test_attempts', 'dictation_sessions'] LOOP
        cursor_id := NULL;
        LOOP
            EXECUTE pg_catalog.format(
                'SELECT id FROM public.%I WHERE ($1 IS NULL OR id > $1) ORDER BY id LIMIT 1 OFFSET 999', table_name)
                INTO last_id USING cursor_id;
            IF last_id IS NULL THEN
                EXECUTE pg_catalog.format('UPDATE public.%I SET restricted = restricted WHERE ($1 IS NULL OR id > $1)', table_name)
                    USING cursor_id;
                EXIT;
            END IF;
            EXECUTE pg_catalog.format(
                'UPDATE public.%I SET restricted = restricted WHERE ($1 IS NULL OR id > $1) AND id <= $2', table_name)
                USING cursor_id, last_id;
            cursor_id := last_id;
        END LOOP;
    END LOOP;
END;
$$;

CREATE VIEW public.v_listening_tests_public WITH (security_barrier=true) AS
SELECT t.* FROM public.listening_tests AS t WHERE NOT t.restricted;
CREATE VIEW public.v_listening_content_public WITH (security_barrier=true) AS
SELECT c.* FROM public.listening_content AS c WHERE NOT c.restricted;
CREATE VIEW public.v_listening_attempts_public WITH (security_barrier=true) AS
SELECT a.* FROM public.listening_test_attempts AS a WHERE NOT a.restricted;
CREATE VIEW public.v_dictation_sessions_public WITH (security_barrier=true) AS
SELECT s.* FROM public.dictation_sessions AS s WHERE NOT s.restricted;
REVOKE ALL ON public.v_listening_tests_public, public.v_listening_content_public,
    public.v_listening_attempts_public, public.v_dictation_sessions_public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_listening_tests_public, public.v_listening_content_public,
    public.v_listening_attempts_public, public.v_dictation_sessions_public TO service_role;

-- Transactional indexes: RM must measure write-lock duration before each run.
CREATE INDEX ix_listening_tests_unrestricted ON public.listening_tests(status, test_type) WHERE NOT restricted;
CREATE INDEX ix_listening_content_unrestricted ON public.listening_content(status, test_id) WHERE NOT restricted;
CREATE INDEX ix_listening_attempts_unrestricted ON public.listening_test_attempts(user_id, created_at DESC) WHERE NOT restricted;
CREATE INDEX ix_dictation_sessions_unrestricted ON public.dictation_sessions(created_at DESC) WHERE NOT restricted;

REVOKE ALL ON FUNCTION public.fn_namespace_matches(text,jsonb), public.fn_content_is_restricted(text,uuid),
    public.fn_namespace_content_restricted(uuid,uuid,uuid,uuid,jsonb), public.fn_namespace_dictation_restricted(uuid,text),
    public.fn_stamp_content_namespace(), public.fn_cascade_content_namespace(), public.fn_stamp_snapshot_content_namespace()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_namespace_matches(text,jsonb), public.fn_content_is_restricted(text,uuid),
    public.fn_namespace_content_restricted(uuid,uuid,uuid,uuid,jsonb), public.fn_namespace_dictation_restricted(uuid,text)
    TO service_role;

CREATE FUNCTION public.fn_content_namespace_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
    SELECT
        EXISTS (SELECT 1 FROM public.content_access_namespaces AS ns
                 WHERE ns.programme_id = 'blackeye-v5-upper-listening'
                   AND ns.metadata_key = 'blackeye' AND ns.scope = 'assignment_only')
        AND (SELECT c.relrowsecurity AND c.relowner = 'postgres'::pg_catalog.regrole
               FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.content_access_namespaces'::pg_catalog.regclass)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p
                         WHERE p.polrelid = 'public.content_access_namespaces'::pg_catalog.regclass)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables AS p
                         WHERE p.schemaname = 'public' AND p.tablename IN (
                             'content_access_namespaces', 'v_listening_tests_public', 'v_listening_content_public',
                             'v_listening_attempts_public', 'v_dictation_sessions_public'))
        AND (SELECT pg_catalog.count(*) = 4 FROM pg_catalog.pg_attribute AS a
              JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid IN ('public.listening_tests'::pg_catalog.regclass, 'public.listening_content'::pg_catalog.regclass,
                                 'public.listening_test_attempts'::pg_catalog.regclass, 'public.dictation_sessions'::pg_catalog.regclass)
               AND a.attname = 'restricted' AND a.atttypid = 'boolean'::pg_catalog.regtype AND a.attnotnull AND NOT a.attisdropped
               AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'false')
        AND (SELECT pg_catalog.count(*) = 7 FROM pg_catalog.pg_trigger AS t
             WHERE (t.tgrelid, t.tgname) IN (
                 ('public.listening_tests'::pg_catalog.regclass, 'trg_content_namespace_stamp'),
                 ('public.listening_content'::pg_catalog.regclass, 'trg_content_namespace_stamp'),
                 ('public.listening_test_attempts'::pg_catalog.regclass, 'trg_content_namespace_stamp'),
                 ('public.dictation_sessions'::pg_catalog.regclass, 'trg_content_namespace_stamp'),
                 ('public.listening_tests'::pg_catalog.regclass, 'trg_content_namespace_cascade'),
                 ('public.listening_content'::pg_catalog.regclass, 'trg_content_namespace_cascade'),
                 ('public.mock_paper_attempt_snapshots'::pg_catalog.regclass, 'trg_content_namespace_snapshot'))
               AND t.tgenabled = 'O' AND NOT t.tgisinternal)
        AND (SELECT pg_catalog.count(*) = 8 FROM pg_catalog.pg_proc AS p
              JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN (
                 'fn_namespace_matches', 'fn_content_is_restricted', 'fn_namespace_content_restricted',
                 'fn_namespace_dictation_restricted', 'fn_stamp_content_namespace', 'fn_cascade_content_namespace',
                 'fn_stamp_snapshot_content_namespace', 'fn_content_namespace_ready')
               AND NOT p.prosecdef AND p.proowner = 'postgres'::pg_catalog.regrole
               AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp'])
        AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc AS p
              JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
              CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
             WHERE n.nspname = 'public' AND p.proname IN (
                 'fn_namespace_matches', 'fn_content_is_restricted', 'fn_namespace_content_restricted',
                 'fn_namespace_dictation_restricted', 'fn_stamp_content_namespace', 'fn_cascade_content_namespace',
                 'fn_stamp_snapshot_content_namespace', 'fn_content_namespace_ready')
               AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
                    OR acl.is_grantable OR acl.privilege_type <> 'EXECUTE'))
        AND (SELECT pg_catalog.count(*) = 4 FROM pg_catalog.pg_class AS c
              JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN (
                 'v_listening_tests_public', 'v_listening_content_public', 'v_listening_attempts_public', 'v_dictation_sessions_public')
               AND c.relkind = 'v' AND c.reloptions @> ARRAY['security_barrier=true']
               AND pg_catalog.pg_get_viewdef(c.oid) LIKE '%NOT %.restricted%'
               AND pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT'))
        AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
              CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
             WHERE n.nspname = 'public' AND c.relname IN (
                 'content_access_namespaces', 'v_listening_tests_public', 'v_listening_content_public',
                 'v_listening_attempts_public', 'v_dictation_sessions_public')
               AND acl.grantee <> c.relowner
               AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
        AND (SELECT pg_catalog.count(*) = 4 FROM pg_catalog.pg_index AS i
             WHERE i.indexrelid IN (
                 pg_catalog.to_regclass('public.ix_listening_tests_unrestricted'),
                 pg_catalog.to_regclass('public.ix_listening_content_unrestricted'),
                 pg_catalog.to_regclass('public.ix_listening_attempts_unrestricted'),
                 pg_catalog.to_regclass('public.ix_dictation_sessions_unrestricted'))
               AND i.indisvalid AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(NOT restricted)');
$$;
REVOKE ALL ON FUNCTION public.fn_content_namespace_ready() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_content_namespace_ready() TO service_role;

DO $$
BEGIN
    IF public.fn_content_namespace_ready() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '381 namespace catalog postcondition failed';
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
