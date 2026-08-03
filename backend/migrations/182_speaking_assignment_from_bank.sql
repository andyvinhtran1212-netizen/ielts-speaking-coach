-- ============================================================================
-- Migration 182 — giao bài Speaking LẤY TỪ KHO ĐỀ, có audio đọc đề
-- ============================================================================
--
-- BỐI CẢNH. GĐ 2 giao bài Speaking bằng một chuỗi chủ đề TỰ DO
-- (`content_config.topic` là text admin gõ tay). Câu hỏi được sinh lúc học viên
-- vào làm — nên hai em cùng một bài giao có thể nhận hai bộ câu khác nhau, và
-- admin không biết trước mình vừa giao cái gì.
--
-- Kho đề đã có sẵn và đủ dùng: `topics` + `topic_questions` (mig 002), hiện có
-- 36 chủ đề Part 1 (mọi chủ đề ≥6 câu), 73 cue card Part 2 đã đủ bullets, và
-- 365 câu Part 3. Migration này nối sổ giao bài vào kho đó.
--
-- BA THỨ ĐƯỢC THÊM:
--
--   1. `topic_questions.audio_url` + `audio_path` — bản đọc đề. Part 1 và Part 3
--      giao bằng AUDIO và học viên KHÔNG được xem chữ: phải nghe mới biết hỏi
--      gì, đúng như phòng thi. Vì thế audio không phải tiện ích mà là ĐIỀU KIỆN
--      để giao được một câu — có test và có chốt ở backend.
--
--   2. `topic_questions.level` — nhãn độ khó. `question_type` sẵn có (opinion,
--      comparison, personal, …) mô tả KIỂU hỏi chứ không phải độ khó, nên không
--      dùng thay được khi admin muốn một bộ đề trải đều dễ–khó.
--
--   3. Chốt KHÔNG GIAO TRÙNG ĐỀ trong cùng một lớp — dưới đây.
--
-- CHỐT CHỐNG TRÙNG ĐỂ Ở DB, KHÔNG CHỈ Ở GIAO DIỆN. Backend có kiểm trước khi
-- ghi, nhưng đó là hai lệnh riêng trên PostgREST: hai tab admin bấm giao cùng
-- lúc thì cả hai đều thấy "chưa ai giao" rồi cùng ghi. Chỉ số duy nhất là thứ
-- duy nhất thắng được cuộc đua đó.
--
-- Không đặt điều kiện theo `status`: lưu trữ một bài giao KHÔNG có nghĩa là học
-- viên chưa từng làm đề ấy. Muốn giao lại thì phải xoá bài giao cũ — và hàm xoá
-- (mig 179–181) sẽ từ chối nếu đã có ai nộp, đúng như mong muốn.
--
-- KHÔNG thêm cột `due_time`: `due_at` đã lưu trọn mốc thời gian tuyệt đối. Việc
-- admin chọn giờ hạn là chuyện của tầng API ghép ngày + giờ theo giờ VN
-- (`compose_due_at`), không phải chuyện của lược đồ. Thêm cột nữa chỉ tạo ra
-- hai nguồn sự thật cho cùng một mốc.
--
-- KHÔNG có bảng "tổng kết". Sau hạn, hệ thống không nhận bài nữa, nên trạng thái
-- suy ra từ `submitted_at` vs `due_at` ĐÃ đứng yên — chụp thêm một bản là tạo ra
-- một bản sao có thể lệch với sổ cái, đúng thứ mà quy tắc "trễ hạn/bỏ bài là SUY
-- RA, không lưu" (mig 177) đã loại bỏ.
--
-- TO REVERSE:
--   DROP INDEX IF EXISTS uq_class_assignment_speaking_topic_per_cohort;
--   ALTER TABLE topic_questions DROP COLUMN audio_url, DROP COLUMN audio_path,
--                               DROP COLUMN level;
--   ALTER TABLE questions       DROP COLUMN audio_url, DROP COLUMN listen_only;
--
-- Idempotent. Apply by hand.
-- ============================================================================

BEGIN;

-- ── 1. Bản đọc đề ──────────────────────────────────────────────────────────
--
-- `audio_path` là đường trong bucket (địa chỉ theo nội dung — cùng chữ + cùng
-- giọng ⇒ cùng đường, nên render lại không đẻ file rác); `audio_url` là URL công
-- khai đã dựng sẵn để trang làm bài không phải tự ghép.
ALTER TABLE topic_questions
    ADD COLUMN IF NOT EXISTS audio_url  TEXT,
    ADD COLUMN IF NOT EXISTS audio_path TEXT;

