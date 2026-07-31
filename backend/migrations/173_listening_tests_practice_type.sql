-- 173_listening_tests_practice_type.sql
--
-- Thêm `practice` vào listening_tests.test_type.
--
-- Vì sao cần một loại thứ tư thay vì dùng lại `mini` hoặc `drill`:
--   • `full`     — đề Cambridge đủ 4 section, ~30 phút
--   • `mini`     — MỘT section đề thi, 4-6 phút, cùng nhịp phòng thi
--   • `drill`    — luyện theo DẠNG CÂU HỎI (điền form, bản đồ, nối…)
--   • `practice` — kho bài ngắn 30-90 giây, nhịp dày, trục chính là LOẠI BẪY
--
-- Nhét `practice` vào `mini` sẽ chôn 32 đề Cambridge dưới hàng trăm bài TTS;
-- nhét vào `drill` thì một thẻ trộn hai trục khác nhau (dạng câu hỏi vs loại
-- bẫy) và người học không biết mình đang chọn theo tiêu chí gì.
--
-- Ba nhóm con nằm trong `metadata.practice_group` (trap | section | curated),
-- KHÔNG thành ba test_type: chúng chung một thư viện, một trang, ba tab —
-- test_type là thứ endpoint danh sách phân tách, group là thứ tab phân tách.
--
-- An toàn: chỉ nới CHECK. Không đụng dòng nào đang có; `full|mini|drill` giữ
-- nguyên ý nghĩa, nên bản cũ của backend vẫn chạy được sau khi áp migration
-- này (nó chỉ không biết tới `practice`).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'listening_tests_test_type_check'
    ) THEN
        ALTER TABLE listening_tests
            DROP CONSTRAINT listening_tests_test_type_check;
    END IF;

    ALTER TABLE listening_tests
        ADD CONSTRAINT listening_tests_test_type_check
        CHECK (test_type IN ('full', 'mini', 'drill', 'practice'));
END $$;

-- Tab của trang Luyện nhanh lọc theo (test_type, metadata->>practice_group).
-- Chỉ đánh index phần `practice` — ba loại kia không dùng cột này.
CREATE INDEX IF NOT EXISTS idx_listening_tests_practice_group
    ON listening_tests ((metadata->>'practice_group'), status)
    WHERE test_type = 'practice';

COMMENT ON CONSTRAINT listening_tests_test_type_check ON listening_tests IS
    'full=đề đủ 4 section · mini=1 section đề thi · drill=luyện theo dạng câu hỏi · practice=bài ngắn luyện bẫy (metadata.practice_group: trap|section|curated)';
