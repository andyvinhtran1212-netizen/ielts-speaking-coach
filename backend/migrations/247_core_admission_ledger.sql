-- Durable admission foundation; no source-table writes, backfill or activation.
-- No epoch is opened by this migration. Server integration defaults OFF.
-- service_role may execute the bounded RPCs, but cannot mutate ledger tables.
-- Only future domain-specific executor RPCs may bind canonical writes atomically.
-- Owner maintenance/erasure is outside this boundary and invalidates affected
-- coverage proofs. Cascades do not authorize deletion or a retention policy.
BEGIN;

CREATE TABLE IF NOT EXISTS public.core_admission_epochs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL CHECK (domain IN ('speaking_session', 'speaking_full_test',
        'reading_exam', 'listening_test', 'listening_dictation',
        'writing_assignment', 'mock_writing')),
    enrollment_digest TEXT NOT NULL CHECK (enrollment_digest ~ '^[a-f0-9]{64}$'),
    -- Historical predecessor reference, deliberately survives owner erasure.
    predecessor_id UUID,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    closed_at TIMESTAMPTZ,
    CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
    UNIQUE (id, domain)
);
CREATE UNIQUE INDEX IF NOT EXISTS core_admission_one_open_epoch
    ON public.core_admission_epochs(domain) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS public.core_admission_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL,
    domain TEXT NOT NULL,
    scope_key UUID NOT NULL,
    resource_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (principal_id, domain, scope_key),
    UNIQUE (id, principal_id, domain)
);

