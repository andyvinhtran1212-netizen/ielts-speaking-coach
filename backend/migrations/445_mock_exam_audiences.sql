-- MOCKORG-0086 G09-T31 PR 1 (plan 5.5, migration table row 445).
-- Number 445 is from the G09 band 440-459 of the commercialization register.
-- No apply on merge: pending_feature mock_exam_audiences. Staging first under
-- the advisory lock with anh Andy's typed approval; production only at an
-- authorised staging-to-main promotion. Order (rollout.md): 445, then the
-- backend that reads both mode names, then 446 (backfill + rename).
--
-- Additive only; no existing row changes:
--   * mock_exam_audiences: who sits an exam, from up to three sources
--     (class, single learner, saved group), de-duplicated per student and
--     purpose; first source kept. Backend-only (spec 0039): RLS on, no
--     policy, only service_role has table privileges.
--   * mock_exams gains skills, allow_early_advance, starts_at, draft_state.
--   * mock_exams_exam_mode_chk widens to sequential/retake/live/self_paced.
--     Data keeps the legacy names until 446.
-- Re-runnable; postconditions at the end.
-- Rollback: rollback/445_mock_exam_audiences.sql (refuses while any row uses a
-- new mode name or any audience row exists).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- 1. New columns on mock_exams --------------------------------------------
ALTER TABLE public.mock_exams
    ADD COLUMN IF NOT EXISTS skills text[],
    ADD COLUMN IF NOT EXISTS allow_early_advance boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS starts_at timestamptz,
    ADD COLUMN IF NOT EXISTS draft_state jsonb;

ALTER TABLE public.mock_exams DROP CONSTRAINT IF EXISTS mock_exams_skills_valid;
ALTER TABLE public.mock_exams ADD CONSTRAINT mock_exams_skills_valid
    CHECK (skills IS NULL OR (cardinality(skills) >= 1
           AND skills <@ ARRAY['listening', 'reading', 'writing', 'speaking']::text[]));
ALTER TABLE public.mock_exams DROP CONSTRAINT IF EXISTS mock_exams_draft_state_shape;
ALTER TABLE public.mock_exams ADD CONSTRAINT mock_exams_draft_state_shape
    CHECK (draft_state IS NULL OR jsonb_typeof(draft_state) = 'object');

COMMENT ON COLUMN public.mock_exams.skills IS
'MOCKORG-0086: skills this exam runs; NULL = all four (legacy exams).';
COMMENT ON COLUMN public.mock_exams.starts_at IS
'MOCKORG-0086: scheduled room start of a live exam.';
COMMENT ON COLUMN public.mock_exams.draft_state IS
'MOCKORG-0086: "Tổ chức kỳ thi" step being edited (admin UI only).';

-- 2. Widen the mode CHECK (legacy names stay valid until 446) ---------------
DO $mode_check$
DECLARE
    definition text;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO definition FROM pg_constraint c
     WHERE c.conrelid = 'public.mock_exams'::regclass AND c.conname = 'mock_exams_exam_mode_chk';
    IF definition = 'CHECK ((exam_mode = ANY (ARRAY[''sequential''::text, ''retake''::text, ''live''::text, ''self_paced''::text])))' THEN
        RETURN;  -- re-run of 445
    END IF;
    IF definition IS DISTINCT FROM 'CHECK ((exam_mode = ANY (ARRAY[''sequential''::text, ''retake''::text])))' THEN
        RAISE EXCEPTION 'mock_exams_exam_mode_chk_drift: %', coalesce(definition, 'missing')
            USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.mock_exams DROP CONSTRAINT mock_exams_exam_mode_chk;
    ALTER TABLE public.mock_exams ADD CONSTRAINT mock_exams_exam_mode_chk
        CHECK (exam_mode IN ('sequential', 'retake', 'live', 'self_paced'));
END;
$mode_check$;

