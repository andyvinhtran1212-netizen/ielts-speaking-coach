-- Migration: 232_reconcile_legacy_course_weight_results.sql
-- Mô tả: reconcile ba kết quả Grammar 01 đã được audit: lượt cuối chốt bằng
-- trọng số fallback 50/50 trước migration 231, nhưng snapshot canonical 70/30
-- hiện tại đưa cả ba qua ngưỡng 75. Câu trả lời và thời điểm làm bài giữ nguyên.

BEGIN;

WITH targets(item_id, expected_old_pct, expected_new_pct) AS (
    VALUES
        ('5173a6ec-392a-44aa-b565-da08ca198c1b'::UUID, 65.0::NUMERIC, 79.0::NUMERIC),
        ('be3680b1-8e04-4d95-b3b9-73f38f61ca02'::UUID, 72.5::NUMERIC, 81.5::NUMERIC),
        ('fd2bad7d-8090-4731-b10e-910fe994e893'::UUID, 69.5::NUMERIC, 81.2::NUMERIC)
), latest AS (
    SELECT item.id,
           item.mastery,
           item.updated_at,
           target.expected_new_pct,
           item.mastery -> 'attempts' -> -1 AS attempt,
           jsonb_array_length(item.mastery -> 'attempts') - 1 AS attempt_index,
           assignment.content_config -> 'section_weights' AS canonical_weights
      FROM targets AS target
      JOIN class_assignment_items AS item ON item.id = target.item_id
      JOIN class_assignments AS assignment ON assignment.id = item.assignment_id
     WHERE item.assignment_id = '72b25b9d-6b66-47cd-91e4-df14aa422459'::UUID
       AND assignment.skill = 'course'
       AND assignment.content_config ->> 'weight_policy'
             = 'hybrid_question_count_v1'
       AND assignment.content_config -> 'section_weights'
             = '{"quiz": 70.00, "writing": 30.00}'::JSONB
       AND (assignment.content_config ->> 'pass_pct')::NUMERIC = 75
       AND item.state = 'opened'
       AND item.score = target.expected_old_pct
       AND item.passed_at IS NULL
       AND item.submitted_at IS NULL
       AND jsonb_typeof(item.mastery -> 'attempts') = 'array'
       AND jsonb_array_length(item.mastery -> 'attempts') > 0
       AND (item.mastery -> 'attempts' -> -1 ->> 'completed')::BOOLEAN IS TRUE
       AND (item.mastery -> 'attempts' -> -1 ->> 'pct')::NUMERIC
             = target.expected_old_pct
       AND (item.mastery ->> 'threshold')::NUMERIC = 75
       AND item.mastery -> 'attempts' -> -1 ->> 'next_action' = 'retake'
), reconciled AS (
    SELECT latest.*,
           sections.value AS reconciled_sections,
           session.id AS artifact_id,
           COALESCE(
               NULLIF(latest.attempt ->> 'at', '')::TIMESTAMPTZ,
               session.ended_at
           ) AS completed_at
      FROM latest
      CROSS JOIN LATERAL (
          SELECT jsonb_object_agg(
                     section.key,
                     section.value || jsonb_build_object(
                         'weight', (latest.canonical_weights ->> section.key)::NUMERIC
                     )
                 ) AS value
            FROM jsonb_each(latest.attempt -> 'sections') AS section(key, value)
      ) AS sections
      JOIN quiz_sessions AS session
        ON session.id::TEXT = latest.attempt -> 'sessions' ->> 0
       AND session.class_assignment_item_id = latest.id
       AND session.ended_at IS NOT NULL
     WHERE latest.attempt -> 'sections'
             = jsonb_build_object(
                 'quiz', (latest.attempt -> 'sections' -> 'quiz'),
                 'writing', (latest.attempt -> 'sections' -> 'writing')
             )
       AND round(
               (latest.attempt #>> '{sections,quiz,pct}')::NUMERIC * 0.70
               + (latest.attempt #>> '{sections,writing,pct}')::NUMERIC * 0.30,
               1
           ) = latest.expected_new_pct
       AND latest.expected_new_pct >= 75
)
UPDATE class_assignment_items AS item
   SET mastery = jsonb_set(
           reconciled.mastery,
           ARRAY['attempts', reconciled.attempt_index::TEXT],
           reconciled.attempt || jsonb_build_object(
               'sections', reconciled.reconciled_sections,
               'pct', reconciled.expected_new_pct,
               'next_action', 'passed'
           ),
           FALSE
       ),
       state = 'graded',
       score = reconciled.expected_new_pct,
       passed_at = reconciled.completed_at,
       submitted_at = reconciled.completed_at,
       artifact_kind = 'quiz_session',
       artifact_id = reconciled.artifact_id,
       updated_at = NOW()
  FROM reconciled
 WHERE item.id = reconciled.id
   AND item.updated_at = reconciled.updated_at
   AND item.passed_at IS NULL
   AND item.submitted_at IS NULL;

COMMIT;

-- Verify (read-only):
-- SELECT s.full_name, i.state, i.score, i.passed_at, i.submitted_at,
--        i.mastery -> 'attempts' -> -1 ->> 'next_action' AS next_action
--   FROM class_assignment_items AS i
--   JOIN students AS s ON s.id = i.student_id
--  WHERE i.id IN (
--      '5173a6ec-392a-44aa-b565-da08ca198c1b',
--      'be3680b1-8e04-4d95-b3b9-73f38f61ca02',
--      'fd2bad7d-8090-4731-b10e-910fe994e893'
--  )
--  ORDER BY s.full_name;
