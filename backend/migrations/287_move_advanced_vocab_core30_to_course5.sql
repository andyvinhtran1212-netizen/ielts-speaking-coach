-- Advanced Vocabulary core-30 belongs to Course 5.
-- This migration moves the existing assignment-only banks in place so their
-- stable UUIDs and any future references are preserved.

BEGIN;

DO $$
DECLARE
    v_course_id UUID;
    v_count INTEGER;
BEGIN
    SELECT id INTO STRICT v_course_id FROM courses WHERE code = 'C5';

    SELECT COUNT(*) INTO v_count
      FROM quiz_banks
     WHERE meta -> 'runtime' ->> 'kind' = 'advanced_vocab'
       AND meta -> 'runtime' ->> 'lesson_id'
           ~ '^ADV-T(0[1-9]|[12][0-9]|30)$';
    IF v_count <> 30 THEN
        RAISE EXCEPTION 'expected 30 Advanced Vocabulary core banks, found %', v_count;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM quiz_banks q
         WHERE q.code ~ '^C5-ADV-T(0[1-9]|[12][0-9]|30)$'
           AND COALESCE(q.meta -> 'runtime' ->> 'kind', '') <> 'advanced_vocab'
    ) THEN
        RAISE EXCEPTION 'C5 Advanced Vocabulary bank code collision';
    END IF;

    UPDATE quiz_banks
       SET course_id = v_course_id,
           code = 'C5-' || (meta -> 'runtime' ->> 'lesson_id'),
           updated_at = NOW()
     WHERE meta -> 'runtime' ->> 'kind' = 'advanced_vocab'
       AND meta -> 'runtime' ->> 'lesson_id'
           ~ '^ADV-T(0[1-9]|[12][0-9]|30)$'
       AND (course_id IS DISTINCT FROM v_course_id
            OR code IS DISTINCT FROM 'C5-' || (meta -> 'runtime' ->> 'lesson_id'));

    IF (SELECT COUNT(*) FROM quiz_banks
         WHERE course_id = v_course_id
           AND code ~ '^C5-ADV-T(0[1-9]|[12][0-9]|30)$'
           AND meta -> 'runtime' ->> 'kind' = 'advanced_vocab') <> 30 THEN
        RAISE EXCEPTION 'Course 5 Advanced Vocabulary remap verification failed';
    END IF;
END $$;

COMMIT;
