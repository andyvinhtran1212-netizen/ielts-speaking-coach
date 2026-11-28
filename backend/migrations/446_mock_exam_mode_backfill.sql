-- MOCKORG-0086 G09-T31 PR 2 (plan 5.5, migration table row 446).
-- Number 446 is from the G09 band 440-459 of the commercialization register.
-- No apply on merge: pending_feature mock_exam_mode_names. Order (rollout.md):
-- 445 applied, then the backend that reads both mode names deployed and
-- checked on that database (an old exam with an open sitting still resumes and
-- is still swept), and only then 446. Staging first under the advisory lock
-- with anh Andy's typed approval; production only at an authorised
-- staging-to-main promotion.
--
-- What it does, in one transaction:
--   1. Every database function that compares exam_mode to a legacy literal is
--      rewritten to accept both names. Each rewrite replaces one exact snippet
--      of the live definition and refuses (drift) when that snippet is not
--      there exactly once, so a hand-edited function is never overwritten.
--   2. fn_set_exam_mode accepts the four names and stores the new one.
--   3. A trigger stores the new name on every INSERT and on UPDATE OF
--      exam_mode, so a legacy name sent by any writer lands as the new name.
--   4. mock_exam_audiences is filled from each exam's class roster (live) and
--      from mock_exam_assignments (self-paced), only for exams still under a
--      legacy name with no audience row at all. A list an admin already set is
--      never widened, and step 5's rename marks the exam done (empty roster
--      too), so a re-run after a roster change adds nobody.
--   5. Stored names are renamed sequential→live, retake→self_paced.
-- Exams with is_open = true are skipped by 4 and 5 (NOTICE); re-run 446 once
-- they close. Re-runnable; postconditions at the end. The runner skips a file
-- already in _schema_migrations, so a re-run is a manual psql -f under the
-- runner's advisory lock, with the owner's approval (specs/0086 rollout.md).
-- Rollback: rollback/446_mock_exam_mode_backfill.sql (names back, trigger and
-- fn_set_exam_mode back; the dual-name function rewrites and audience rows
-- stay, they are valid under both names).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $pre$
BEGIN
    IF to_regclass('public.mock_exam_audiences') IS NULL THEN
        RAISE EXCEPTION 'mock_exam_446_requires_445' USING ERRCODE = '55000';
    END IF;
END;
$pre$;

