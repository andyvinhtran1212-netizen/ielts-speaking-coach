-- Migration 295 — LISTENING-0005 content programmes and report-only attempts.
--
-- Adds immutable package/lesson/stimulus provenance, backward-compatible
-- programme and scoring policy columns, and service-role-only atomic import /
-- publish / archive functions. Existing Listening rows keep their diagnostic
-- behaviour through explicit defaults.

BEGIN;

CREATE TABLE IF NOT EXISTS public.listening_content_packages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id          TEXT NOT NULL UNIQUE,
    programme_id        TEXT NOT NULL CHECK (programme_id IN (
                            'general-listening-practice',
                            'ielts-listening-practice'
                        )),
    title               TEXT NOT NULL,
    manifest_sha256     TEXT NOT NULL CHECK (
                            manifest_sha256 ~ '^[0-9a-f]{64}$'
                        ),
    source_date         DATE,
    source_counts       JSONB NOT NULL DEFAULT '{}'::JSONB,
    validation_summary  JSONB NOT NULL DEFAULT '{}'::JSONB,
    transform_version   TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'validated' CHECK (status IN (
                            'validated', 'published', 'archived'
                        )),
    imported_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status_changed_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    imported_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    published_at        TIMESTAMP WITH TIME ZONE,
    archived_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_listening_content_packages_published_programme
    ON public.listening_content_packages (programme_id)
    WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.listening_lessons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id          UUID NOT NULL
                            REFERENCES public.listening_content_packages(id)
                            ON DELETE CASCADE,
    programme_id        TEXT NOT NULL CHECK (programme_id IN (
                            'general-listening-practice',
                            'ielts-listening-practice'
                        )),
    source_lesson_id    TEXT NOT NULL,
    title               TEXT NOT NULL,
    instructions        TEXT,
    outcomes            JSONB NOT NULL DEFAULT '[]'::JSONB,
    sequence_num        INTEGER NOT NULL CHECK (sequence_num >= 1),
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'published', 'archived'
                        )),
    metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (package_id, source_lesson_id),
    UNIQUE (package_id, sequence_num)
);

