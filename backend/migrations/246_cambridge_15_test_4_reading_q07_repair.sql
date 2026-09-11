-- Cambridge 15 Test 4 Reading Q07 canonical repair.
--
-- The printed item has two sub-blanks under one question number. Both
-- "leaves" and "bark" are required, in either order. The imported web row
-- collapsed the answer-key notation into the literal matcher
-- "leaves (and) bark" and its flattened table put "and" in the wrong column.
--
-- This patch is deliberately data-scoped and idempotent. It touches only the
-- canonical Cambridge 15 Test 4 Reading rows Q06/Q07 identified through the
-- test FK chain. Historical attempts are not rewritten.

WITH target_q07 AS (
    SELECT rq.id
    FROM reading_questions rq
    JOIN reading_passages rp ON rp.id = rq.passage_id
    JOIN reading_tests rt ON rt.id = rp.test_id
    WHERE rt.test_id = 'ILR-RDG-CAM-B15-T4'
      AND rq.q_num = 7
)
UPDATE reading_questions rq
SET answer = jsonb_build_object(
        'answer', 'leaves bark',
        'alternatives', jsonb_build_array(
            'bark leaves',
            'leaves and bark',
            'bark and leaves',
            'leaves, bark',
            'bark, leaves'
        )
    ),
    payload = jsonb_set(
        rq.payload,
        '{solution}',
        COALESCE(rq.payload->'solution', '{}'::jsonb) || jsonb_build_object(
            'question_text', 'Which two parts of the tree were used for medicine? Enter both words; either order is accepted.',
            'tips', 'Điền đủ hai từ leaves và bark. Có thể đảo thứ tự; chỉ điền một từ thì không được tính điểm.',
            'trap_analysis', 'Đây là hai ô con cùng mang số 7. Từ and nằm cố định giữa hai ô trong bản in, nên hai từ cần nhập là leaves và bark; cả hai đều bắt buộc.'
        ),
        TRUE
    ),
    updated_at = NOW()
WHERE rq.id IN (SELECT id FROM target_q07)
  AND (
      rq.answer IS DISTINCT FROM jsonb_build_object(
          'answer', 'leaves bark',
          'alternatives', jsonb_build_array(
              'bark leaves',
              'leaves and bark',
              'bark and leaves',
              'leaves, bark',
              'bark, leaves'
          )
      )
      OR rq.payload->'solution'->>'question_text'
         IS DISTINCT FROM 'Which two parts of the tree were used for medicine? Enter both words; either order is accepted.'
  );

WITH target_q06 AS (
    SELECT rq.id
    FROM reading_questions rq
    JOIN reading_passages rp ON rp.id = rq.passage_id
    JOIN reading_tests rt ON rt.id = rp.test_id
    WHERE rt.test_id = 'ILR-RDG-CAM-B15-T4'
      AND rq.q_num = 6
)
UPDATE reading_questions rq
SET payload = jsonb_set(
        rq.payload,
        '{template}',
        COALESCE(rq.payload->'template', '{}'::jsonb) || jsonb_build_object(
            'summary_text', E'Traditional uses of the huarango tree\nPart of tree | Traditional use\n{{6}} | fuel\n{{7}} | medicine — enter both tree parts, either order\n{{8}} | construction'
        ),
        TRUE
    ),
    updated_at = NOW()
WHERE rq.id IN (SELECT id FROM target_q06)
  AND rq.payload->'template'->>'summary_text'
      IS DISTINCT FROM E'Traditional uses of the huarango tree\nPart of tree | Traditional use\n{{6}} | fuel\n{{7}} | medicine — enter both tree parts, either order\n{{8}} | construction';
