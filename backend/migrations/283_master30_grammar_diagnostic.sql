-- MASTER30 Grammar Diagnostic: immutable release content, objective sessions,
-- append-only exposure evidence, and class-assignment linkage.
-- Productive tasks are imported for teacher use but are deliberately outside
-- the automatically-scored diagnostic path.

BEGIN;

CREATE TABLE IF NOT EXISTS grammar_content_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_key TEXT NOT NULL UNIQUE,
    manifest_sha256 TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'staging'
        CHECK (status IN ('staging', 'validated', 'active', 'retired', 'rejected')),
    manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
    validation JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(validation) = 'object'),
    live_calibrated_ready BOOLEAN NOT NULL DEFAULT FALSE,
    imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validated_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grammar_content_one_active
    ON grammar_content_releases ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS grammar_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    lesson_no INTEGER NOT NULL CHECK (lesson_no BETWEEN 1 AND 30),
    title TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (release_id, lesson_id),
    UNIQUE (release_id, lesson_no)
);

CREATE TABLE IF NOT EXISTS grammar_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array'),
    correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
    explanation TEXT,
    distractor_explanations JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(distractor_explanations) = 'array'),
    translation_source TEXT,
    translation_vi TEXT,
    attribute_id TEXT NOT NULL CHECK (attribute_id ~ '^M(0[1-9]|1[0-4])$'),
    process_facet TEXT NOT NULL CHECK (process_facet ~ '^P[1-5]$'),
    subdomain TEXT NOT NULL,
    module TEXT NOT NULL CHECK (module IN ('ALL', 'GENERAL', 'ACADEMIC')),
    diagnostic_status TEXT NOT NULL CHECK (diagnostic_status IN
        ('DIAGNOSTIC_APPROVED', 'CONFIRMATION_RESERVED', 'HOLDOUT_RESERVED')),
    entry_safe BOOLEAN NOT NULL DEFAULT FALSE,
    stimulus_family TEXT NOT NULL,
    parallel_set_id TEXT,
    governance JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (release_id, item_id),
    FOREIGN KEY (release_id, lesson_id)
        REFERENCES grammar_lessons(release_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_grammar_items_selector
    ON grammar_items (release_id, diagnostic_status, attribute_id, module);
CREATE INDEX IF NOT EXISTS idx_grammar_items_family
    ON grammar_items (release_id, stimulus_family);

CREATE TABLE IF NOT EXISTS grammar_item_qmatrix (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
    UNIQUE (release_id, item_id)
);

CREATE TABLE IF NOT EXISTS grammar_productive_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    task JSONB NOT NULL CHECK (jsonb_typeof(task) = 'object'),
    auto_scoring_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (release_id, task_id)
);

CREATE TABLE IF NOT EXISTS grammar_remediation_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL,
    attribute_id TEXT NOT NULL,
    route JSONB NOT NULL CHECK (jsonb_typeof(route) = 'object'),
    UNIQUE (release_id, route_id)
);

CREATE TABLE IF NOT EXISTS grammar_misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id) ON DELETE CASCADE,
    attribute_id TEXT NOT NULL,
    learner_copy JSONB NOT NULL CHECK (jsonb_typeof(learner_copy) = 'object'),
    UNIQUE (release_id, attribute_id)
);