ALTER TABLE public.listening_tests
    ADD COLUMN IF NOT EXISTS content_package_id UUID
        REFERENCES public.listening_content_packages(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS listening_lesson_id UUID
        REFERENCES public.listening_lessons(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS programme_id TEXT NOT NULL DEFAULT 'ielts',
    ADD COLUMN IF NOT EXISTS scoring_policy TEXT NOT NULL DEFAULT 'diagnostic',
    ADD COLUMN IF NOT EXISTS source_lesson_id TEXT,
    ADD COLUMN IF NOT EXISTS source_form_id TEXT,
    ADD COLUMN IF NOT EXISTS source_manifest_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS form_purpose TEXT,
    ADD COLUMN IF NOT EXISTS replay_policy TEXT,
    ADD COLUMN IF NOT EXISTS support_policy TEXT,
    ADD COLUMN IF NOT EXISTS claim_policy TEXT,
    ADD COLUMN IF NOT EXISTS source_item_count INTEGER;

DO $$
BEGIN
    ALTER TABLE public.listening_tests
        ADD CONSTRAINT listening_tests_programme_id_check
        CHECK (programme_id IN (
            'ielts',
            'general-listening-practice',
            'ielts-listening-practice'
        )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_tests
        ADD CONSTRAINT listening_tests_scoring_policy_check
        CHECK (scoring_policy IN ('diagnostic', 'report_only')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_tests
        ADD CONSTRAINT listening_tests_form_purpose_check
        CHECK (form_purpose IS NULL OR form_purpose IN (
            'practice', 'transfer', 'checkpoint'
        )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_tests
        ADD CONSTRAINT listening_tests_replay_policy_check
        CHECK (replay_policy IS NULL OR replay_policy IN ('allowed', 'once')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_tests
        ADD CONSTRAINT listening_tests_support_policy_check
        CHECK (support_policy IS NULL OR support_policy IN (
            'separate_mode', 'available'
        )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_tests
        ADD CONSTRAINT listening_tests_source_item_count_check
        CHECK (source_item_count IS NULL OR source_item_count >= 1) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.listening_tests
    VALIDATE CONSTRAINT listening_tests_programme_id_check;
ALTER TABLE public.listening_tests
    VALIDATE CONSTRAINT listening_tests_scoring_policy_check;
ALTER TABLE public.listening_tests
    VALIDATE CONSTRAINT listening_tests_form_purpose_check;
ALTER TABLE public.listening_tests
    VALIDATE CONSTRAINT listening_tests_replay_policy_check;
ALTER TABLE public.listening_tests
    VALIDATE CONSTRAINT listening_tests_support_policy_check;
ALTER TABLE public.listening_tests
    VALIDATE CONSTRAINT listening_tests_source_item_count_check;

CREATE UNIQUE INDEX IF NOT EXISTS uq_listening_tests_package_source_form
    ON public.listening_tests (content_package_id, source_form_id)
    WHERE content_package_id IS NOT NULL AND source_form_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_tests_programme_public
    ON public.listening_tests (programme_id, status, created_at)
    WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_listening_tests_lesson
    ON public.listening_tests (listening_lesson_id, created_at)
    WHERE listening_lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_tests_content_package
    ON public.listening_tests (content_package_id)
    WHERE content_package_id IS NOT NULL;

ALTER TABLE public.listening_content
    DROP CONSTRAINT IF EXISTS listening_content_source_type_check;
ALTER TABLE public.listening_content
    ADD CONSTRAINT listening_content_source_type_check
    CHECK (source_type IN (
        'ai_elevenlabs',
        'upload_mp3',
        'curated_external',
        'test_section',
        'exercise_snippet',
        'programme_form'
    ));

ALTER TABLE public.listening_exercises
    DROP CONSTRAINT IF EXISTS listening_exercises_exercise_type_check;
ALTER TABLE public.listening_exercises
    ADD CONSTRAINT listening_exercises_exercise_type_check
    CHECK (exercise_type IN (
        'dictation', 'gist', 'true_false', 'mcq', 'mini_test',
        'programme_form'
    ));

CREATE TABLE IF NOT EXISTS public.listening_package_stimuli (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id                  UUID NOT NULL
                                    REFERENCES public.listening_content_packages(id)
                                    ON DELETE CASCADE,
    source_stimulus_id          TEXT NOT NULL,
    source_audio_path           TEXT NOT NULL,
    source_timing_path          TEXT NOT NULL,
    controlled_transcript_path  TEXT,
    source_audio_sha256         TEXT NOT NULL CHECK (
                                    source_audio_sha256 ~ '^[0-9a-f]{64}$'
                                ),
    source_timing_sha256        TEXT NOT NULL CHECK (
                                    source_timing_sha256 ~ '^[0-9a-f]{64}$'
                                ),
    controlled_transcript_sha256 TEXT NOT NULL CHECK (
                                    controlled_transcript_sha256 ~ '^[0-9a-f]{64}$'
                                ),
    duration_seconds            NUMERIC NOT NULL CHECK (duration_seconds > 0),
    metadata                    JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (package_id, source_stimulus_id)
);

CREATE TABLE IF NOT EXISTS public.listening_form_stimuli (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id                  UUID NOT NULL
                                    REFERENCES public.listening_content_packages(id)
                                    ON DELETE CASCADE,
    test_id                     UUID NOT NULL
                                    REFERENCES public.listening_tests(id)
                                    ON DELETE CASCADE,
    package_stimulus_id         UUID NOT NULL
                                    REFERENCES public.listening_package_stimuli(id)
                                    ON DELETE RESTRICT,
    sequence_num                INTEGER NOT NULL CHECK (sequence_num >= 1),
    derived_offset_seconds      NUMERIC NOT NULL CHECK (
                                    derived_offset_seconds >= 0
                                ),
    derived_end_seconds         NUMERIC NOT NULL CHECK (
                                    derived_end_seconds > derived_offset_seconds
                                ),
    metadata                    JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (test_id, package_stimulus_id),
    UNIQUE (test_id, sequence_num)
);

CREATE INDEX IF NOT EXISTS idx_listening_lessons_package
    ON public.listening_lessons (package_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_listening_content_packages_imported_by
    ON public.listening_content_packages (imported_by)
    WHERE imported_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_content_packages_status_changed_by
    ON public.listening_content_packages (status_changed_by)
    WHERE status_changed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_lessons_programme
    ON public.listening_lessons (programme_id, status, sequence_num);
CREATE INDEX IF NOT EXISTS idx_listening_package_stimuli_package
    ON public.listening_package_stimuli (package_id);
CREATE INDEX IF NOT EXISTS idx_listening_form_stimuli_test
    ON public.listening_form_stimuli (test_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_listening_form_stimuli_package
    ON public.listening_form_stimuli (package_id);
CREATE INDEX IF NOT EXISTS idx_listening_form_stimuli_package_stimulus
    ON public.listening_form_stimuli (package_stimulus_id);

ALTER TABLE public.listening_test_attempts
    ADD COLUMN IF NOT EXISTS scoring_policy TEXT NOT NULL DEFAULT 'diagnostic',
    ADD COLUMN IF NOT EXISTS result_summary JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
    ALTER TABLE public.listening_test_attempts
        ADD CONSTRAINT listening_attempts_scoring_policy_check
        CHECK (scoring_policy IN ('diagnostic', 'report_only')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_test_attempts
        ADD CONSTRAINT listening_attempts_report_only_result_check
        CHECK (
            scoring_policy <> 'report_only'
            OR (score IS NULL AND band_estimate IS NULL)
        ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
ALTER TABLE public.listening_test_attempts
    VALIDATE CONSTRAINT listening_attempts_scoring_policy_check;
ALTER TABLE public.listening_test_attempts
    VALIDATE CONSTRAINT listening_attempts_report_only_result_check;

CREATE INDEX IF NOT EXISTS idx_listening_attempts_scoring_policy
    ON public.listening_test_attempts (user_id, scoring_policy, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_protect_listening_package_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.listening_package_import', TRUE)
               IS DISTINCT FROM NEW.package_id THEN
            RAISE EXCEPTION 'listening_package_immutable'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'listening_package_immutable'
            USING ERRCODE = '55000';
    END IF;

    IF current_setting('app.listening_package_status_transition', TRUE)
           IS DISTINCT FROM OLD.id::TEXT
       OR (to_jsonb(NEW) - ARRAY[
              'status', 'status_changed_by', 'published_at', 'archived_at',
              'updated_at'
          ]) IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY[
              'status', 'status_changed_by', 'published_at', 'archived_at',
              'updated_at'
          ]) THEN
        RAISE EXCEPTION 'listening_package_immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_listening_package_identity
    ON public.listening_content_packages;
CREATE TRIGGER trg_protect_listening_package_identity
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_content_packages
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_identity();

CREATE OR REPLACE FUNCTION public.fn_protect_listening_package_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_package_id UUID;
    v_new_package_id UUID;
    v_allowed_columns TEXT[];
BEGIN
    IF TG_TABLE_NAME = 'listening_lessons' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.package_id;
        ELSE
            v_package_id := OLD.package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.package_id; END IF;
        v_allowed_columns := ARRAY['status', 'updated_at'];
    ELSIF TG_TABLE_NAME = 'listening_package_stimuli' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.package_id;
        ELSE
            v_package_id := OLD.package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.package_id; END IF;
        v_allowed_columns := ARRAY[]::TEXT[];
    ELSIF TG_TABLE_NAME = 'listening_form_stimuli' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.package_id;
        ELSE
            v_package_id := OLD.package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.package_id; END IF;
        v_allowed_columns := ARRAY[]::TEXT[];
    ELSIF TG_TABLE_NAME = 'listening_tests' THEN
        IF TG_OP = 'INSERT' THEN
            v_package_id := NEW.content_package_id;
        ELSE
            v_package_id := OLD.content_package_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN v_new_package_id := NEW.content_package_id; END IF;
        v_allowed_columns := ARRAY['status', 'is_public', 'updated_at'];
    ELSIF TG_TABLE_NAME = 'listening_content' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_tests AS t WHERE t.id = NEW.test_id;
        ELSE
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_tests AS t WHERE t.id = OLD.test_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            SELECT t.content_package_id INTO v_new_package_id
              FROM public.listening_tests AS t WHERE t.id = NEW.test_id;
        END IF;
        v_allowed_columns := ARRAY['status', 'updated_at'];
    ELSIF TG_TABLE_NAME = 'listening_exercises' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_content AS c
              JOIN public.listening_tests AS t ON t.id = c.test_id
             WHERE c.id = NEW.content_id;
        ELSE
            SELECT t.content_package_id INTO v_package_id
              FROM public.listening_content AS c
              JOIN public.listening_tests AS t ON t.id = c.test_id
             WHERE c.id = OLD.content_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            SELECT t.content_package_id INTO v_new_package_id
              FROM public.listening_content AS c
              JOIN public.listening_tests AS t ON t.id = c.test_id
             WHERE c.id = NEW.content_id;
        END IF;
        v_allowed_columns := ARRAY['status', 'updated_at'];
    ELSE
        RAISE EXCEPTION 'listening_package_guard_table_unsupported'
            USING ERRCODE = '55000';
    END IF;

    v_package_id := COALESCE(v_package_id, v_new_package_id);
    IF v_package_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.listening_package_import', TRUE)
               IS DISTINCT FROM v_package_id::TEXT THEN
            RAISE EXCEPTION 'listening_package_child_immutable'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'listening_package_child_immutable'
            USING ERRCODE = '55000';
    END IF;
    IF current_setting('app.listening_package_status_transition', TRUE)
           IS DISTINCT FROM v_package_id::TEXT
       OR (to_jsonb(NEW) - v_allowed_columns) IS DISTINCT FROM
          (to_jsonb(OLD) - v_allowed_columns) THEN
        RAISE EXCEPTION 'listening_package_child_immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_listening_package_child
    ON public.listening_lessons;
CREATE TRIGGER trg_protect_listening_package_child
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_lessons
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();

DROP TRIGGER IF EXISTS trg_protect_listening_package_child
    ON public.listening_package_stimuli;
CREATE TRIGGER trg_protect_listening_package_child
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_package_stimuli
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();

DROP TRIGGER IF EXISTS trg_protect_listening_package_child
    ON public.listening_form_stimuli;
CREATE TRIGGER trg_protect_listening_package_child
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_form_stimuli
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();

DROP TRIGGER IF EXISTS trg_protect_listening_package_child
    ON public.listening_tests;
CREATE TRIGGER trg_protect_listening_package_child
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_tests
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();

DROP TRIGGER IF EXISTS trg_protect_listening_package_child
    ON public.listening_content;
CREATE TRIGGER trg_protect_listening_package_child
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_content
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();

DROP TRIGGER IF EXISTS trg_protect_listening_package_child
    ON public.listening_exercises;
CREATE TRIGGER trg_protect_listening_package_child
    BEFORE INSERT OR UPDATE OR DELETE ON public.listening_exercises
    FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();

CREATE OR REPLACE FUNCTION public.import_listening_content_package_atomic(
    p_package JSONB,
    p_lessons JSONB,
    p_stimuli JSONB,
    p_forms JSONB
)
RETURNS TABLE (
    package_uuid UUID,
    action TEXT,
    lessons_written INTEGER,
    forms_written INTEGER,
    items_written INTEGER,
    stimuli_written INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_package public.listening_content_packages%ROWTYPE;
    v_lesson JSONB;
    v_form JSONB;
    v_stimulus JSONB;
    v_lesson_uuid UUID;
    v_package_stimulus_uuid UUID;
    v_test_uuid UUID;
    v_content_uuid UUID;
    v_existing_lessons INTEGER;
    v_existing_forms INTEGER;
    v_expected_items INTEGER;
    v_expected_lessons INTEGER;
    v_expected_forms INTEGER;
    v_expected_stimuli INTEGER;
    v_expected_form_stimuli INTEGER;
    v_existing_form_stimuli INTEGER;
    v_items INTEGER := 0;
    v_stimuli INTEGER := 0;
BEGIN
    IF jsonb_typeof(p_package) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_lessons) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_stimuli) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_forms) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_lessons) < 1
       OR jsonb_array_length(p_stimuli) < 1
       OR jsonb_array_length(p_forms) < 1
       OR NULLIF(p_package ->> 'package_id', '') IS NULL
       OR NULLIF(p_package ->> 'programme_id', '') IS NULL
       OR NULLIF(p_package ->> 'manifest_sha256', '') IS NULL
       OR NULLIF(p_package ->> 'transform_version', '') IS NULL THEN
        RAISE EXCEPTION 'listening_package_import_payload_invalid'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_expected_lessons := (p_package -> 'source_counts' ->> 'lessons')::INTEGER;
        v_expected_forms := (p_package -> 'source_counts' ->> 'forms')::INTEGER;
        v_expected_items := (p_package -> 'source_counts' ->> 'items')::INTEGER;
        v_expected_stimuli := (p_package -> 'source_counts' ->> 'stimuli')::INTEGER;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'listening_package_source_counts_invalid'
            USING ERRCODE = '22023';
    END;
    IF v_expected_lessons IS NULL OR v_expected_lessons < 1
       OR v_expected_forms IS NULL OR v_expected_forms < 1
       OR v_expected_items IS NULL OR v_expected_items < 1
       OR v_expected_stimuli IS NULL OR v_expected_stimuli < 1
       OR v_expected_lessons <> jsonb_array_length(p_lessons)
       OR v_expected_forms <> jsonb_array_length(p_forms)
       OR v_expected_stimuli <> jsonb_array_length(p_stimuli) THEN
        RAISE EXCEPTION 'listening_package_source_counts_mismatch'
            USING ERRCODE = '22023';
    END IF;

    IF (SELECT count(DISTINCT value ->> 'source_lesson_id')
          FROM jsonb_array_elements(p_lessons)) <> jsonb_array_length(p_lessons)
       OR (SELECT count(DISTINCT value ->> 'source_stimulus_id')
             FROM jsonb_array_elements(p_stimuli)) <> jsonb_array_length(p_stimuli)
       OR (SELECT count(DISTINCT value ->> 'source_form_id')
             FROM jsonb_array_elements(p_forms)) <> jsonb_array_length(p_forms) THEN
        RAISE EXCEPTION 'listening_package_source_identity_duplicate'
            USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(sum(jsonb_array_length(COALESCE(value -> 'stimuli', '[]'::JSONB))), 0)::INTEGER
      INTO v_expected_form_stimuli
      FROM jsonb_array_elements(p_forms);

    PERFORM pg_advisory_xact_lock(hashtextextended(p_package ->> 'package_id', 0));

    SELECT * INTO v_package
      FROM public.listening_content_packages
     WHERE package_id = p_package ->> 'package_id'
     FOR UPDATE;

    IF FOUND THEN
        IF v_package.manifest_sha256 <> p_package ->> 'manifest_sha256'
           OR v_package.programme_id <> p_package ->> 'programme_id'
           OR v_package.transform_version <> p_package ->> 'transform_version' THEN
            RAISE EXCEPTION 'listening_package_identity_conflict'
                USING ERRCODE = '55000';
        END IF;
        SELECT count(*) INTO v_existing_lessons
          FROM public.listening_lessons WHERE package_id = v_package.id;
        SELECT count(*) INTO v_existing_forms
          FROM public.listening_tests WHERE content_package_id = v_package.id;
        IF v_existing_lessons <> jsonb_array_length(p_lessons)
           OR v_existing_forms <> jsonb_array_length(p_forms) THEN
            RAISE EXCEPTION 'listening_package_reconciliation_required'
                USING ERRCODE = '55000';
        END IF;
        SELECT COALESCE(sum(source_item_count), 0)::INTEGER INTO v_items
          FROM public.listening_tests WHERE content_package_id = v_package.id;
        SELECT count(*)::INTEGER INTO v_stimuli
          FROM public.listening_package_stimuli WHERE package_id = v_package.id;
        SELECT count(*)::INTEGER INTO v_existing_form_stimuli
          FROM public.listening_form_stimuli WHERE package_id = v_package.id;
        IF v_items <> v_expected_items
           OR v_stimuli <> jsonb_array_length(p_stimuli)
           OR v_existing_form_stimuli <> v_expected_form_stimuli
           OR EXISTS (
                SELECT 1 FROM public.listening_lessons AS stored
                 WHERE stored.package_id = v_package.id
                   AND NOT EXISTS (
                       SELECT 1 FROM jsonb_array_elements(p_lessons) AS incoming
                        WHERE incoming ->> 'source_lesson_id' = stored.source_lesson_id
                   )
           )
           OR EXISTS (
                SELECT 1 FROM public.listening_package_stimuli AS stored
                 WHERE stored.package_id = v_package.id
                   AND NOT EXISTS (
                       SELECT 1 FROM jsonb_array_elements(p_stimuli) AS incoming
                        WHERE incoming ->> 'source_stimulus_id' = stored.source_stimulus_id
                   )
           )
           OR EXISTS (
                SELECT 1 FROM public.listening_tests AS stored
                 WHERE stored.content_package_id = v_package.id
                   AND NOT EXISTS (
                       SELECT 1 FROM jsonb_array_elements(p_forms) AS incoming
                        WHERE incoming ->> 'source_form_id' = stored.source_form_id
                   )
           ) THEN
            RAISE EXCEPTION 'listening_package_reconciliation_required'
                USING ERRCODE = '55000';
        END IF;
        RETURN QUERY SELECT v_package.id, 'reused'::TEXT,
            v_existing_lessons, v_existing_forms, v_items, v_stimuli;
        RETURN;
    END IF;

    -- Only this SECURITY DEFINER import may create package-owned rows.
    PERFORM set_config(
        'app.listening_package_import', p_package ->> 'package_id', TRUE
    );
    INSERT INTO public.listening_content_packages (
        package_id, programme_id, title, manifest_sha256, source_date,
        source_counts, validation_summary, transform_version, imported_by
    ) VALUES (
        p_package ->> 'package_id',
        p_package ->> 'programme_id',
        p_package ->> 'title',
        p_package ->> 'manifest_sha256',
        NULLIF(p_package ->> 'source_date', '')::DATE,
        COALESCE(p_package -> 'source_counts', '{}'::JSONB),
        COALESCE(p_package -> 'validation_summary', '{}'::JSONB),
        p_package ->> 'transform_version',
        NULLIF(p_package ->> 'imported_by', '')::UUID
    ) RETURNING * INTO v_package;
    PERFORM set_config(
        'app.listening_package_import', v_package.id::TEXT, TRUE
    );

    FOR v_lesson IN SELECT value FROM jsonb_array_elements(p_lessons)
    LOOP
        INSERT INTO public.listening_lessons (
            package_id, programme_id, source_lesson_id, title, instructions,
            outcomes, sequence_num, metadata
        ) VALUES (
            v_package.id,
            v_package.programme_id,
            v_lesson ->> 'source_lesson_id',
            v_lesson ->> 'title',
            v_lesson ->> 'instructions',
            COALESCE(v_lesson -> 'outcomes', '[]'::JSONB),
            (v_lesson ->> 'sequence_num')::INTEGER,
            COALESCE(v_lesson -> 'metadata', '{}'::JSONB)
        );
    END LOOP;

    FOR v_stimulus IN SELECT value FROM jsonb_array_elements(p_stimuli)
    LOOP
        INSERT INTO public.listening_package_stimuli (
            package_id, source_stimulus_id, source_audio_path,
            source_timing_path, controlled_transcript_path,
            source_audio_sha256, source_timing_sha256,
            controlled_transcript_sha256, duration_seconds, metadata
        ) VALUES (
            v_package.id,
            v_stimulus ->> 'source_stimulus_id',
            v_stimulus ->> 'source_audio_path',
            v_stimulus ->> 'source_timing_path',
            v_stimulus ->> 'controlled_transcript_path',
            v_stimulus ->> 'source_audio_sha256',
            v_stimulus ->> 'source_timing_sha256',
            v_stimulus ->> 'controlled_transcript_sha256',
            (v_stimulus ->> 'duration_seconds')::NUMERIC,
            COALESCE(v_stimulus -> 'metadata', '{}'::JSONB)
        );
    END LOOP;
    v_stimuli := jsonb_array_length(p_stimuli);

    FOR v_form IN SELECT value FROM jsonb_array_elements(p_forms)
    LOOP
        SELECT id INTO v_lesson_uuid
          FROM public.listening_lessons
         WHERE package_id = v_package.id
           AND source_lesson_id = v_form ->> 'source_lesson_id';
        IF v_lesson_uuid IS NULL THEN
            RAISE EXCEPTION 'listening_form_lesson_not_found'
                USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.listening_tests (
            test_id, title, version, metadata, status, test_type, is_public,
            full_audio_storage_path, full_audio_duration_seconds,
            full_audio_size_bytes, audio_assembly_mode,
            content_package_id, listening_lesson_id, programme_id,
            scoring_policy, source_lesson_id, source_form_id,
            source_manifest_sha256, form_purpose, replay_policy,
            support_policy, claim_policy, source_item_count
        ) VALUES (
            v_form ->> 'test_id',
            v_form ->> 'title',
            COALESCE(NULLIF(v_form ->> 'version', ''), '1.0'),
            COALESCE(v_form -> 'metadata', '{}'::JSONB),
            'draft', 'practice', FALSE,
            v_form ->> 'audio_storage_path',
            (v_form ->> 'audio_duration_seconds')::INTEGER,
            (v_form ->> 'audio_size_bytes')::INTEGER,
            'full_premixed',
            v_package.id, v_lesson_uuid, v_package.programme_id,
            'report_only', v_form ->> 'source_lesson_id',
            v_form ->> 'source_form_id', v_package.manifest_sha256,
            v_form ->> 'purpose', v_form ->> 'replay_policy',
            v_form ->> 'support_policy', v_form ->> 'claim_policy',
            (v_form ->> 'item_count')::INTEGER
        ) RETURNING id INTO v_test_uuid;

        INSERT INTO public.listening_content (
            source_type, audio_storage_path, audio_duration_seconds,
            audio_size_bytes, accent_tag, topic_tags, transcript,
            transcript_segments, status, title, description, test_id,
            section_num, metadata
        ) VALUES (
            'programme_form',
            v_form ->> 'audio_storage_path',
            (v_form ->> 'audio_duration_seconds')::INTEGER,
            (v_form ->> 'audio_size_bytes')::INTEGER,
            COALESCE(NULLIF(v_form ->> 'accent_tag', ''), 'other'),
            ARRAY[v_package.programme_id],
            '',
            '[]'::JSONB,
            'draft',
            v_form ->> 'title',
            v_form ->> 'description',
            v_test_uuid,
            1,
            COALESCE(v_form -> 'content_metadata', '{}'::JSONB)
        ) RETURNING id INTO v_content_uuid;

        INSERT INTO public.listening_exercises (
            content_id, exercise_type, payload, order_num, status
        ) VALUES (
            v_content_uuid,
            'programme_form',
            COALESCE(v_form -> 'exercise_payload', '{}'::JSONB),
            1,
            'draft'
        );

        v_items := v_items + (v_form ->> 'item_count')::INTEGER;
        FOR v_stimulus IN
            SELECT value FROM jsonb_array_elements(
                COALESCE(v_form -> 'stimuli', '[]'::JSONB)
            )
        LOOP
            SELECT id INTO v_package_stimulus_uuid
              FROM public.listening_package_stimuli
             WHERE package_id = v_package.id
               AND source_stimulus_id = v_stimulus ->> 'source_stimulus_id';
            IF v_package_stimulus_uuid IS NULL THEN
                RAISE EXCEPTION 'listening_form_stimulus_not_found'
                    USING ERRCODE = '22023';
            END IF;
            INSERT INTO public.listening_form_stimuli (
                package_id, test_id, package_stimulus_id, sequence_num,
                derived_offset_seconds, derived_end_seconds, metadata
            ) VALUES (
                v_package.id,
                v_test_uuid,
                v_package_stimulus_uuid,
                (v_stimulus ->> 'sequence_num')::INTEGER,
                (v_stimulus ->> 'derived_offset_seconds')::NUMERIC,
                (v_stimulus ->> 'derived_end_seconds')::NUMERIC,
                COALESCE(v_stimulus -> 'metadata', '{}'::JSONB)
            );
        END LOOP;
    END LOOP;

    IF v_items <> v_expected_items THEN
        RAISE EXCEPTION 'listening_package_item_count_mismatch'
            USING ERRCODE = '22023';
    END IF;

    PERFORM set_config('app.listening_package_import', '', TRUE);

    RETURN QUERY SELECT v_package.id, 'created'::TEXT,
        jsonb_array_length(p_lessons), jsonb_array_length(p_forms),
        v_items, v_stimuli;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_listening_content_package_status(
    p_package_id TEXT,
    p_manifest_sha256 TEXT,
    p_action TEXT,
    p_actor UUID DEFAULT NULL
)
RETURNS TABLE (
    package_uuid UUID,
    status TEXT,
    forms_changed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_package public.listening_content_packages%ROWTYPE;
    v_status TEXT;
    v_forms INTEGER;
    v_lessons INTEGER;
    v_items INTEGER;
    v_stimuli INTEGER;
    v_timing_segments INTEGER;
    v_contents INTEGER;
    v_exercises INTEGER;
BEGIN
    IF p_action NOT IN ('publish', 'archive') THEN
        RAISE EXCEPTION 'listening_package_action_invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_package
      FROM public.listening_content_packages
     WHERE package_id = p_package_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'listening_package_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF v_package.manifest_sha256 <> p_manifest_sha256 THEN
        RAISE EXCEPTION 'listening_package_manifest_mismatch'
            USING ERRCODE = '55000';
    END IF;

    IF p_action = 'publish' THEN
        SELECT count(*)::INTEGER INTO v_lessons
          FROM public.listening_lessons WHERE package_id = v_package.id;
        SELECT count(*)::INTEGER, COALESCE(sum(source_item_count), 0)::INTEGER
          INTO v_forms, v_items
          FROM public.listening_tests WHERE content_package_id = v_package.id;
        SELECT count(*)::INTEGER INTO v_stimuli
          FROM public.listening_package_stimuli WHERE package_id = v_package.id;
        SELECT COALESCE(sum((metadata ->> 'timing_segment_count')::INTEGER), 0)::INTEGER
          INTO v_timing_segments
          FROM public.listening_package_stimuli WHERE package_id = v_package.id;
        SELECT count(*)::INTEGER INTO v_contents
          FROM public.listening_content AS c
          JOIN public.listening_tests AS t ON t.id = c.test_id
         WHERE t.content_package_id = v_package.id;
        SELECT count(*)::INTEGER INTO v_exercises
          FROM public.listening_exercises AS e
          JOIN public.listening_content AS c ON c.id = e.content_id
          JOIN public.listening_tests AS t ON t.id = c.test_id
         WHERE t.content_package_id = v_package.id;
        IF v_lessons IS DISTINCT FROM NULLIF(v_package.source_counts ->> 'lessons', '')::INTEGER
           OR v_forms IS DISTINCT FROM NULLIF(v_package.source_counts ->> 'forms', '')::INTEGER
           OR v_items IS DISTINCT FROM NULLIF(v_package.source_counts ->> 'items', '')::INTEGER
           OR v_stimuli IS DISTINCT FROM NULLIF(v_package.source_counts ->> 'stimuli', '')::INTEGER
           OR v_timing_segments IS DISTINCT FROM NULLIF(v_package.source_counts ->> 'timing_segments', '')::INTEGER
           OR v_contents <> v_forms
           OR v_exercises <> v_forms THEN
            RAISE EXCEPTION 'listening_package_reconciliation_required'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    v_status := CASE p_action WHEN 'publish' THEN 'published' ELSE 'archived' END;

    -- Scope the immutable-child guard to this exact manifest-bound package.
    PERFORM set_config(
        'app.listening_package_status_transition', v_package.id::TEXT, TRUE
    );

    UPDATE public.listening_tests
       SET status = v_status,
           is_public = (p_action = 'publish'),
           updated_at = NOW()
     WHERE content_package_id = v_package.id;
    GET DIAGNOSTICS v_forms = ROW_COUNT;

    UPDATE public.listening_content AS c
       SET status = v_status,
           updated_at = NOW()
     WHERE c.test_id IN (
        SELECT t.id FROM public.listening_tests AS t
         WHERE t.content_package_id = v_package.id
     );

    UPDATE public.listening_exercises AS e
       SET status = v_status,
           updated_at = NOW()
     WHERE e.content_id IN (
        SELECT c.id FROM public.listening_content AS c
        JOIN public.listening_tests AS t ON t.id = c.test_id
         WHERE t.content_package_id = v_package.id
     );

    UPDATE public.listening_lessons
       SET status = v_status,
           updated_at = NOW()
     WHERE package_id = v_package.id;

    UPDATE public.listening_content_packages
       SET status = v_status,
           status_changed_by = p_actor,
           published_at = CASE
               WHEN p_action = 'publish' THEN COALESCE(published_at, NOW())
               ELSE published_at
           END,
           archived_at = CASE
               WHEN p_action = 'archive' THEN NOW()
               ELSE NULL
           END,
           updated_at = NOW()
     WHERE id = v_package.id
     RETURNING * INTO v_package;

    PERFORM set_config('app.listening_package_status_transition', '', TRUE);

    RETURN QUERY SELECT v_package.id, v_package.status, v_forms;
END;
$$;

ALTER TABLE public.listening_content_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listening_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listening_package_stimuli ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listening_form_stimuli ENABLE ROW LEVEL SECURITY;
-- Programme payloads contain protected answer/self-review material. All
-- learner access therefore goes through the sanitising FastAPI boundary;
-- no browser role may query the backing exercise row directly.
ALTER TABLE public.listening_exercises ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.listening_content_packages
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.listening_lessons
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.listening_package_stimuli
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.listening_form_stimuli
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.listening_exercises
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.listening_content_packages TO service_role;
GRANT ALL ON TABLE public.listening_lessons TO service_role;
GRANT ALL ON TABLE public.listening_package_stimuli TO service_role;
GRANT ALL ON TABLE public.listening_form_stimuli TO service_role;
GRANT ALL ON TABLE public.listening_exercises TO service_role;

REVOKE ALL ON FUNCTION public.import_listening_content_package_atomic(
    JSONB, JSONB, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_listening_content_package_atomic(
    JSONB, JSONB, JSONB, JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.set_listening_content_package_status(
    TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_listening_content_package_status(
    TEXT, TEXT, TEXT, UUID
) TO service_role;

COMMENT ON TABLE public.listening_content_packages IS
'Immutable LISTENING-0005 release identity and package-scoped publication state.';
COMMENT ON TABLE public.listening_lessons IS
'Programme lesson/group hierarchy imported from an immutable Listening package.';
COMMENT ON TABLE public.listening_package_stimuli IS
'Exactly one canonical source stimulus per immutable package, including source hashes and paths.';
COMMENT ON TABLE public.listening_form_stimuli IS
'Many-to-many form-to-package-stimulus mapping with deterministic derived-audio offsets.';
COMMENT ON COLUMN public.listening_tests.scoring_policy IS
'diagnostic preserves legacy scored behavior; report_only produces completion and self-review with no score, band, mastery or weakness claim.';
COMMENT ON COLUMN public.listening_test_attempts.result_summary IS
'For report_only attempts: checked, correct, unscored, blank and technical_error counts; never an IELTS band or diagnostic score.';
COMMENT ON FUNCTION public.import_listening_content_package_atomic(JSONB, JSONB, JSONB, JSONB) IS
'Validates and atomically inserts one complete immutable Listening package; identical reruns reconcile as reused and conflicting bytes fail closed.';
COMMENT ON FUNCTION public.set_listening_content_package_status(TEXT, TEXT, TEXT, UUID) IS
'Atomically publishes or archives all rows for one manifest-bound Listening package without deleting attempts.';

NOTIFY pgrst, 'reload schema';

COMMIT;
