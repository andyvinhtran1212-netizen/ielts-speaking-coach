-- Migration: 231_backfill_legacy_course_weights.sql
-- Mô tả: chụp trọng số hybrid cho assignment course cũ chưa có snapshot. Sau
-- backfill, bank live đổi nội dung cũng không đổi luật dưới chân học viên.

BEGIN;

DO $$
DECLARE
    assignment RECORD;
    quiz_n INTEGER;
    writing_n INTEGER;
    reading_n INTEGER;
    listening_n INTEGER;
    pronunciation_n INTEGER;
    section_n INTEGER;
    unit_n INTEGER;
    section_name TEXT;
    last_section_name TEXT;
    section_units INTEGER;
    section_weight NUMERIC;
    assigned_weight NUMERIC;
    counts JSONB;
    weights JSONB;
BEGIN
    FOR assignment IN
        SELECT a.id, a.content_id, a.content_config, b.meta
          FROM class_assignments AS a
          JOIN quiz_banks AS b ON b.id = a.content_id
         WHERE a.skill = 'course'
           AND COALESCE(a.content_config ->> 'weight_policy', '') = ''
         FOR UPDATE OF a
    LOOP
        SELECT count(*) FILTER (
                   WHERE (q.type IS NULL OR q.type = 'mcq')
                     AND q.counts_toward_mastery IS NOT FALSE
               ),
               count(*) FILTER (WHERE q.type = 'writing')
          INTO quiz_n, writing_n
          FROM quiz_questions AS q
         WHERE q.bank_id = assignment.content_id;

        reading_n := CASE
            WHEN jsonb_typeof(assignment.meta -> 'short_reading' -> 'answers') = 'array'
            THEN jsonb_array_length(assignment.meta -> 'short_reading' -> 'answers')
            ELSE 0
        END;
        listening_n := CASE
            WHEN jsonb_typeof(assignment.meta -> 'short_listening' -> 'solution' -> 'answers') = 'array'
            THEN jsonb_array_length(
                assignment.meta -> 'short_listening' -> 'solution' -> 'answers')
            ELSE 0
        END;
        SELECT COALESCE(jsonb_array_length(p.sentences), 0)
          INTO pronunciation_n
          FROM course_pronunciation_sets AS p
         WHERE p.bank_id = assignment.content_id
           AND p.is_active IS TRUE
         ORDER BY p.created_at DESC
         LIMIT 1;
        pronunciation_n := COALESCE(pronunciation_n, 0);

        section_n := (quiz_n > 0)::INTEGER + (writing_n > 0)::INTEGER
                   + (reading_n > 0)::INTEGER + (listening_n > 0)::INTEGER
                   + (pronunciation_n > 0)::INTEGER;
        unit_n := quiz_n + writing_n + reading_n + listening_n + pronunciation_n;
        IF section_n = 0 OR unit_n = 0 THEN
            CONTINUE;
        END IF;

        counts := '{}'::JSONB;
        weights := '{}'::JSONB;
        assigned_weight := 0;
        last_section_name := CASE
            WHEN pronunciation_n > 0 THEN 'pronunciation'
            WHEN listening_n > 0 THEN 'listening'
            WHEN reading_n > 0 THEN 'reading'
            WHEN writing_n > 0 THEN 'writing'
            ELSE 'quiz'
        END;
        FOR section_name, section_units IN
            SELECT * FROM (VALUES
                ('quiz', quiz_n),
                ('writing', writing_n),
                ('reading', reading_n),
                ('listening', listening_n),
                ('pronunciation', pronunciation_n)
            ) AS sections(name, units)
            WHERE units > 0
        LOOP
            counts := counts || jsonb_build_object(section_name, section_units);
            section_weight := round(
                (0.5 / section_n + 0.5 * section_units / unit_n) * 100, 2);
            -- Phần cuối nhận sai số làm tròn để tổng luôn đúng 100%, cùng luật
            -- với _normalize_course_weights() ở backend.
            IF section_name = last_section_name THEN
                section_weight := round(100 - assigned_weight, 2);
            END IF;
            weights := weights || jsonb_build_object(section_name, section_weight);
            assigned_weight := assigned_weight + section_weight;
        END LOOP;

        UPDATE class_assignments
           SET content_config = COALESCE(assignment.content_config, '{}'::JSONB)
                   || jsonb_build_object(
                   'weight_policy', 'hybrid_question_count_v1',
                   'section_counts', counts,
                   'section_weights', weights),
               updated_at = NOW()
         WHERE id = assignment.id
           AND COALESCE(content_config ->> 'weight_policy', '') = '';
    END LOOP;
END;
$$;

COMMIT;

-- Verify (read-only):
-- SELECT id, title, content_config -> 'section_counts' AS counts,
--        content_config -> 'section_weights' AS weights
--   FROM class_assignments
--  WHERE skill = 'course'
--  ORDER BY created_at;
-- SELECT id, title
--   FROM class_assignments
--  WHERE skill = 'course'
--    AND COALESCE(content_config ->> 'weight_policy', '') = '';
