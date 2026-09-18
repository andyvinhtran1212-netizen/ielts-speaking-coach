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
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE SET NULL,
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