CREATE TABLE IF NOT EXISTS public.core_attempt_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id UUID NOT NULL UNIQUE,
    principal_id UUID NOT NULL,
    domain TEXT NOT NULL,
    first_admission_epoch_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, principal_id, domain),
    FOREIGN KEY (scope_id, principal_id, domain)
        REFERENCES public.core_admission_scopes(id, principal_id, domain) ON DELETE CASCADE,
    FOREIGN KEY (first_admission_epoch_id, domain)
        REFERENCES public.core_admission_epochs(id, domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS core_episodes_first_epoch
    ON public.core_attempt_episodes(first_admission_epoch_id, domain);

CREATE TABLE IF NOT EXISTS public.core_admission_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'admission-v1' CHECK (protocol = 'admission-v1'),
    nonce_digest TEXT NOT NULL CHECK (nonce_digest ~ '^[a-f0-9]{64}$'),
    semantic_digest TEXT NOT NULL CHECK (semantic_digest ~ '^[a-f0-9]{64}$'),
    episode_id UUID NOT NULL,
    domain TEXT NOT NULL,
    activity_epoch_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('start', 'resume')),
    phase TEXT NOT NULL DEFAULT 'accepted' CHECK (phase IN ('accepted', 'bound', 'unstarted_expired')),
    generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
    execute_before TIMESTAMPTZ NOT NULL CHECK (isfinite(execute_before)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (principal_id, protocol, nonce_digest),
    UNIQUE (id, episode_id),
    FOREIGN KEY (episode_id, principal_id, domain)
        REFERENCES public.core_attempt_episodes(id, principal_id, domain) ON DELETE CASCADE,
    FOREIGN KEY (activity_epoch_id, domain)
        REFERENCES public.core_admission_epochs(id, domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS core_admission_commands_episode
    ON public.core_admission_commands(episode_id, principal_id, domain);
CREATE INDEX IF NOT EXISTS core_admission_commands_epoch
    ON public.core_admission_commands(activity_epoch_id, domain);
CREATE INDEX IF NOT EXISTS core_admission_commands_due
    ON public.core_admission_commands(execute_before, id) WHERE phase = 'accepted';

CREATE TABLE IF NOT EXISTS public.core_admission_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id UUID NOT NULL UNIQUE,
    principal_id UUID NOT NULL,
    domain TEXT NOT NULL,
    canonical_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (domain, canonical_id),
    FOREIGN KEY (episode_id, principal_id, domain)
        REFERENCES public.core_attempt_episodes(id, principal_id, domain) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.core_admission_journal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id UUID NOT NULL REFERENCES public.core_admission_commands(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL,
    transition TEXT NOT NULL CHECK (transition IN ('accepted', 'bound', 'unstarted_expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (command_id, generation, transition)
);

-- Existing objects must retain the uniqueness relied on by scope resolution
-- and replay. IF NOT EXISTS alone would silently accept an unsafe old schema.
DO $$
DECLARE requirement RECORD; target REGCLASS;
BEGIN
    FOR requirement IN SELECT * FROM (VALUES
        ('core_admission_epochs', ARRAY['id','domain']),
        ('core_admission_scopes', ARRAY['principal_id','domain','scope_key']),
        ('core_admission_scopes', ARRAY['id','principal_id','domain']),
        ('core_attempt_episodes', ARRAY['scope_id']),
        ('core_attempt_episodes', ARRAY['id','principal_id','domain']),
        ('core_admission_commands', ARRAY['principal_id','protocol','nonce_digest']),
        ('core_admission_commands', ARRAY['id','episode_id']),
        ('core_admission_bindings', ARRAY['episode_id']),
        ('core_admission_bindings', ARRAY['domain','canonical_id']),
        ('core_admission_journal', ARRAY['command_id','generation','transition'])
    ) AS expected(table_name, columns)
    LOOP
        target := ('public.' || requirement.table_name)::regclass;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c WHERE c.conrelid=target
            AND c.contype='u' AND c.convalidated AND NOT c.condeferrable
            AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
                 FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
                 JOIN pg_attribute a ON a.attrelid=target AND a.attnum=k.attnum)
                = requirement.columns
        ) THEN
            RAISE EXCEPTION 'admission_uniqueness_drift' USING ERRCODE='ZA004';
        END IF;
    END LOOP;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indexrelid='public.core_admission_one_open_epoch'::regclass
          AND i.indrelid='public.core_admission_epochs'::regclass
          AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnkeyatts=1
          AND i.indkey[0]=(SELECT attnum FROM pg_attribute
              WHERE attrelid=i.indrelid AND attname='domain')
          AND pg_get_expr(i.indpred,i.indrelid) = '(state = ''open''::text)'
    ) THEN
        RAISE EXCEPTION 'admission_epoch_index_drift' USING ERRCODE='ZA004';
    END IF;
END $$;

-- No content, bearer token, email or raw nonce is stored. principal_id/scope and
-- resource IDs are private pseudonymous references, NOT proof of organic use.
ALTER TABLE public.core_admission_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_admission_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_attempt_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_admission_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_admission_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_admission_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_admission_epochs, public.core_admission_scopes,
    public.core_attempt_episodes, public.core_admission_commands,
    public.core_admission_bindings, public.core_admission_journal
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_core_admission_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF TG_TABLE_NAME = 'core_admission_commands' THEN
        IF (to_jsonb(NEW) - ARRAY['phase','generation','updated_at']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['phase','generation','updated_at'])
           OR OLD.phase <> 'accepted'
           OR NEW.phase NOT IN ('bound', 'unstarted_expired')
           OR NEW.generation <> OLD.generation + (CASE WHEN NEW.phase='unstarted_expired' THEN 1 ELSE 0 END) THEN
            RAISE EXCEPTION 'admission_invalid_transition' USING ERRCODE='ZA004';
        END IF;
        IF NEW.phase = 'bound' AND NOT EXISTS (
            SELECT 1 FROM public.core_admission_bindings WHERE episode_id=NEW.episode_id
        ) THEN
            RAISE EXCEPTION 'admission_binding_required' USING ERRCODE='ZA004';
        END IF;
        NEW.updated_at := clock_timestamp();
        RETURN NEW;
    ELSIF TG_TABLE_NAME = 'core_admission_epochs' THEN
        IF (to_jsonb(NEW) - ARRAY['state','closed_at','updated_at']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['state','closed_at','updated_at'])
           OR OLD.state <> 'open' OR NEW.state <> 'closed' THEN
            RAISE EXCEPTION 'admission_immutable_epoch' USING ERRCODE='ZA004';
        END IF;
        NEW.closed_at := clock_timestamp();
        NEW.updated_at := NEW.closed_at;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'admission_immutable_identity' USING ERRCODE='ZA004';
END $$;

DROP TRIGGER IF EXISTS core_admission_command_identity ON public.core_admission_commands;
CREATE TRIGGER core_admission_command_identity BEFORE UPDATE ON public.core_admission_commands
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_admission_identity();
DROP TRIGGER IF EXISTS core_admission_epoch_identity ON public.core_admission_epochs;
CREATE TRIGGER core_admission_epoch_identity BEFORE UPDATE ON public.core_admission_epochs
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_admission_identity();
DROP TRIGGER IF EXISTS core_admission_scope_identity ON public.core_admission_scopes;
CREATE TRIGGER core_admission_scope_identity BEFORE UPDATE ON public.core_admission_scopes
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_admission_identity();
DROP TRIGGER IF EXISTS core_admission_episode_identity ON public.core_attempt_episodes;
CREATE TRIGGER core_admission_episode_identity BEFORE UPDATE ON public.core_attempt_episodes
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_admission_identity();
DROP TRIGGER IF EXISTS core_admission_binding_identity ON public.core_admission_bindings;
CREATE TRIGGER core_admission_binding_identity BEFORE UPDATE ON public.core_admission_bindings
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_admission_identity();
DROP TRIGGER IF EXISTS core_admission_journal_identity ON public.core_admission_journal;
CREATE TRIGGER core_admission_journal_identity BEFORE UPDATE ON public.core_admission_journal
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_core_admission_identity();

CREATE OR REPLACE FUNCTION public.fn_journal_core_admission_command()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    INSERT INTO public.core_admission_journal(command_id,generation,transition)
        VALUES (NEW.id,NEW.generation,NEW.phase);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS core_admission_command_journal ON public.core_admission_commands;
CREATE TRIGGER core_admission_command_journal AFTER INSERT OR UPDATE ON public.core_admission_commands
    FOR EACH ROW EXECUTE FUNCTION public.fn_journal_core_admission_command();

-- Operational enrollment only: digest identifies a reviewed writer/config
-- manifest, not verified release coverage. Caller must supply stable epoch UUID
-- on retry and compare-and-set the predecessor. Never called at app startup.
CREATE OR REPLACE FUNCTION public.fn_rotate_core_admission_epoch(
    p_epoch_id UUID, p_domain TEXT, p_enrollment_digest TEXT, p_expected_epoch_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old_id UUID; existing public.core_admission_epochs%ROWTYPE;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_epoch_id IS NULL OR p_domain IS NULL OR p_domain NOT IN (
        'speaking_session','speaking_full_test','reading_exam','listening_test',
        'listening_dictation','writing_assignment','mock_writing')
        OR p_enrollment_digest IS NULL OR p_enrollment_digest !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('core-admission-epoch:' || p_domain,0));
    SELECT * INTO existing FROM public.core_admission_epochs WHERE id=p_epoch_id;
    IF FOUND THEN
        IF existing.domain <> p_domain OR existing.enrollment_digest <> p_enrollment_digest
           OR existing.predecessor_id IS DISTINCT FROM p_expected_epoch_id THEN
            RAISE EXCEPTION 'admission_epoch_conflict' USING ERRCODE='ZA002';
        END IF;
        RETURN existing.id;
    END IF;
    SELECT id INTO old_id FROM public.core_admission_epochs
        WHERE domain=p_domain AND state='open' FOR UPDATE;
    IF old_id IS DISTINCT FROM p_expected_epoch_id THEN
        RAISE EXCEPTION 'admission_epoch_conflict' USING ERRCODE='ZA002';
    END IF;
    IF old_id IS NOT NULL THEN
        UPDATE public.core_admission_epochs SET state='closed' WHERE id=old_id;
    END IF;
    INSERT INTO public.core_admission_epochs(id,domain,enrollment_digest,predecessor_id)
        VALUES (p_epoch_id,p_domain,p_enrollment_digest,old_id);
    RETURN p_epoch_id;
END $$;

-- Transaction A ONLY. Trusted server must validate actor/resource/eligibility
-- and choose a stable domain scope before this call. Not exposed to browsers.
CREATE OR REPLACE FUNCTION public.fn_prepare_core_admission(
    p_principal_id UUID, p_nonce_digest TEXT, p_semantic_digest TEXT,
    p_domain TEXT, p_scope_key UUID, p_resource_id UUID,
    p_action TEXT, p_execute_before TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.core_admission_commands%ROWTYPE;
    s public.core_admission_scopes%ROWTYPE; e public.core_attempt_episodes%ROWTYPE;
    epoch_id UUID;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_principal_id IS NULL OR p_scope_key IS NULL OR p_resource_id IS NULL
       OR p_nonce_digest IS NULL OR p_nonce_digest !~ '^[a-f0-9]{64}$'
       OR p_semantic_digest IS NULL OR p_semantic_digest !~ '^[a-f0-9]{64}$'
       OR p_domain IS NULL OR p_domain NOT IN ('speaking_session','speaking_full_test',
           'reading_exam','listening_test','listening_dictation','writing_assignment','mock_writing')
       OR p_action IS NULL OR p_action NOT IN ('start','resume')
       OR p_execute_before IS NULL OR NOT isfinite(p_execute_before) THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    -- Serialize nonce before scope: a conflicting replay on another scope must
    -- not allocate a second episode or acquire locks in opposite scope order.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'core-admission-nonce:' || p_principal_id::text || ':' || p_nonce_digest,0));
    SELECT * INTO c FROM public.core_admission_commands
        WHERE principal_id=p_principal_id AND protocol='admission-v1' AND nonce_digest=p_nonce_digest;
    IF FOUND THEN
        SELECT * INTO s FROM public.core_admission_scopes
            WHERE id=(SELECT scope_id FROM public.core_attempt_episodes WHERE id=c.episode_id);
        IF c.semantic_digest <> p_semantic_digest OR c.domain <> p_domain
           OR c.action <> p_action OR s.scope_key <> p_scope_key OR s.resource_id <> p_resource_id THEN
            RAISE EXCEPTION 'admission_replay_conflict' USING ERRCODE='ZA002';
        END IF;
    ELSE
        IF p_execute_before <= clock_timestamp() THEN
            RAISE EXCEPTION 'admission_invalid_deadline' USING ERRCODE='ZA001';
        END IF;
        INSERT INTO public.core_admission_scopes(principal_id,domain,scope_key,resource_id)
            VALUES(p_principal_id,p_domain,p_scope_key,p_resource_id)
            ON CONFLICT (principal_id,domain,scope_key) DO NOTHING;
        SELECT * INTO s FROM public.core_admission_scopes
            WHERE principal_id=p_principal_id AND domain=p_domain AND scope_key=p_scope_key FOR UPDATE;
        IF s.resource_id <> p_resource_id THEN
            RAISE EXCEPTION 'admission_scope_conflict' USING ERRCODE='ZA002';
        END IF;
        SELECT id INTO epoch_id FROM public.core_admission_epochs
            WHERE domain=p_domain AND state='open' FOR SHARE;
        IF epoch_id IS NULL THEN
            -- A concurrent close can invalidate this statement's old candidate.
            -- Roll back A and retry the same nonce, never fall back to old start.
            RAISE EXCEPTION 'admission_epoch_unavailable' USING ERRCODE='ZA003';
        END IF;
        SELECT * INTO e FROM public.core_attempt_episodes WHERE scope_id=s.id;
        IF NOT FOUND THEN
            INSERT INTO public.core_attempt_episodes(scope_id,principal_id,domain,first_admission_epoch_id)
                VALUES(s.id,p_principal_id,p_domain,epoch_id) RETURNING * INTO e;
        END IF;
        INSERT INTO public.core_admission_commands(principal_id,nonce_digest,semantic_digest,
            episode_id,domain,activity_epoch_id,action,execute_before)
            VALUES(p_principal_id,p_nonce_digest,p_semantic_digest,e.id,p_domain,epoch_id,p_action,p_execute_before)
            RETURNING * INTO c;
    END IF;
    RETURN jsonb_build_object('command_id',c.id,'episode_id',c.episode_id,
        'activity_epoch_id',c.activity_epoch_id,'phase',c.phase,'generation',c.generation,
        'execute_before',c.execute_before);
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_core_admission(p_principal_id UUID,p_command_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT jsonb_build_object('command_id',c.id,'episode_id',c.episode_id,
        'activity_epoch_id',c.activity_epoch_id,'phase',c.phase,'generation',c.generation,
        'execute_before',c.execute_before)
    FROM public.core_admission_commands c WHERE c.id=p_command_id AND c.principal_id=p_principal_id;
$$;

-- Command-only fencing; never marks an episode abandoned or failed, never
-- modifies canonical work, and never takes a product/scope lock after a command.
CREATE OR REPLACE FUNCTION public.fn_reconcile_core_admission(p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.core_admission_commands%ROWTYPE; fenced INTEGER := 0;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'admission_invalid_batch_size' USING ERRCODE='ZA001';
    END IF;
    FOR c IN SELECT * FROM public.core_admission_commands
        WHERE phase='accepted' AND execute_before <= statement_timestamp()
        ORDER BY execute_before,id LIMIT p_limit FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.core_admission_commands SET phase='unstarted_expired',generation=generation+1
            WHERE id=c.id AND generation=c.generation AND phase='accepted';
        fenced := fenced + 1;
    END LOOP;
    RETURN jsonb_build_object('fenced_commands',fenced,'coverage','unknown','gate_f','not_assessed');
END $$;

REVOKE ALL ON FUNCTION public.fn_guard_core_admission_identity(), public.fn_journal_core_admission_command(),
    public.fn_rotate_core_admission_epoch(UUID,TEXT,TEXT,UUID),
    public.fn_prepare_core_admission(UUID,TEXT,TEXT,TEXT,UUID,UUID,TEXT,TIMESTAMPTZ),
    public.fn_get_core_admission(UUID,UUID), public.fn_reconcile_core_admission(INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rotate_core_admission_epoch(UUID,TEXT,TEXT,UUID),
    public.fn_prepare_core_admission(UUID,TEXT,TEXT,TEXT,UUID,UUID,TEXT,TIMESTAMPTZ),
    public.fn_get_core_admission(UUID,UUID), public.fn_reconcile_core_admission(INTEGER) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
