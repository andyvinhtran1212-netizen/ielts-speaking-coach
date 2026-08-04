-- Migration: 185_speaking_progress_marks.sql
-- GĐ F — sổ tiến bộ BỀN cho Speaking: giữ lại phần CHẨN ĐOÁN sau khi bản gốc bị dọn.
--
-- Chạy một lần:
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/185_speaking_progress_marks.sql
--
-- ── VẤN ĐỀ ĐANG CÓ ───────────────────────────────────────────────────────────
-- `jobs/retention_sweep.py` dọn `transcript`, `feedback`, `pronunciation_payload`
-- ở mốc 60 ngày và audio ở mốc 15 ngày. Cột ĐIỂM thì không bao giờ bị đụng.
--
-- Nên sau 60 ngày, thứ còn lại về một học viên là MỘT CON SỐ. Thấy được em ấy
-- tụt từ 5.5 xuống 5.0, nhưng không còn cách nào biết VÌ SAO — âm nào em phát
-- sai, lỗi ngữ pháp nào lặp lại, nói nhanh hay chậm. Đó đúng là những thứ cần để
-- hỗ trợ đúng chỗ.
--
-- ── CHƯA MẤT GÌ CẢ, NHƯNG SẼ MẤT ─────────────────────────────────────────────
-- Đo trên prod 04/08/2026: 0/5.514 phiên đã bị dọn, trong khi 5.087 phiên đã quá
-- mốc 15 ngày. `RETENTION_SWEEP_DRY_RUN` mặc định `true` và trong repo không có
-- cấu hình cron nào gọi job ấy.
--
-- Nghĩa là toàn bộ lịch sử vẫn còn, và một lần chạy bù NGAY BÂY GIỜ giữ được nó.
-- Bật cơ chế dọn trước khi có bảng này là vứt đi thứ không lấy lại được.
--
-- ── VÌ SAO LÀ BẢNG RIÊNG, KHÔNG PHẢI CỘT TRÊN `responses` ────────────────────
-- Vì `responses` chính là thứ bị dọn. Một cột thêm vào đó sẽ hoặc bị dọn cùng,
-- hoặc trở thành ngoại lệ mà người viết job dọn sau này không biết để chừa ra.
-- Bảng riêng khiến luật "cái này KHÔNG dọn" đọc được từ cấu tạo.
--
-- ── NHỎ LÀ CHỦ ĐÍCH ──────────────────────────────────────────────────────────
-- `pronunciation_payload` đang chiếm 23 MB cho 4.696 bài (~5 KB/bài). Một dòng ở
-- đây vài trăm byte. Giữ được hàng chục nghìn bài trong cùng chỗ mà một mẻ
-- payload chiếm — nên không có mâu thuẫn nào với mục tiêu làm nhẹ bộ nhớ.
--
-- Idempotent: IF NOT EXISTS ở mọi lệnh.

BEGIN;

CREATE TABLE IF NOT EXISTS speaking_progress_marks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- MỘT dòng cho MỘT câu trả lời. Chấm lại một câu thì ghi đè dòng cũ, không
  -- thêm dòng thứ hai — hai dấu mốc cho cùng một câu sẽ làm mọi phép đếm sai.
  response_id   UUID NOT NULL UNIQUE REFERENCES responses(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL,
  user_id       UUID,

  -- Bài tập lớp nào sinh ra câu này. NULL = luyện tự do. Cho phép hỏi "em ấy
  -- tiến bộ thế nào TRONG bài giao của lớp" tách khỏi tự luyện.
  class_assignment_item_id UUID,

  recorded_at   TIMESTAMPTZ NOT NULL,
  part          INT,

  -- Điểm: chép lại chứ không tham chiếu. `responses` sống lâu hơn, nhưng đọc
  -- điểm qua JOIN nghĩa là mọi biểu đồ tiến bộ phụ thuộc vào một bảng đang bị
  -- dọn dần — và một ngày nào đó ai đó sẽ đổi luật dọn.
  band          NUMERIC(3,1),
  band_p        NUMERIC(3,1),

  duration_seconds  REAL,
  -- Tốc độ nói. Tính TỪ bản chép lúc bản chép còn tồn tại: sau mốc 60 ngày thì
  -- không còn cách nào tính lại. Đây là một chỉ dấu trôi chảy mà điểm band gộp
  -- lại không cho thấy.
  words_per_minute  REAL,

  -- Âm vị yếu nhất và từ phát âm sai — rút từ `pronunciation_payload` TRƯỚC khi
  -- nó bị dọn. Chỉ giữ vài cái đầu: mục đích là thấy được cái LẶP LẠI qua nhiều
  -- bài, không phải dựng lại toàn bộ bản đánh giá.
  weak_phonemes       TEXT[],
  mispronounced_words TEXT[],

  -- Nhãn lỗi ngữ pháp lặp lại, từ `grammar_recommendations`.
  grammar_tags        TEXT[],

  score_confidence  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Đường đọc chính: "cho tôi lịch sử của em này, cũ → mới".
CREATE INDEX IF NOT EXISTS idx_spm_user_time
  ON speaking_progress_marks (user_id, recorded_at DESC);

-- Đường đọc thứ hai: "trong bài giao này, ai thế nào".
CREATE INDEX IF NOT EXISTS idx_spm_class_item
  ON speaking_progress_marks (class_assignment_item_id)
  WHERE class_assignment_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spm_session
  ON speaking_progress_marks (session_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Bảng này mô tả điểm yếu của từng học viên — đúng loại dữ liệu không được để
-- client đọc chéo nhau. Học viên xem tiến bộ của mình qua endpoint service-role
-- đã lọc theo chính họ; admin qua endpoint admin.
ALTER TABLE speaking_progress_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spm_admin_all ON speaking_progress_marks;
CREATE POLICY spm_admin_all ON speaking_progress_marks
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

COMMENT ON TABLE speaking_progress_marks IS
'Dấu mốc tiến bộ Speaking (mig 185): bản tóm NHỎ và BỀN của mỗi câu trả lời,
rút ra lúc chấm. jobs/retention_sweep.py KHÔNG bao giờ đụng bảng này — đó là
toàn bộ lý do nó tồn tại. Sau khi transcript/feedback/pronunciation_payload bị
dọn ở mốc 60 ngày, đây là thứ duy nhất còn trả lời được câu "em ấy yếu ở đâu và
có đang khá lên không".';

COMMENT ON COLUMN speaking_progress_marks.words_per_minute IS
'Tính từ bản chép LÚC CHẤM. Sau mốc 60 ngày bản chép bị dọn nên không tính lại
được — chạy bù chỉ làm được khi dữ liệu gốc còn.';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT to_regclass('speaking_progress_marks') IS NOT NULL AS co_bang,
--        (SELECT relrowsecurity FROM pg_class WHERE relname='speaking_progress_marks') AS rls_bat;

-- ── Lệnh lùi ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS speaking_progress_marks;
