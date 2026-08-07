-- Migration: 197_rls_explicit_on_public_tables.sql
--
-- GHI LẠI MỘT LỚP BẢO VỆ ĐANG CHẠY MÀ KHÔNG CÓ TRONG REPO.
--
-- Đo ngày 2026-08-07 trên production: 89/89 bảng `public` đều có
-- `relrowsecurity = true` (63 bảng kèm policy, 26 bảng KHÔNG policy — tức chặn
-- sạch, chỉ `service_role` đọc được). Staging cũng vậy. Không bảng nào hở.
--
-- VẤN ĐỀ: KHÔNG một migration nào bật nó. Trạng thái đó được đặt bằng tay ngoài
-- luồng, nên:
--   · đọc repo sẽ kết luận NGƯỢC LẠI — migration 086 còn ghi thẳng rằng bảng nội
--     dung là "RLS-free" (đã sửa chú thích đó trong cùng PR này);
--   · dựng một môi trường MỚI từ migration sẽ ra CSDL mở toang, và không ai đọc
--     mã mà biết được.
-- Chuyện này suýt dẫn tới một kết luận sai trong lượt rà rò rỉ đáp án Reading:
-- cả tôi lẫn bộ review đều đọc mã rồi tin rằng bảng nội dung đọc được bằng khoá
-- anon. Phải mất bốn lượt đo qua PostgREST + một truy vấn `pg_class` mới ra sự
-- thật.
--
-- MIGRATION NÀY KHÔNG ĐỔI GÌ TRÊN PROD/STAGING (vòng lặp tìm 0 bảng). Nó chỉ tồn
-- tại để môi trường thứ ba không hở.
--
-- KHÔNG tạo policy nào. Bật RLS mà không policy = chặn mọi vai thường, còn
-- `service_role` (backend dùng) bỏ qua RLS — đúng trạng thái hiện tại. Bảng nào
-- cần cho trình duyệt đọc thẳng thì thêm policy RIÊNG ở migration của nó.
--
-- Kiểm lại bất cứ lúc nào:
--   psql "$DATABASE_URL" -c "select relname, relrowsecurity,
--     (select count(*) from pg_policy p where p.polrelid=c.oid)
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--     where n.nspname='public' and c.relkind in ('r','p') and not relrowsecurity;"
--   -- ra 0 dòng = mọi bảng đều được bật.
--
-- Idempotent. Forward-only.

DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      -- 'r' bảng thường VÀ 'p' bảng phân mảnh CHA. Bật RLS cho mảnh con không
      -- che được truy vấn đi qua bảng cha, nên thiếu 'p' là để hở đúng đường mà
      -- người ta thật sự query (codex cục bộ #978).
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
    RAISE NOTICE 'RLS đã bật cho %', t.rel;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'Mọi bảng public đã bật RLS sẵn — migration không đổi gì (đúng như mong đợi trên prod/staging).';
  ELSE
    RAISE NOTICE 'Đã bật RLS cho % bảng.', n;
  END IF;
END $$;