-- 3. mock_exam_audiences -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mock_exam_audiences (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id          uuid NOT NULL REFERENCES public.mock_exams(id) ON DELETE CASCADE,
    user_id          uuid REFERENCES public.users(id) ON DELETE SET NULL,
    student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    source_kind      text NOT NULL,
    source_cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
    source_group_id  uuid,
    skills           text[] NOT NULL,
    selected         boolean NOT NULL DEFAULT true,
    excluded_reason  text,
    open_from        timestamptz,
    open_until       timestamptz,
    purpose          text NOT NULL DEFAULT 'main',
    added_by         uuid,
    added_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mock_exam_audiences_one_per_purpose UNIQUE (exam_id, student_id, purpose),
    CONSTRAINT mock_exam_audiences_source_kind_valid
        CHECK (source_kind IN ('cohort', 'learner', 'group')),
    CONSTRAINT mock_exam_audiences_source_matches
        CHECK ((source_kind = 'cohort') = (source_cohort_id IS NOT NULL)
               AND (source_kind = 'group') = (source_group_id IS NOT NULL)),
    CONSTRAINT mock_exam_audiences_skills_valid
        CHECK (cardinality(skills) >= 1
               AND skills <@ ARRAY['listening', 'reading', 'writing', 'speaking']::text[]),
    CONSTRAINT mock_exam_audiences_purpose_valid CHECK (purpose IN ('main', 'makeup')),
    CONSTRAINT mock_exam_audiences_window_valid
        CHECK (open_from IS NULL OR open_until IS NULL OR open_from <= open_until),
    -- A learner without an account is shown, never selected.
    CONSTRAINT mock_exam_audiences_account_to_select
        CHECK (user_id IS NOT NULL OR NOT selected)
);

-- Deleting a users row sets user_id NULL (FK action). A row that was still
-- selected would then break mock_exam_audiences_account_to_select and block the
-- user delete; instead the row stays visible and becomes "no account"
-- (CR #2565). Only that transition is rewritten: a direct write of a NULL
-- user_id with selected=true still fails the CHECK.
CREATE OR REPLACE FUNCTION public.fn_mock_exam_audiences_account_removed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
    IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL AND NEW.selected THEN
        NEW.selected := false;
        NEW.excluded_reason := 'no_account';
    END IF;
    RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_mock_exam_audiences_account_removed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mock_exam_audiences_account_removed ON public.mock_exam_audiences;
CREATE TRIGGER trg_mock_exam_audiences_account_removed
    BEFORE UPDATE OF user_id ON public.mock_exam_audiences
    FOR EACH ROW EXECUTE FUNCTION public.fn_mock_exam_audiences_account_removed();

CREATE INDEX IF NOT EXISTS idx_mock_exam_audiences_exam
    ON public.mock_exam_audiences (exam_id);
CREATE INDEX IF NOT EXISTS idx_mock_exam_audiences_user
    ON public.mock_exam_audiences (user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.mock_exam_audiences IS
'MOCKORG-0086 plan 5.5: who sits a mock exam. Three sources add up (class,
learner, saved group), de-duplicated per (exam, student, purpose); source_kind
keeps the first. skills per person must be a subset of the exam''s skills
(checked by the service, which knows the exam). Thi bù is purpose=makeup, not
a mode. Backend-only.';

ALTER TABLE public.mock_exam_audiences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_exam_audiences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_audiences TO service_role;

-- 4. Postconditions ----------------------------------------------------------
DO $post$
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mock_exam_audiences'::regclass) THEN
        RAISE EXCEPTION 'mock_exam_audiences_445_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.mock_exam_audiences'::regclass) THEN
        RAISE EXCEPTION 'mock_exam_audiences_445_unexpected_policy';
    END IF;
    IF has_table_privilege('anon', 'public.mock_exam_audiences', 'SELECT')
       OR has_table_privilege('authenticated', 'public.mock_exam_audiences', 'SELECT') THEN
        RAISE EXCEPTION 'mock_exam_audiences_445_client_grant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.mock_exam_audiences'::regclass
                      AND tgname = 'trg_mock_exam_audiences_account_removed' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'mock_exam_audiences_445_account_trigger_missing';
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'mock_exams'
           AND column_name IN ('skills', 'allow_early_advance', 'starts_at', 'draft_state')) <> 4 THEN
        RAISE EXCEPTION 'mock_exams_445_columns_missing';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