COMMENT ON COLUMN topic_questions.audio_url IS
'URL công khai bản đọc đề (Kokoro). Part 1/Part 3 giao BẰNG AUDIO và học viên
không được xem chữ, nên câu chưa có audio thì KHÔNG giao được — backend chặn.
Part 2 hiện cue card nên không cần.';

COMMENT ON COLUMN topic_questions.audio_path IS
'Đường trong bucket, địa chỉ theo nội dung (băm chữ + giọng + engine). Render
lại cùng nội dung rơi đúng đường cũ nên không đẻ file mồ côi.';


-- ── 2. Nhãn độ khó ─────────────────────────────────────────────────────────
--
-- `question_type` (opinion / comparison / personal / …) là KIỂU hỏi, không phải
-- độ khó — không thay thế được khi cần một bộ đề trải đều dễ–khó.
ALTER TABLE topic_questions
    ADD COLUMN IF NOT EXISTS level TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'topic_questions_level_check'
    ) THEN
        ALTER TABLE topic_questions
            ADD CONSTRAINT topic_questions_level_check
            CHECK (level IS NULL OR level IN ('easy', 'medium', 'hard'));
    END IF;
END $$;

COMMENT ON COLUMN topic_questions.level IS
'Độ khó: easy | medium | hard. NULL = chưa gắn nhãn. Khác question_type, vốn tả
KIỂU hỏi chứ không phải độ khó.';

CREATE INDEX IF NOT EXISTS idx_topic_questions_part_level
    ON topic_questions (part, level)
    WHERE is_active;


-- ── 3. Không giao trùng đề trong cùng một lớp ──────────────────────────────
--
-- Backend kiểm trước khi ghi, nhưng đó là hai lệnh riêng trên PostgREST: hai tab
-- admin bấm cùng lúc thì cả hai cùng thấy "chưa ai giao" rồi cùng ghi. Chỉ số
-- duy nhất là thứ duy nhất thắng được cuộc đua đó.
--
-- Chỉ áp cho Speaking: Reading/Listening dùng `content_id` trỏ sang bảng đề của
-- chúng, và giao lại một đề đọc cho cùng lớp là chuyện bình thường (luyện lại).
-- Với Speaking, giao trùng nghĩa là học viên nghe lại đúng câu đã trả lời.
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_assignment_speaking_topic_per_cohort
    ON class_assignments (cohort_id, content_id)
    WHERE skill = 'speaking' AND content_id IS NOT NULL;

COMMENT ON INDEX uq_class_assignment_speaking_topic_per_cohort IS
'Một chủ đề Speaking chỉ giao MỘT LẦN cho mỗi lớp. Không lọc theo status: lưu
trữ một bài giao không có nghĩa là học viên chưa từng làm đề ấy — muốn giao lại
thì xoá bài giao cũ, và hàm xoá sẽ từ chối nếu đã có người nộp.';


-- ── 4. Câu hỏi của PHIÊN cũng mang audio, và biết mình bị giấu chữ ─────────
--
-- `questions` là bản chụp cho một phiên luyện. Khi phiên đó là bài tập lớp Part
-- 1/3, câu hỏi được giao BẰNG AUDIO — nên bản chụp phải mang theo cả đường audio
-- lẫn CỜ BÁO rằng chữ không được gửi xuống trình duyệt.
--
-- CỜ NẰM Ở DỮ LIỆU, KHÔNG PHẢI Ở GIAO DIỆN. Ẩn bằng CSS thì mở devtools là đọc
-- được — mà "không được xem câu hỏi" chính là điều kiện làm cho bài nghe này có
-- nghĩa. Endpoint đọc cờ này và LƯỢC BỎ `question_text` trước khi trả về.
ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS audio_url   TEXT,
    ADD COLUMN IF NOT EXISTS listen_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN questions.listen_only IS
'TRUE = câu này giao bằng audio và endpoint PHẢI lược bỏ question_text trước khi
trả về trình duyệt. Ẩn bằng CSS không tính: mở devtools là đọc được, mà việc phải
NGHE mới biết đề hỏi gì chính là thứ bài tập này đang kiểm tra.';

COMMENT ON COLUMN questions.audio_url IS
'Bản đọc đề, chép từ topic_questions lúc dựng phiên. Chép chứ không tham chiếu:
phiên là bản CHỤP, nên sửa kho đề sau đó không được làm đổi bài đang làm dở.';

COMMIT;
