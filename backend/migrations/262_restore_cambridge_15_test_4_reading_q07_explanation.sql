-- Migration: 262_restore_cambridge_15_test_4_reading_q07_explanation.sql
-- Mô tả: giữ bản import Cambridge 15 Test 4 Reading Q07 đồng nhất với bản sửa
-- 246. Importer từng ghi đè tips và bỏ trap_analysis sau khi migration 246 chạy.
-- Chỉ Q06/Q07 của đúng canonical test được cập nhật; attempt cũ không đổi.

BEGIN;

WITH target_q07 AS (
    SELECT rq.id
      FROM reading_questions AS rq
      JOIN reading_passages AS rp ON rp.id = rq.passage_id
      JOIN reading_tests AS rt ON rt.id = rp.test_id
     WHERE rt.test_id = 'ILR-RDG-CAM-B15-T4'
       AND rq.q_num = 7
)
UPDATE reading_questions AS rq
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
           COALESCE(rq.payload, '{}'::jsonb),
           '{solution}',
           COALESCE(rq.payload -> 'solution', '{}'::jsonb)
               || jsonb_build_object(
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
       OR rq.payload -> 'solution' IS DISTINCT FROM
           COALESCE(rq.payload -> 'solution', '{}'::jsonb)
               || jsonb_build_object(
                   'question_text', 'Which two parts of the tree were used for medicine? Enter both words; either order is accepted.',
                   'tips', 'Điền đủ hai từ leaves và bark. Có thể đảo thứ tự; chỉ điền một từ thì không được tính điểm.',
                   'trap_analysis', 'Đây là hai ô con cùng mang số 7. Từ and nằm cố định giữa hai ô trong bản in, nên hai từ cần nhập là leaves và bark; cả hai đều bắt buộc.'
               )
   );

WITH target_q06 AS (
    SELECT rq.id
      FROM reading_questions AS rq
      JOIN reading_passages AS rp ON rp.id = rq.passage_id
      JOIN reading_tests AS rt ON rt.id = rp.test_id
     WHERE rt.test_id = 'ILR-RDG-CAM-B15-T4'
       AND rq.q_num = 6
), canonical AS (
    SELECT E'Traditional uses of the huarango tree\nPart of tree | Traditional use\n{{6}} | fuel\n{{7}} | medicine — enter both tree parts, either order\n{{8}} | construction'::text AS summary_text
)
UPDATE reading_questions AS rq
   SET payload = jsonb_set(
           COALESCE(rq.payload, '{}'::jsonb),
           '{template}',
           COALESCE(rq.payload -> 'template', '{}'::jsonb)
               || jsonb_build_object('summary_text', canonical.summary_text),
           TRUE
       ),
       updated_at = NOW()
  FROM canonical
 WHERE rq.id IN (SELECT id FROM target_q06)
   AND rq.payload -> 'template' ->> 'summary_text'
       IS DISTINCT FROM canonical.summary_text;

COMMIT;