-- 1. Dual-name rewrites of the functions that compare exam_mode ------------
CREATE FUNCTION pg_temp.mock446_rewrite(p_fn text, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
    definition text;
    hits int;
BEGIN
    IF to_regprocedure(p_fn) IS NULL THEN
        RAISE EXCEPTION 'mock_exam_446_function_missing: %', p_fn USING ERRCODE = '55000';
    END IF;
    definition := pg_get_functiondef(to_regprocedure(p_fn));
    hits := (length(definition) - length(replace(definition, p_old, ''))) / length(p_old);
    IF hits = 0 AND position(p_new IN definition) > 0 THEN
        RETURN;  -- re-run of 446
    END IF;
    IF hits <> 1 THEN
        RAISE EXCEPTION 'mock_exam_446_function_drift: % (% matches of %)', p_fn, hits, p_old
            USING ERRCODE = '55000';
    END IF;
    EXECUTE replace(definition, p_old, p_new);
END;
$fn$;

SELECT pg_temp.mock446_rewrite('public.fn_mock_section_valid(text,jsonb,jsonb)',
    $s$p_exam->>'exam_mode'='retake'$s$,
    $s$p_exam->>'exam_mode' IN ('retake','self_paced')$s$);
SELECT pg_temp.mock446_rewrite('public.fn_mock_paper_dependencies(text,uuid)',
    $s$e.row->>'exam_mode'='retake'$s$,
    $s$e.row->>'exam_mode' IN ('retake','self_paced')$s$);
SELECT pg_temp.mock446_rewrite('public.fn_guard_mock_paper_policy()',
    $s$m.exam_mode IS DISTINCT FROM 'retake'$s$,
    $s$COALESCE(m.exam_mode,'live') NOT IN ('retake','self_paced')$s$);
SELECT pg_temp.mock446_rewrite('public.fn_guard_owned_mock_attempt(text,jsonb,text)',
    $s$(exam->>'exam_mode'='retake' AND$s$,
    $s$(exam->>'exam_mode' IN ('retake','self_paced') AND$s$);
SELECT pg_temp.mock446_rewrite('public.fn_guard_owned_mock_attempt(text,jsonb,text)',
    $s$(exam->>'exam_mode'='sequential' AND$s$,
    $s$(exam->>'exam_mode' IN ('sequential','live') AND$s$);
SELECT pg_temp.mock446_rewrite('public.fn_admin_mock_exams_with_review_eligibility()',
    $s$exam.exam_mode = 'retake'$s$,
    $s$exam.exam_mode IN ('retake', 'self_paced')$s$);

-- Keep the two mode rewrites above intact so an earlier build of 446
-- can be upgraded in place. NULL denotes an unscoped legacy live sitting.
SELECT pg_temp.mock446_rewrite('public.fn_mock_section_valid(text,jsonb,jsonb)',
    $s$IF p_exam->>'active_section'<>p_skill OR$s$,
    $s$IF (p_sitting->>'assigned_skills' IS NOT NULL
            AND NOT (p_sitting->'assigned_skills' @> jsonb_build_array(p_skill)))
           OR p_exam->>'active_section'<>p_skill OR$s$);
SELECT pg_temp.mock446_rewrite('public.fn_guard_owned_mock_attempt(text,jsonb,text)',
    $s$AND exam->>'active_section'=p_skill AND exam->>'collected_section'$s$,
    $s$AND (sitting->>'assigned_skills' IS NULL OR sitting->'assigned_skills' @> jsonb_build_array(p_skill))
                        AND exam->>'active_section'=p_skill
                        AND exam->>'collected_section'$s$);

-- 2. fn_set_exam_mode: four names in, the new name stored -------------------
CREATE OR REPLACE FUNCTION public.fn_set_exam_mode(
    p_exam_id uuid,
    p_mode    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mode text;
    v_out  jsonb;
BEGIN
    v_mode := CASE p_mode WHEN 'sequential' THEN 'live' WHEN 'retake' THEN 'self_paced'
                          ELSE p_mode END;
    IF v_mode NOT IN ('live', 'self_paced') THEN
        RAISE EXCEPTION 'invalid exam_mode: %', p_mode;
    END IF;

    UPDATE mock_exams e
       SET exam_mode = v_mode
     WHERE e.id = p_exam_id
       -- Compare under one naming: a stored legacy name and the same mode
       -- under its new name are not a change.
       AND (CASE COALESCE(e.exam_mode, 'sequential')
                 WHEN 'sequential' THEN 'live' WHEN 'retake' THEN 'self_paced'
                 ELSE e.exam_mode END) IS DISTINCT FROM v_mode
       -- Same dependents rule as migration 169.
       AND NOT EXISTS (
               SELECT 1 FROM mock_exam_sittings s
                WHERE s.mock_exam_id = e.id
                  AND s.status <> 'void'
           )
       AND NOT EXISTS (
               SELECT 1 FROM mock_exam_assignments a
                WHERE a.exam_id = e.id
           )
    RETURNING to_jsonb(e) INTO v_out;

    RETURN v_out;   -- NULL when refused (missing exam, no-op, or dependents)
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_set_exam_mode(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_set_exam_mode(uuid, text)
    TO service_role;

COMMENT ON FUNCTION public.fn_set_exam_mode(uuid, text) IS
'Atomically change mock_exams.exam_mode, refusing when the exam already has a
non-void sitting or any assignment (migration 169). Since 446 (MOCKORG-0086) it
accepts sequential/retake/live/self_paced and stores live/self_paced.';

-- 3. Store the new name whoever writes the row -----------------------------
CREATE OR REPLACE FUNCTION public.fn_mock_exams_new_mode_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
    NEW.exam_mode := CASE NEW.exam_mode WHEN 'sequential' THEN 'live'
                                        WHEN 'retake' THEN 'self_paced'
                                        ELSE NEW.exam_mode END;
    RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_mock_exams_new_mode_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mock_exams_new_mode_name ON public.mock_exams;
-- UPDATE OF exam_mode only: an open exam keeps its stored name until 446 is
-- re-run after it closes, whatever else the room clock writes.
CREATE TRIGGER trg_mock_exams_new_mode_name
    BEFORE INSERT OR UPDATE OF exam_mode ON public.mock_exams
    FOR EACH ROW EXECUTE FUNCTION public.fn_mock_exams_new_mode_name();

ALTER TABLE public.mock_exams ALTER COLUMN exam_mode SET DEFAULT 'live';

-- 4. Fill mock_exam_audiences ------------------------------------------------
-- Only exams never processed: still under a legacy name (step 5 renames them in
-- this transaction, which is the exam-level "done" mark, empty roster
-- included), closed, and with no audience row at all. An exam whose list an
-- admin already set through the audience API keeps exactly that list: no class
-- member is added that the admin did not add or refresh (CR #2595).
CREATE TEMP TABLE mock446_pending ON COMMIT DROP AS
SELECT e.id
  FROM public.mock_exams e
 WHERE e.exam_mode IN ('sequential', 'retake')
   AND e.is_open IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.mock_exam_audiences au WHERE au.exam_id = e.id);

DO $fill$
DECLARE
    skipped_open int;
    kept_lists int;
    roster_rows int;
    assignment_rows int;
    no_student int;
BEGIN
    SELECT count(*) INTO skipped_open FROM public.mock_exams
     WHERE is_open IS TRUE AND exam_mode IN ('sequential', 'retake');
    SELECT count(*) INTO kept_lists FROM public.mock_exams e
     WHERE e.exam_mode IN ('sequential', 'retake') AND e.is_open IS NOT TRUE
       AND EXISTS (SELECT 1 FROM public.mock_exam_audiences au WHERE au.exam_id = e.id);

    -- 4a. Live exams: the class roster today (Q12: a snapshot). Active
    -- memberships, else the legacy students.cohort_id pointer when that class
    -- has no membership row at all (same rule as class_membership_service).
    WITH live_exam AS (
        SELECT e.id, e.cohort_id,
               COALESCE(e.skills, ARRAY['listening', 'reading', 'writing', 'speaking']::text[]) AS skills
          FROM public.mock_exams e
         WHERE e.exam_mode = 'sequential' AND e.cohort_id IS NOT NULL
           AND e.id IN (SELECT id FROM pg_temp.mock446_pending)
    ), roster AS (
        SELECT le.id AS exam_id, le.cohort_id, le.skills, m.student_id
          FROM live_exam le
          JOIN public.student_cohort_memberships m
            ON m.cohort_id = le.cohort_id AND m.is_active
        UNION
        SELECT le.id, le.cohort_id, le.skills, s.id
          FROM live_exam le
          JOIN public.students s ON s.cohort_id = le.cohort_id
         WHERE NOT EXISTS (SELECT 1 FROM public.student_cohort_memberships m
                            WHERE m.cohort_id = le.cohort_id AND m.is_active)
    )
    INSERT INTO public.mock_exam_audiences
        (exam_id, user_id, student_id, source_kind, source_cohort_id, skills,
         selected, excluded_reason, purpose)
    SELECT r.exam_id, s.user_id, s.id, 'cohort', r.cohort_id, r.skills,
           s.user_id IS NOT NULL, CASE WHEN s.user_id IS NULL THEN 'no_account' END, 'main'
      FROM roster r
      JOIN public.students s ON s.id = r.student_id
    ON CONFLICT (exam_id, student_id, purpose) DO NOTHING;
    GET DIAGNOSTICS roster_rows = ROW_COUNT;

    -- 4b. Self-paced exams: one row per assignment, matched to the learner's
    -- students row (oldest when an account links more than one).
    WITH assignment AS (
        SELECT DISTINCT ON (a.id)
               a.exam_id, a.user_id, s.id AS student_id, a.open_from, a.open_until,
               ARRAY(SELECT k FROM unnest(ARRAY['listening', 'reading', 'writing']) AS k
                      WHERE k = ANY (a.skills)) AS skills
          FROM public.mock_exam_assignments a
          JOIN public.mock_exams e ON e.id = a.exam_id AND e.exam_mode = 'retake'
          JOIN pg_temp.mock446_pending p ON p.id = e.id
          JOIN public.students s ON s.user_id = a.user_id
         ORDER BY a.id, s.created_at, s.id
    )
    INSERT INTO public.mock_exam_audiences
        (exam_id, user_id, student_id, source_kind, skills, selected,
         open_from, open_until, purpose)
    SELECT exam_id, user_id, student_id, 'learner', skills, true,
           CASE WHEN open_until IS NULL OR open_from <= open_until THEN open_from END,
           open_until, 'main'
      FROM assignment
     WHERE cardinality(skills) >= 1
    ON CONFLICT (exam_id, student_id, purpose) DO NOTHING;
    GET DIAGNOSTICS assignment_rows = ROW_COUNT;

    SELECT count(*) INTO no_student
      FROM public.mock_exam_assignments a
      JOIN pg_temp.mock446_pending p ON p.id = a.exam_id
     WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = a.user_id);

    RAISE NOTICE 'mock_exam_446 audiences: % from class rosters, % from assignments; % assignments have no students row (not copied); % open exams skipped; % exams kept their existing list',
        roster_rows, assignment_rows, no_student, skipped_open, kept_lists;
END;
$fill$;

-- 5. Rename stored names (open exams wait for a re-run) --------------------
UPDATE public.mock_exams
   SET exam_mode = CASE exam_mode WHEN 'sequential' THEN 'live' ELSE 'self_paced' END
 WHERE exam_mode IN ('sequential', 'retake') AND is_open IS NOT TRUE;

-- 6. Postconditions ----------------------------------------------------------
DO $post$
BEGIN
    IF EXISTS (SELECT 1 FROM public.mock_exams
                WHERE exam_mode IN ('sequential', 'retake') AND is_open IS NOT TRUE) THEN
        RAISE EXCEPTION 'mock_exam_446_legacy_names_left';
    END IF;
    -- No function may still compare exam_mode to a legacy literal only.
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.prosrc LIKE '%exam_mode%'
                  AND ((p.prosrc LIKE '%''retake''%' AND p.prosrc NOT LIKE '%''self_paced''%')
                    OR (p.prosrc LIKE '%''sequential''%' AND p.prosrc NOT LIKE '%''live''%'))) THEN
        RAISE EXCEPTION 'mock_exam_446_single_name_function_left';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.mock_exams'::regclass
                      AND tgname = 'trg_mock_exams_new_mode_name' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'mock_exam_446_trigger_missing';
    END IF;
    -- Every copyable assignment of an exam filled by this run has its row.
    IF EXISTS (SELECT 1 FROM public.mock_exam_assignments a
                 JOIN pg_temp.mock446_pending p ON p.id = a.exam_id
                WHERE EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = a.user_id)
                  AND a.skills && ARRAY['listening', 'reading', 'writing']::text[]
                  AND NOT EXISTS (SELECT 1 FROM public.mock_exam_audiences au
                                   JOIN public.students s ON s.id = au.student_id
                                  WHERE au.exam_id = a.exam_id AND s.user_id = a.user_id
                                    AND au.purpose = 'main')) THEN
        RAISE EXCEPTION 'mock_exam_446_assignment_not_copied';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