CREATE TABLE IF NOT EXISTS grammar_diagnostic_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id),
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK (mode IN ('ENTRY', 'REVIEW')),
    module TEXT NOT NULL CHECK (module IN ('GENERAL', 'ACADEMIC')),
    test_length TEXT NOT NULL CHECK (test_length IN ('QUICK', 'FULL')),
    objective_limit INTEGER NOT NULL CHECK (
        (test_length = 'QUICK' AND objective_limit = 28) OR
        (test_length = 'FULL' AND objective_limit = 54)
    ),
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'exhausted', 'abandoned')),
    current_phase TEXT NOT NULL DEFAULT 'BASELINE'
        CHECK (current_phase IN ('BASELINE', 'CONFIRMATION', 'COMPLETED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (class_assignment_item_id)
);

CREATE INDEX IF NOT EXISTS idx_grammar_sessions_user
    ON grammar_diagnostic_sessions (user_id, started_at DESC);

-- Existing environments may have first installed this migration before the
-- assignment evidence invariant was tightened. Never detach an assigned
-- diagnostic into a self-serve-looking session when its item is deleted.
ALTER TABLE grammar_diagnostic_sessions
    DROP CONSTRAINT IF EXISTS grammar_diagnostic_sessions_class_assignment_item_id_fkey;
ALTER TABLE grammar_diagnostic_sessions
    ADD CONSTRAINT grammar_diagnostic_sessions_class_assignment_item_id_fkey
    FOREIGN KEY (class_assignment_item_id)
    REFERENCES class_assignment_items(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS grammar_exposure_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES grammar_diagnostic_sessions(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id),
    item_id TEXT NOT NULL,
    stimulus_family TEXT NOT NULL,
    parallel_set_id TEXT,
    phase TEXT NOT NULL CHECK (phase IN ('BASELINE', 'CONFIRMATION', 'DELAYED_RETEST')),
    served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, item_id),
    FOREIGN KEY (release_id, item_id)
        REFERENCES grammar_items(release_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_grammar_exposure_user
    ON grammar_exposure_events (user_id, served_at DESC);
CREATE INDEX IF NOT EXISTS idx_grammar_exposure_user_family
    ON grammar_exposure_events (user_id, stimulus_family);
CREATE INDEX IF NOT EXISTS idx_grammar_exposure_user_parallel
    ON grammar_exposure_events (user_id, parallel_set_id)
    WHERE parallel_set_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS grammar_diagnostic_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES grammar_diagnostic_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id),
    item_id TEXT NOT NULL,
    attribute_id TEXT NOT NULL,
    process_facet TEXT NOT NULL,
    subdomain TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('BASELINE', 'CONFIRMATION')),
    selected_option INTEGER NOT NULL CHECK (selected_option >= 0),
    is_correct BOOLEAN NOT NULL,
    assistance_used BOOLEAN NOT NULL DEFAULT FALSE,
    response_time_ms INTEGER CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, item_id),
    FOREIGN KEY (release_id, item_id)
        REFERENCES grammar_items(release_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_grammar_responses_session
    ON grammar_diagnostic_responses (session_id, created_at);

CREATE TABLE IF NOT EXISTS grammar_diagnostic_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE
        REFERENCES grammar_diagnostic_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES grammar_content_releases(id),
    evidence_sha256 TEXT NOT NULL,
    learner_report JSONB NOT NULL CHECK (jsonb_typeof(learner_report) = 'object'),
    educator_report JSONB NOT NULL CHECK (jsonb_typeof(educator_report) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content/runtime rows are reached only through authenticated backend routes.
-- This prevents direct PostgREST reads from exposing item keys.
ALTER TABLE grammar_content_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_item_qmatrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_productive_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_remediation_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_misconceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_exposure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_diagnostic_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_diagnostic_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE grammar_content_releases, grammar_lessons, grammar_items,
    grammar_item_qmatrix, grammar_productive_tasks, grammar_remediation_routes,
    grammar_misconceptions, grammar_diagnostic_sessions,
    grammar_exposure_events, grammar_diagnostic_responses,
    grammar_diagnostic_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE grammar_content_releases, grammar_lessons, grammar_items,
    grammar_item_qmatrix, grammar_productive_tasks, grammar_remediation_routes,
    grammar_misconceptions, grammar_diagnostic_sessions,
    grammar_exposure_events, grammar_diagnostic_responses,
    grammar_diagnostic_reports TO service_role;

-- The approved manifest hash is meaningful only if every row covered by it is
-- frozen after validation. Staging/rejected releases remain editable so a
-- failed import can be retried; validated, active, and retired releases are
-- immutable rollback artifacts.
CREATE OR REPLACE FUNCTION prevent_grammar_release_content_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_release_id UUID;
    v_status TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_release_id := NEW.release_id;
    ELSE
        v_release_id := OLD.release_id;
    END IF;

    SELECT status INTO v_status
      FROM grammar_content_releases
     WHERE id = v_release_id;
    IF v_status IN ('validated', 'active', 'retired') THEN
        RAISE EXCEPTION 'validated grammar release content is immutable';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.release_id IS DISTINCT FROM OLD.release_id THEN
        SELECT status INTO v_status
          FROM grammar_content_releases
         WHERE id = NEW.release_id;
        IF v_status IN ('validated', 'active', 'retired') THEN
            RAISE EXCEPTION 'validated grammar release content is immutable';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS grammar_lessons_release_immutable ON grammar_lessons;
CREATE TRIGGER grammar_lessons_release_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON grammar_lessons
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_release_content_mutation();
DROP TRIGGER IF EXISTS grammar_items_release_immutable ON grammar_items;
CREATE TRIGGER grammar_items_release_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON grammar_items
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_release_content_mutation();
DROP TRIGGER IF EXISTS grammar_qmatrix_release_immutable ON grammar_item_qmatrix;
CREATE TRIGGER grammar_qmatrix_release_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON grammar_item_qmatrix
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_release_content_mutation();
DROP TRIGGER IF EXISTS grammar_productive_release_immutable ON grammar_productive_tasks;
CREATE TRIGGER grammar_productive_release_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON grammar_productive_tasks
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_release_content_mutation();
DROP TRIGGER IF EXISTS grammar_routes_release_immutable ON grammar_remediation_routes;
CREATE TRIGGER grammar_routes_release_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON grammar_remediation_routes
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_release_content_mutation();
DROP TRIGGER IF EXISTS grammar_misconceptions_release_immutable ON grammar_misconceptions;
CREATE TRIGGER grammar_misconceptions_release_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON grammar_misconceptions
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_release_content_mutation();

CREATE OR REPLACE FUNCTION prevent_validated_grammar_release_rewrite()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('validated', 'active', 'retired') THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'validated grammar release is immutable';
        END IF;
        IF NEW.release_key IS DISTINCT FROM OLD.release_key
           OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
           OR NEW.manifest IS DISTINCT FROM OLD.manifest
           OR NEW.validation IS DISTINCT FROM OLD.validation
           OR NEW.live_calibrated_ready IS DISTINCT FROM OLD.live_calibrated_ready
           OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
           OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
           OR NEW.validated_at IS DISTINCT FROM OLD.validated_at THEN
            RAISE EXCEPTION 'validated grammar release is immutable';
        END IF;
        IF (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
            OR NEW.retired_at IS DISTINCT FROM OLD.retired_at)
           AND COALESCE(
               current_setting('app.grammar_release_promotion', TRUE), ''
           ) <> '1' THEN
            RAISE EXCEPTION 'grammar release lifecycle requires promotion gate';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS grammar_release_immutable ON grammar_content_releases;
CREATE TRIGGER grammar_release_immutable
    BEFORE UPDATE OR DELETE ON grammar_content_releases
    FOR EACH ROW EXECUTE FUNCTION prevent_validated_grammar_release_rewrite();

-- Exposure and report rows are audit evidence. They may be inserted, never
-- rewritten or deleted independently of their parent session.
CREATE OR REPLACE FUNCTION prevent_grammar_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'grammar diagnostic evidence is immutable';
END;
$$;

DROP TRIGGER IF EXISTS grammar_exposure_immutable ON grammar_exposure_events;
CREATE TRIGGER grammar_exposure_immutable
    BEFORE UPDATE OR DELETE ON grammar_exposure_events
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_evidence_mutation();

DROP TRIGGER IF EXISTS grammar_report_immutable ON grammar_diagnostic_reports;
CREATE TRIGGER grammar_report_immutable
    BEFORE UPDATE OR DELETE ON grammar_diagnostic_reports
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_evidence_mutation();

DROP TRIGGER IF EXISTS grammar_response_immutable ON grammar_diagnostic_responses;
CREATE TRIGGER grammar_response_immutable
    BEFORE UPDATE OR DELETE ON grammar_diagnostic_responses
    FOR EACH ROW EXECUTE FUNCTION prevent_grammar_evidence_mutation();

-- In-progress sessions may advance phase or become exhausted/abandoned. Once
-- finalization marks a session completed, its persisted state is evidence and
-- cannot be reopened, rewritten, or deleted.
CREATE OR REPLACE FUNCTION prevent_completed_grammar_session_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.release_id IS DISTINCT FROM OLD.release_id
        OR NEW.class_assignment_item_id IS DISTINCT FROM OLD.class_assignment_item_id
        OR NEW.mode IS DISTINCT FROM OLD.mode
        OR NEW.module IS DISTINCT FROM OLD.module
        OR NEW.test_length IS DISTINCT FROM OLD.test_length
        OR NEW.objective_limit IS DISTINCT FROM OLD.objective_limit
        OR NEW.started_at IS DISTINCT FROM OLD.started_at
    ) THEN
        RAISE EXCEPTION 'grammar diagnostic session identity is immutable';
    END IF;
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'completed grammar diagnostic session is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'completed' THEN
        IF OLD.status <> 'in_progress'
           OR NEW.current_phase <> 'COMPLETED'
           OR NEW.completed_at IS NULL
           OR NOT EXISTS (
               SELECT 1 FROM grammar_diagnostic_reports
                WHERE session_id = OLD.id
           ) THEN
            RAISE EXCEPTION 'invalid grammar diagnostic completion transition';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS grammar_completed_session_immutable
    ON grammar_diagnostic_sessions;
CREATE TRIGGER grammar_completed_session_immutable
    BEFORE UPDATE OR DELETE ON grammar_diagnostic_sessions
    FOR EACH ROW EXECUTE FUNCTION prevent_completed_grammar_session_mutation();

-- The application rechecks assignment state before each mutation, and this
-- database guard closes the race between that read and the evidence insert.
-- Locking the parent assignment also serializes against archive/deadline edits.
CREATE OR REPLACE FUNCTION assert_grammar_assignment_accepting(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_item_id UUID;
    v_session_status TEXT;
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_now TIMESTAMPTZ;
BEGIN
    SELECT class_assignment_item_id, status INTO v_item_id, v_session_status
      FROM grammar_diagnostic_sessions WHERE id = p_session_id
      FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_session_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_session_status <> 'in_progress' THEN
        RAISE EXCEPTION 'grammar_session_not_accepting' USING ERRCODE = '55000';
    END IF;
    IF v_item_id IS NULL THEN
        RETURN;
    END IF;

    SELECT assignment.status, assignment.publish_at, assignment.due_at
      INTO v_status, v_publish_at, v_due_at
      FROM class_assignment_items AS item
      JOIN class_assignments AS assignment ON assignment.id = item.assignment_id
     WHERE item.id = v_item_id
     FOR UPDATE OF assignment, item;
    -- Read the clock only after both locks are held. If this transaction waited
    -- behind an admin archive/deadline edit, the comparison must use fresh time.
    v_now := clock_timestamp();
    IF NOT FOUND
       OR v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now) THEN
        RAISE EXCEPTION 'grammar_assignment_not_accepting' USING ERRCODE = '55000';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION assert_grammar_assignment_accepting(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assert_grammar_assignment_accepting(UUID) TO service_role;

-- Assigned sessions are born under the same assignment and membership locks
-- used by the canonical Course start boundary. Archive, removal, deletion, and
-- deadline changes therefore resolve before the session insert, never between
-- an application precheck and an independent write.
CREATE OR REPLACE FUNCTION create_assigned_grammar_diagnostic_session(
    p_user_id UUID,
    p_release_id UUID,
    p_item_id UUID,
    p_mode TEXT,
    p_module TEXT,
    p_test_length TEXT,
    p_objective_limit INTEGER
) RETURNS grammar_diagnostic_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_content_config JSONB;
    v_session grammar_diagnostic_sessions%ROWTYPE;
    v_now TIMESTAMPTZ;
BEGIN
    SELECT ca.status, ca.publish_at, ca.due_at, ca.content_config
      INTO v_status, v_publish_at, v_due_at, v_content_config
      FROM class_assignment_items AS cai
      JOIN class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN students AS student ON student.id = cai.student_id
      JOIN student_cohort_memberships AS membership
        ON membership.student_id = student.id
       AND membership.cohort_id = ca.cohort_id
       AND membership.is_active IS TRUE
     WHERE cai.id = p_item_id
       AND student.user_id = p_user_id
       AND ca.skill = 'grammar'
     FOR UPDATE OF cai, ca, membership;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_assignment_not_accessible' USING ERRCODE = '42501';
    END IF;

    v_now := clock_timestamp();
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now)
       OR COALESCE(v_content_config ->> 'release_id', '') <> p_release_id::TEXT
       OR UPPER(COALESCE(v_content_config ->> 'mode', '')) <> p_mode
       OR UPPER(COALESCE(v_content_config ->> 'module', '')) <> p_module
       OR UPPER(COALESCE(v_content_config ->> 'test_length', '')) <> p_test_length THEN
        RAISE EXCEPTION 'grammar_assignment_not_accepting' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_session
      FROM grammar_diagnostic_sessions
     WHERE class_assignment_item_id = p_item_id
     FOR UPDATE;
    IF FOUND THEN
        IF v_session.user_id IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'grammar_assignment_not_accessible' USING ERRCODE = '42501';
        END IF;
        RETURN v_session;
    END IF;

    INSERT INTO grammar_diagnostic_sessions (
        user_id, release_id, class_assignment_item_id, mode, module,
        test_length, objective_limit
    ) VALUES (
        p_user_id, p_release_id, p_item_id, p_mode, p_module,
        p_test_length, p_objective_limit
    ) RETURNING * INTO v_session;

    UPDATE class_assignment_items
       SET state = 'opened', opened_at = COALESCE(opened_at, v_now),
           updated_at = v_now
     WHERE id = p_item_id AND state = 'assigned';
    RETURN v_session;
END;
$$;
REVOKE ALL ON FUNCTION create_assigned_grammar_diagnostic_session(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_assigned_grammar_diagnostic_session(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER
) TO service_role;

CREATE OR REPLACE FUNCTION guard_grammar_assignment_evidence_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user_id UUID;
    v_release_id UUID;
    v_status TEXT;
BEGIN
    PERFORM assert_grammar_assignment_accepting(NEW.session_id);
    SELECT user_id, release_id, status
      INTO v_user_id, v_release_id, v_status
      FROM grammar_diagnostic_sessions
     WHERE id = NEW.session_id;
    IF v_status <> 'in_progress'
       OR NEW.user_id IS DISTINCT FROM v_user_id
       OR NEW.release_id IS DISTINCT FROM v_release_id THEN
        RAISE EXCEPTION 'grammar_evidence_session_mismatch' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grammar_exposure_assignment_gate ON grammar_exposure_events;
CREATE TRIGGER grammar_exposure_assignment_gate
    BEFORE INSERT ON grammar_exposure_events
    FOR EACH ROW EXECUTE FUNCTION guard_grammar_assignment_evidence_write();

DROP TRIGGER IF EXISTS grammar_response_assignment_gate ON grammar_diagnostic_responses;
CREATE TRIGGER grammar_response_assignment_gate
    BEFORE INSERT ON grammar_diagnostic_responses
    FOR EACH ROW EXECUTE FUNCTION guard_grammar_assignment_evidence_write();

CREATE OR REPLACE FUNCTION promote_grammar_content_release(p_release_id UUID)
RETURNS grammar_content_releases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_release grammar_content_releases%ROWTYPE;
BEGIN
    SELECT * INTO v_release FROM grammar_content_releases
     WHERE id = p_release_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_release_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_release.status NOT IN ('validated', 'retired')
       OR v_release.manifest_sha256 <> '86a55dc1c3a8e5221eef9daa4772404f358ebb8f87c1284224e5197f58dbe531'
       OR COALESCE((v_release.validation ->> 'passed')::boolean, false) IS NOT TRUE
       OR (SELECT COUNT(*) FROM grammar_lessons WHERE release_id = v_release.id) <> 30
       OR (SELECT COUNT(*) FROM grammar_items WHERE release_id = v_release.id) <> 733
       OR (SELECT COUNT(*) FROM grammar_item_qmatrix WHERE release_id = v_release.id) <> 3338
       OR (SELECT COUNT(*) FROM grammar_productive_tasks WHERE release_id = v_release.id) <> 19
       OR (SELECT COUNT(*) FROM grammar_remediation_routes WHERE release_id = v_release.id) <> 16
       OR (SELECT COUNT(*) FROM grammar_misconceptions WHERE release_id = v_release.id) <> 14
       OR (SELECT COUNT(*) FROM grammar_items
            WHERE release_id = v_release.id AND diagnostic_status = 'DIAGNOSTIC_APPROVED') <> 280
       OR (SELECT COUNT(*) FROM grammar_items
            WHERE release_id = v_release.id AND entry_safe IS TRUE) <> 213
       OR (SELECT COUNT(*) FROM grammar_items
            WHERE release_id = v_release.id AND diagnostic_status = 'CONFIRMATION_RESERVED') <> 231
       OR (SELECT COUNT(*) FROM grammar_items
            WHERE release_id = v_release.id AND diagnostic_status = 'HOLDOUT_RESERVED') <> 222 THEN
        RAISE EXCEPTION 'grammar_release_not_validated' USING ERRCODE = '55000';
    END IF;
    PERFORM set_config('app.grammar_release_promotion', '1', TRUE);
    UPDATE grammar_content_releases
       SET status = 'retired', retired_at = NOW()
     WHERE status = 'active' AND id <> p_release_id;
    UPDATE grammar_content_releases
       SET status = 'active', activated_at = NOW(), retired_at = NULL
     WHERE id = p_release_id RETURNING * INTO v_release;
    RETURN v_release;
END;
$$;
REVOKE ALL ON FUNCTION promote_grammar_content_release(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promote_grammar_content_release(UUID) TO service_role;

CREATE OR REPLACE FUNCTION finalize_grammar_diagnostic_session(
    p_session_id UUID,
    p_user_id UUID,
    p_evidence_sha256 TEXT,
    p_learner_report JSONB,
    p_educator_report JSONB
) RETURNS grammar_diagnostic_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_session grammar_diagnostic_sessions%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_session FROM grammar_diagnostic_sessions
     WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_session_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- A second completion request may have waited behind the request that
    -- committed the immutable report. Treat that canonical completed state as
    -- success instead of passing it to the write gate, which correctly rejects
    -- any further mutations of a completed session.
    IF v_session.status = 'completed' THEN
        IF EXISTS (
            SELECT 1 FROM grammar_diagnostic_reports
             WHERE session_id = v_session.id AND user_id = v_session.user_id
        ) THEN
            RETURN v_session;
        END IF;
        RAISE EXCEPTION 'completed grammar session has no report'
            USING ERRCODE = '55000';
    END IF;

    -- Recheck under the assignment/item lock in the same transaction that
    -- writes the immutable report and class ledger terminal state.
    PERFORM assert_grammar_assignment_accepting(v_session.id);

    IF (SELECT COUNT(*) FROM grammar_diagnostic_responses
         WHERE session_id = v_session.id AND user_id = v_session.user_id)
       <> v_session.objective_limit THEN
        RAISE EXCEPTION 'grammar_session_incomplete' USING ERRCODE = '55000';
    END IF;

    INSERT INTO grammar_diagnostic_reports (
        session_id, user_id, release_id, evidence_sha256,
        learner_report, educator_report
    ) VALUES (
        v_session.id, v_session.user_id, v_session.release_id,
        p_evidence_sha256, p_learner_report, p_educator_report
    ) ON CONFLICT (session_id) DO NOTHING;

    UPDATE grammar_diagnostic_sessions
       SET status = 'completed', current_phase = 'COMPLETED',
           completed_at = COALESCE(completed_at, v_now), updated_at = v_now
     WHERE id = v_session.id RETURNING * INTO v_session;

    IF v_session.class_assignment_item_id IS NOT NULL THEN
        UPDATE class_assignment_items AS item
           SET state = 'submitted',
               submitted_at = COALESCE(item.submitted_at, v_now),
               score = NULL,
               artifact_kind = 'grammar_diagnostic',
               artifact_id = v_session.id,
               mastery = jsonb_build_object(
                   'profile_kind', 'grammar_readiness',
                   'report_id', v_session.id,
                   'calibration', 'structural_alpha'
               ),
               updated_at = v_now
         WHERE item.id = v_session.class_assignment_item_id;
    END IF;
    RETURN v_session;
END;
$$;
REVOKE ALL ON FUNCTION finalize_grammar_diagnostic_session(
    UUID, UUID, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_grammar_diagnostic_session(
    UUID, UUID, TEXT, JSONB, JSONB
) TO service_role;

-- The last answer and its immutable report/ledger transition are one commit.
-- A cutoff can therefore reject the entire operation, but can never leave a
-- fully answered in-progress session stranded without a report.
CREATE OR REPLACE FUNCTION record_and_finalize_grammar_diagnostic_session(
    p_session_id UUID,
    p_user_id UUID,
    p_item_id TEXT,
    p_selected_option INTEGER,
    p_assistance_used BOOLEAN,
    p_response_time_ms INTEGER,
    p_evidence_sha256 TEXT,
    p_learner_report JSONB,
    p_educator_report JSONB
) RETURNS grammar_diagnostic_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_session grammar_diagnostic_sessions%ROWTYPE;
    v_existing grammar_diagnostic_responses%ROWTYPE;
    v_item grammar_items%ROWTYPE;
    v_phase TEXT;
BEGIN
    SELECT * INTO v_session
      FROM grammar_diagnostic_sessions
     WHERE id = p_session_id AND user_id = p_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_session_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_existing
      FROM grammar_diagnostic_responses
     WHERE session_id = p_session_id AND item_id = p_item_id;
    IF FOUND THEN
        IF v_existing.selected_option IS DISTINCT FROM p_selected_option
           OR v_existing.assistance_used IS DISTINCT FROM p_assistance_used THEN
            RAISE EXCEPTION 'grammar_response_conflict' USING ERRCODE = '23505';
        END IF;
        IF v_session.status = 'completed' AND EXISTS (
            SELECT 1 FROM grammar_diagnostic_reports
             WHERE session_id = v_session.id AND user_id = v_session.user_id
        ) THEN
            RETURN v_session;
        END IF;
        RAISE EXCEPTION 'grammar_final_response_without_report' USING ERRCODE = '55000';
    END IF;

    PERFORM assert_grammar_assignment_accepting(v_session.id);

    SELECT * INTO v_item
      FROM grammar_items
     WHERE release_id = v_session.release_id AND item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_item_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_selected_option < 0
       OR p_selected_option >= jsonb_array_length(v_item.options) THEN
        RAISE EXCEPTION 'grammar_option_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT phase INTO v_phase
      FROM grammar_exposure_events
     WHERE session_id = v_session.id
       AND user_id = v_session.user_id
       AND item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_item_not_exposed' USING ERRCODE = '55000';
    END IF;

    INSERT INTO grammar_diagnostic_responses (
        session_id, user_id, release_id, item_id, attribute_id,
        process_facet, subdomain, phase, selected_option, is_correct,
        assistance_used, response_time_ms
    ) VALUES (
        v_session.id, v_session.user_id, v_session.release_id, v_item.item_id,
        v_item.attribute_id, v_item.process_facet, v_item.subdomain, v_phase,
        p_selected_option, p_selected_option = v_item.correct_index,
        p_assistance_used, p_response_time_ms
    );

    SELECT * INTO v_session FROM finalize_grammar_diagnostic_session(
        v_session.id, v_session.user_id, p_evidence_sha256,
        p_learner_report, p_educator_report
    );
    RETURN v_session;
END;
$$;
REVOKE ALL ON FUNCTION record_and_finalize_grammar_diagnostic_session(
    UUID, UUID, TEXT, INTEGER, BOOLEAN, INTEGER, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_and_finalize_grammar_diagnostic_session(
    UUID, UUID, TEXT, INTEGER, BOOLEAN, INTEGER, TEXT, JSONB, JSONB
) TO service_role;

-- Keep the canonical assignment-delete RPC truthful for the new evidence
-- type. Any attached Grammar session, including a just-opened one without an
-- answer yet, is durable learner work and makes the assignment non-deletable.
CREATE OR REPLACE FUNCTION public.fn_delete_class_assignment_if_unsubmitted(
    p_assignment_id UUID,
    p_cohort_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_timed_started BOOLEAN;
    v_evidence BOOLEAN;
BEGIN
    SELECT ca.timed_started_at IS NOT NULL
      INTO v_timed_started
      FROM public.class_assignments AS ca
     WHERE ca.id = p_assignment_id AND ca.cohort_id = p_cohort_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM 1 FROM public.class_assignment_items
     WHERE assignment_id = p_assignment_id FOR UPDATE;
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
    PERFORM 1 FROM public.grammar_diagnostic_sessions g
      JOIN public.class_assignment_items i ON i.id = g.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF g;

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
             OR EXISTS (SELECT 1 FROM public.quiz_sessions q
                         WHERE q.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.course_writing_submissions w
                         WHERE w.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.course_section_submissions c
                         WHERE c.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.course_pronunciation_submissions p
                         WHERE p.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM public.grammar_diagnostic_sessions g
                         WHERE g.class_assignment_item_id = i.id)
           )
    ) INTO v_evidence;

    IF v_evidence THEN
        RETURN FALSE;
    END IF;
    DELETE FROM public.class_assignments WHERE id = p_assignment_id;
    RETURN TRUE;
END;
$$;
COMMENT ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(UUID, UUID) IS
'Delete an assignment only before any learner work starts. MASTER30 migration
283 also protects every attached Grammar diagnostic session under the same
assignment and item locks.';
REVOKE EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(UUID, UUID)
    TO service_role;

-- The class ledger already permits skill='grammar'; add its artifact kind.
ALTER TABLE class_assignment_items
    DROP CONSTRAINT IF EXISTS class_assignment_items_artifact_kind_check;
ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_kind_check CHECK (
        artifact_kind IN ('session', 'writing_assignment', 'reading_attempt',
                          'listening_attempt', 'quiz_session', 'course_writing',
                          'advanced_vocab_progress', 'grammar_diagnostic'));

INSERT INTO runtime_flags (key, enabled, note)
VALUES ('master30_grammar_diagnostic', FALSE,
        'MASTER30 objective diagnostic beta; enable only after schema/content smoke gate')
ON CONFLICT (key) DO NOTHING;

INSERT INTO runtime_flags (key, enabled, note)
VALUES ('master30_grammar_self_serve', FALSE,
        'Keep false during assigned-only beta; enable only after public-launch review')
ON CONFLICT (key) DO NOTHING;

COMMIT;
