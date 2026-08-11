-- Vá 11 mục bài-theo-buổi đang mang ĐIỂM BÀI VIẾT thay vì KẾT QUẢ TRẮC NGHIỆM.
--
-- Chạy MỘT LẦN, SAU khi bản vá mã đã lên prod (nếu chạy trước, lượt nộp tự luận
-- tiếp theo sẽ ghi đè lại đúng như cũ).
--
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f backend/scripts/repair_course_score_overwritten.sql
--
-- ── VÌ SAO ───────────────────────────────────────────────────────────────────
-- Cột `score` có hai người ghi mang hai nghĩa, và người ghi sau thắng:
--   1. `course_verdict` ghi `score = pct` (tỉ lệ đúng trắc nghiệm); `passed_at`
--      được xét trên CHÍNH con số ấy — nhưng nó không ghi `submitted_at`
--   2. nộp tự luận → `mark_item_submitted` ghi đè `score` bằng độ sạch bài viết
--
-- Kết quả trên prod 07/08: em Dương Dương hiện "10% · đã đạt" (thật 95%), em
-- Hà Linh hiện "0%" (thật 65%) và đọc ra như em ấy làm sai hết bài.
--
-- ── LẤY LẠI TỪ ĐÂU ───────────────────────────────────────────────────────────
-- Từ `mastery->'attempts'`, đúng chỗ `course_verdict` đã ghi và đúng con số
-- `passed_at` được xét trên. KHÔNG tính lại từ `quiz_attempts`: bộ chấm có luật
-- riêng (lượt chính vs kiểm tra lại, lượt làm ĐẦU TIÊN của mỗi câu), và tính
-- lại bằng một câu SQL là dựng một bộ chấm THỨ HAI để nó trôi khỏi bộ thật.
--
-- Luật lấy chép đúng `course_verdict`: score = pct của lượt CUỐI CÙNG được ghi
-- khi `passed_at` còn trống. Chưa đạt ⇒ lượt thêm sau cùng; đã đạt ⇒ lượt cuối
-- cùng có `at` <= `passed_at` (chính lượt làm nên mốc đạt).

\timing on
\set ON_ERROR_STOP on

-- ── TRƯỚC: những dòng sắp đổi ───────────────────────────────────────────────
-- Dùng ĐÚNG phép chọn của lệnh ghi bên dưới. Xem trước bằng một luật khác là
-- một lời hứa mà lệnh ghi không giữ.
\echo '=== TRƯỚC KHI VÁ ==='
WITH luot AS (
    SELECT i.id, i.passed_at, s.full_name, i.score AS dang_hien,
           (i.mastery->>'threshold')::numeric AS nguong,
           (a.value->>'pct')::numeric AS pct, (a.value->>'at') AS at, a.ord
      FROM class_assignment_items i
      JOIN class_assignments c ON c.id = i.assignment_id
      JOIN students s          ON s.id = i.student_id
      CROSS JOIN LATERAL jsonb_array_elements(i.mastery->'attempts')
                         WITH ORDINALITY AS a(value, ord)
     WHERE c.skill = 'course' AND i.artifact_kind = 'course_writing'
)
SELECT DISTINCT ON (id)
       full_name, dang_hien, pct AS diem_dung, nguong,
       (passed_at IS NOT NULL) AS da_dat,
       ((passed_at IS NOT NULL) = (pct >= nguong)) AS khop_voi_ket_luan
  FROM luot
 WHERE passed_at IS NULL OR at::timestamptz <= passed_at
 ORDER BY id, ord DESC;

BEGIN;

-- ── VÁ ──────────────────────────────────────────────────────────────────────
-- Chép ĐÚNG luật của `course_verdict`:
--
--     if not already:          # `already` = passed_at ĐÃ có TRƯỚC lượt này
--         patch["score"] = pct
--
-- Nghĩa là score = pct của lượt CUỐI CÙNG được ghi khi passed_at còn trống:
--   · chưa đạt  → lượt được THÊM SAU CÙNG
--   · đã đạt    → lượt cuối cùng có `at` <= passed_at (chính lượt làm nên mốc đạt)
--
-- Xếp theo THỨ TỰ THÊM (`WITH ORDINALITY`), không theo chuỗi `at`: `at` là chữ
-- trong jsonb, và hai lượt cùng giây sẽ xếp tuỳ tiện. Thứ tự mảng mới là thứ tự
-- bộ chấm đã ghi.
--
-- KHÔNG so với `mastery->>'threshold'` hiện tại: ngưỡng đổi được sau đó, và lấy
-- ngưỡng hôm nay để dựng lại một quyết định của hôm qua là tự tạo ra một kết
-- luận khác. `passed_at` mới là bằng chứng của quyết định ấy.
WITH luot AS (
    SELECT i.id,
           i.passed_at,
           (a.value->>'pct')::numeric AS pct,
           (a.value->>'at')           AS at,
           a.ord
      FROM class_assignment_items i
      JOIN class_assignments c ON c.id = i.assignment_id
      CROSS JOIN LATERAL jsonb_array_elements(i.mastery->'attempts')
                         WITH ORDINALITY AS a(value, ord)
     WHERE c.skill = 'course'
       AND i.artifact_kind = 'course_writing'
), chon AS (
    SELECT DISTINCT ON (id) id, pct AS diem_dung
      FROM luot
     WHERE passed_at IS NULL OR at::timestamptz <= passed_at
     ORDER BY id, ord DESC
)
UPDATE class_assignment_items i
   SET score = chon.diem_dung,
       updated_at = NOW()
  FROM chon
 WHERE i.id = chon.id
   AND chon.diem_dung IS NOT NULL
   AND i.score IS DISTINCT FROM chon.diem_dung;

-- ── CHỐT TRƯỚC KHI CHỐT SỔ ──────────────────────────────────────────────────
-- Không dòng nào được tự mâu thuẫn: "đã đạt" mà điểm dưới ngưỡng, hoặc ngược
-- lại. Kiểm SAU `COMMIT` thì phát hiện sai cũng đã muộn.
DO $$
DECLARE n INT;
BEGIN
    SELECT COUNT(*) INTO n
      FROM class_assignment_items i
      JOIN class_assignments c ON c.id = i.assignment_id
     WHERE c.skill = 'course'
       AND jsonb_array_length(COALESCE(i.mastery->'attempts', '[]'::jsonb)) > 0
       AND (i.passed_at IS NOT NULL) <> (i.score >= (i.mastery->>'threshold')::numeric);
    IF n > 0 THEN
        RAISE EXCEPTION 'còn % dòng tự mâu thuẫn — KHÔNG chốt sổ', n;
    END IF;
END $$;

COMMIT;

-- ── SAU: phải khớp cột "diem_dung" ở bảng trên ──────────────────────────────
\echo '=== SAU KHI VÁ ==='
SELECT s.full_name,
       i.score AS score_moi,
       (i.mastery->>'threshold')::numeric AS nguong,
       i.passed_at IS NOT NULL AS da_dat
  FROM class_assignment_items i
  JOIN class_assignments c ON c.id = i.assignment_id
  JOIN students s          ON s.id = i.student_id
 WHERE c.skill = 'course' AND i.artifact_kind = 'course_writing'
 ORDER BY i.score;

