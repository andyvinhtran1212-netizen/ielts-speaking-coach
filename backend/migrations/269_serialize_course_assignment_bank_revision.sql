-- Migration 269 — serialize Course assignment creation with bank replacement.
--
-- `class_assignments.content_id` is intentionally polymorphic and has no FK to
-- quiz_banks.  Locking a bank in the assessment replacement RPC therefore did
-- not block a concurrent assignment insert.  The admin preflight can read the
-- old shape, replacement can commit, and assignment creation can then persist
-- old section counts/weights against new questions.  Give both operations the
-- same bank-row lock and require an exact preflight revision inside the atomic
-- assignment transaction.

CREATE OR REPLACE FUNCTION public.quiz_course_bank_assignment_revision(
    p_bank_id UUID
)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT md5(jsonb_build_object(
        'bank', to_jsonb(qb),
        'questions', COALESCE((
            SELECT jsonb_agg(to_jsonb(qq) ORDER BY qq."order" NULLS LAST, qq.id)
              FROM public.quiz_questions AS qq
             WHERE qq.bank_id = qb.id
        ), '[]'::jsonb),
        'pronunciation_sets', COALESCE((
            SELECT jsonb_agg(to_jsonb(cps) ORDER BY cps.id)
              FROM public.course_pronunciation_sets AS cps
             WHERE cps.bank_id = qb.id
               AND cps.is_active
        ), '[]'::jsonb)
    )::text)
      FROM public.quiz_banks AS qb
     WHERE qb.id = p_bank_id
       AND qb.skill_area = 'course';
$$;

REVOKE ALL ON FUNCTION public.quiz_course_bank_assignment_revision(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_course_bank_assignment_revision(UUID)
    TO service_role;

COMMENT ON FUNCTION public.quiz_course_bank_assignment_revision(UUID) IS
'Returns the exact Course bank/question/active-pronunciation revision used to serialize assignment preflight; service_role only.';

-- Latest signature/semantics from migration 227, with one new Course-only
-- lock-and-revision gate before the roster or assignment is mutated.
CREATE OR REPLACE FUNCTION public.fn_create_class_assignment(
    p_cohort_id      UUID,
    p_skill          TEXT,
    p_title          TEXT,
    p_lesson_id      UUID        DEFAULT NULL,
    p_content_config JSONB       DEFAULT '{}'::JSONB,
    p_content_id     UUID        DEFAULT NULL,
    p_instructions   TEXT        DEFAULT NULL,
    p_due_at         TIMESTAMPTZ DEFAULT NULL,
    p_publish_at     TIMESTAMPTZ DEFAULT NULL,
    p_status         TEXT        DEFAULT 'published',
    p_assigned_by    UUID        DEFAULT NULL,
    p_kind           TEXT        DEFAULT 'daily',
    p_student_ids    UUID[]      DEFAULT NULL
)
RETURNS TABLE (
    assignment JSONB, student_count INTEGER, unactivated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
    v_ids UUID[];
    v_total INTEGER;
    v_unactive INTEGER;
    v_row public.class_assignments%ROWTYPE;
    v_bank_skill TEXT;
    v_expected_revision TEXT;
    v_live_revision TEXT;
BEGIN
    IF p_skill = 'course' THEN
        v_expected_revision := NULLIF(p_content_config ->> 'bank_revision', '');

        SELECT qb.skill_area
          INTO v_bank_skill
          FROM public.quiz_banks AS qb
         WHERE qb.id = p_content_id
         FOR UPDATE;

        IF NOT FOUND OR v_bank_skill <> 'course' THEN
            RAISE EXCEPTION 'course_bank_revision_mismatch'
                USING ERRCODE = '55000';
        END IF;

        v_live_revision := public.quiz_course_bank_assignment_revision(p_content_id);
        IF v_expected_revision IS NULL
           OR v_live_revision IS DISTINCT FROM v_expected_revision THEN
            RAISE EXCEPTION 'course_bank_revision_mismatch'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    SELECT array_agg(t.id), count(*), count(*) FILTER (WHERE t.user_id IS NULL)
      INTO v_ids, v_total, v_unactive
      FROM (
        SELECT s.id, s.user_id
          FROM public.student_cohort_memberships AS m
          JOIN public.students AS s ON s.id = m.student_id
         WHERE m.cohort_id = p_cohort_id
           AND m.is_active
           AND (p_student_ids IS NULL OR s.id = ANY(p_student_ids))
         FOR UPDATE OF m, s
      ) AS t;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'empty_roster'
            USING HINT = 'Không có học viên nào nhận bài này.';
    END IF;

    INSERT INTO public.class_assignments (
        cohort_id, lesson_id, skill, content_id, content_config, title,
        instructions, due_at, publish_at, status, assigned_by, kind,
        recipient_scope
    ) VALUES (
        p_cohort_id, p_lesson_id, p_skill, p_content_id,
        COALESCE(p_content_config, '{}'::JSONB), p_title, p_instructions,
        p_due_at, p_publish_at, COALESCE(p_status, 'published'), p_assigned_by,
        COALESCE(p_kind, 'daily'),
        CASE WHEN p_student_ids IS NULL THEN 'class' ELSE 'subset' END
    ) RETURNING * INTO v_row;

    v_id := v_row.id;
    INSERT INTO public.class_assignment_items (assignment_id, student_id)
    SELECT v_id, unnest(v_ids);

    assignment := to_jsonb(v_row);
    student_count := v_total;
    unactivated_count := v_unactive;
    RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_create_class_assignment(
    UUID, TEXT, TEXT, UUID, JSONB, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
    TEXT, UUID, TEXT, UUID[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_class_assignment(
    UUID, TEXT, TEXT, UUID, JSONB, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
    TEXT, UUID, TEXT, UUID[]
) TO service_role;

COMMENT ON FUNCTION public.fn_create_class_assignment(
    UUID, TEXT, TEXT, UUID, JSONB, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
    TEXT, UUID, TEXT, UUID[]
) IS
'Atomically creates an assignment and roster fan-out; Course assignments additionally lock and verify the exact bank preflight revision.';
