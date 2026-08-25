-- Migration: 233_recover_bao_quyen_course_retries.sql
-- Mô tả: mở đúng section-attempt kế tiếp cho hai full retry của Bảo Quyên.
-- Hai nhóm Quiz 90 câu đã có đủ session/attempt evidence trên server, nhưng tab
-- frontend cũ không gọi handshake /course/full-retry nên chưa vào mastery ledger.
-- Không carry hoặc sửa bất kỳ Writing/Reading/Listening submission nào.

BEGIN;

WITH targets(
    item_id,
    assignment_id,
    bank_id,
    student_id,
    user_id,
    expected_attempts,
    next_attempt_no,
    expected_latest_pct,
    expected_latest_at,
    expected_correct,
    session_ids
) AS (
    VALUES
        (
            '0ef1abb9-b7db-4c45-ad29-04dc8eb52477'::UUID,
            '72b25b9d-6b66-47cd-91e4-df14aa422459'::UUID,
            'ca2ca772-e701-4c4d-82da-d3039d2d9355'::UUID,
            '2094f802-05ee-4e9c-a2d8-267dfa0be052'::UUID,
            'da28348e-5fd2-4936-b54a-c39ae79a48da'::UUID,
            12,
            13,
            55.0::NUMERIC,
            '2026-08-25T02:10:59.216448+00:00'::TIMESTAMPTZ,
            87,
            ARRAY[
                '6634ada4-dac3-48b9-a288-aa8513c273c9',
                '401eb6b3-71f5-49bd-b6f7-3af22473a11b',
                '2a5b6ea5-4abe-4eb6-a59a-e87dc6f57b8a',
                '3784e8ee-9dbe-4ac5-9a0c-c619d95c26b7',
                'ed369829-ab94-425f-a80a-65beb7d7dd04',
                'ae9d91e8-2fe6-4205-83f0-3b3d6da95b01',
                'bcaf44eb-f2b7-4c37-8d82-eb27ddf27a01',
                '222150b0-50eb-4045-911c-f6c4bebc43aa',
                'f5b48bf0-f660-4d58-8288-b9066558c453'
            ]::UUID[]
        ),
        (
            '8ce31e76-a81d-445c-9dc3-b41eb53bd2f5'::UUID,
            'c68c252f-2661-42a1-aa4a-84ada92df0a4'::UUID,
            '89facc0d-ed6f-4d76-b6f8-82c3d5a4c45b'::UUID,
            '2094f802-05ee-4e9c-a2d8-267dfa0be052'::UUID,
            'da28348e-5fd2-4936-b54a-c39ae79a48da'::UUID,
            1,
            2,
            62.9::NUMERIC,
            '2026-08-25T07:53:12.773980+00:00'::TIMESTAMPTZ,
            74,
            ARRAY[
                '6f7ef136-1b4a-470b-8b7d-656fa49e5409',
                '567e3590-7a31-4bf0-9476-c11d2b1a052d',
                '6969352f-e949-40fc-9a39-7fb271e80861',
                'e2e3d6e5-68f2-489b-92d5-876f7c63aeb8',
                'f425770c-c734-4da2-b8ec-1f774f9ccc95',
                'e334e37e-f742-4450-ad0d-0e8c7a8e6b90',
                'ad79fe44-ab61-471c-a187-2449afdc47e8',
                'ec109240-8ee6-41b4-ae50-9eeb3c055b8d',
                'fb74b613-b827-4486-aa32-a7a1a7c30a2d'
            ]::UUID[]
        )
), eligible AS (
    SELECT item.id,
           item.mastery,
           item.updated_at,
           target.next_attempt_no,
           target.expected_latest_at
      FROM targets AS target
      JOIN class_assignment_items AS item
        ON item.id = target.item_id
       AND item.assignment_id = target.assignment_id
       AND item.student_id = target.student_id
      JOIN class_assignments AS assignment
        ON assignment.id = target.assignment_id
       AND assignment.content_id = target.bank_id
       AND assignment.skill = 'course'
      CROSS JOIN LATERAL (
          SELECT count(*) AS session_count,
                 COALESCE(sum(session.total_questions), 0) AS total_questions,
                 COALESCE(sum(session.total_correct), 0) AS total_correct
            FROM quiz_sessions AS session
           WHERE session.id = ANY(target.session_ids)
             AND session.user_id = target.user_id
             AND session.bank_id = target.bank_id
             AND session.class_assignment_item_id = target.item_id
             AND session.kind = 'run'
             AND session.ended_at IS NOT NULL
             AND session.created_at > target.expected_latest_at
      ) AS audited_sessions
     WHERE item.state = 'opened'
       AND item.passed_at IS NULL
       AND item.submitted_at IS NULL
       AND jsonb_typeof(item.mastery -> 'attempts') = 'array'
       AND jsonb_array_length(item.mastery -> 'attempts')
             = target.expected_attempts
       AND (item.mastery -> 'attempts' -> -1 ->> 'completed')::BOOLEAN IS TRUE
       AND (item.mastery -> 'attempts' -> -1 ->> 'pct')::NUMERIC
             = target.expected_latest_pct
       AND item.mastery -> 'attempts' -> -1 ->> 'next_action' = 'retry_full'
       AND (item.mastery -> 'attempts' -> -1 ->> 'at')::TIMESTAMPTZ
             = target.expected_latest_at
       AND item.mastery ->> 'active_section_attempt_no' IS NULL
       AND COALESCE(
               (item.mastery ->> 'section_attempt_pending')::BOOLEAN,
               FALSE
           ) IS FALSE
       AND audited_sessions.session_count = cardinality(target.session_ids)
       AND audited_sessions.total_questions = 90
       AND audited_sessions.total_correct = target.expected_correct
       AND NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(item.mastery -> 'attempts') AS attempt
             CROSS JOIN LATERAL jsonb_array_elements_text(
                 COALESCE(attempt -> 'sessions', '[]'::JSONB)
             ) AS referenced(session_id)
            WHERE referenced.session_id IN (
                SELECT expected.id::TEXT
                  FROM unnest(target.session_ids) AS expected(id)
            )
       )
       AND NOT EXISTS (
           SELECT 1
             FROM quiz_sessions AS extra
            WHERE extra.class_assignment_item_id = target.item_id
              AND extra.user_id = target.user_id
              AND extra.bank_id = target.bank_id
              AND extra.kind = 'run'
              AND extra.ended_at IS NOT NULL
              AND extra.created_at > target.expected_latest_at
              AND NOT (extra.id = ANY(target.session_ids))
              AND NOT EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(item.mastery -> 'attempts') AS attempt
                    CROSS JOIN LATERAL jsonb_array_elements_text(
                        COALESCE(attempt -> 'sessions', '[]'::JSONB)
                    ) AS referenced(session_id)
                   WHERE referenced.session_id = extra.id::TEXT
              )
       )
)
UPDATE class_assignment_items AS item
   SET mastery = jsonb_set(
           jsonb_set(
               jsonb_set(
                   eligible.mastery,
                   '{active_section_attempt_no}',
                   to_jsonb(eligible.next_attempt_no),
                   TRUE
               ),
               '{section_attempt_pending}',
               'true'::JSONB,
               TRUE
           ),
           '{section_attempt_started_at}',
           to_jsonb(eligible.expected_latest_at),
           TRUE
       ),
       updated_at = NOW()
  FROM eligible
 WHERE item.id = eligible.id
   AND item.updated_at = eligible.updated_at;

COMMIT;

-- Verify (read-only):
-- SELECT a.title,
--        i.mastery ->> 'active_section_attempt_no' AS active_attempt_no,
--        i.mastery ->> 'section_attempt_pending' AS pending,
--        i.mastery ->> 'section_attempt_started_at' AS started_at
--   FROM class_assignment_items AS i
--   JOIN class_assignments AS a ON a.id = i.assignment_id
--  WHERE i.id IN (
--      '0ef1abb9-b7db-4c45-ad29-04dc8eb52477',
--      '8ce31e76-a81d-445c-9dc3-b41eb53bd2f5'
--  )
--  ORDER BY a.title;
