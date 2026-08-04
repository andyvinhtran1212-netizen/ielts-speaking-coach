-- Migration: 184_fn_create_assignment_kind.sql
-- GĐ C — bài giao biết mình thuộc LOẠI nào, ngay từ lúc được tạo.
--
-- Chạy một lần (SAU mig 183):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/184_fn_create_assignment_kind.sql
--
-- ── VÌ SAO PHẢI SỬA HÀM, KHÔNG UPDATE SAU ────────────────────────────────────
-- Mig 183 thêm `class_assignments.kind` với mặc định 'daily'. Cách rẻ là gọi RPC
-- rồi UPDATE loại lại — nhưng đó đúng là thứ mig 179 đã bỏ đi: hai lệnh riêng
-- thì lệnh thứ hai hỏng để lại một bài giao ĐÃ PUBLISH mang sai loại. Nhìn từ
-- ngoài nó là một bài hằng ngày hợp lệ, nên không có gì đỏ để báo; chỉ có phiếu
-- làm bài dựng sai số ô và bảng tổng kết đếm sai hạn.
--
-- ── VÌ SAO DROP RỒI TẠO LẠI ──────────────────────────────────────────────────
-- `CREATE OR REPLACE FUNCTION` KHÔNG đổi được danh sách tham số: thêm một tham
-- số sẽ tạo ra hàm THỨ HAI (nạp chồng), và từ đó mọi lời gọi đều mơ hồ —
-- PostgREST sẽ báo "could not choose the best candidate function". Nên phải DROP
-- đúng chữ ký cũ rồi tạo lại, cả hai trong CÙNG một giao dịch để không có khoảnh
-- khắc nào hàm biến mất khỏi hệ thống đang chạy.
--
-- Thân hàm chép nguyên từ mig 179 — chỉ thêm `p_kind`. Chép chứ không gọi lại là
-- cố ý: một hàm bọc ngoài sẽ làm định nghĩa thật nằm ở hai nơi.
--
-- ── QUYỀN GỌI PHẢI CẤP LẠI ───────────────────────────────────────────────────
-- PostgreSQL cấp EXECUTE cho PUBLIC trên MỌI hàm mới, và Supabase phơi mọi hàm
-- trong `public` ra PostgREST cho `anon`/`authenticated`. DROP xoá sạch phân
-- quyền cũ, nên KHÔNG cấp lại ở đây nghĩa là mở lại đúng lỗ mà mig 179 đã bịt:
-- một học viên đăng nhập biết cohort_id sẽ tự giao bài cho cả lớp.

BEGIN;

-- Bỏ chữ ký CŨ (11 tham số). `IF EXISTS` để lần chạy thứ hai không đổ ở đây.
DROP FUNCTION IF EXISTS fn_create_class_assignment(
    uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid);

-- Rồi tạo chữ ký MỚI bằng `OR REPLACE`, không phải `CREATE` trần.
--
-- Trần thì lần chạy thứ hai đổ: chữ ký cũ đã biến mất nên DROP ở trên thành
-- vô hiệu, còn chữ ký mới thì đã tồn tại. Migration này phải chạy lại được —
-- nó bị chạy tay trên prod, và một lần retry sau lỗi mạng không được biến thành
-- một giao dịch abort.
--
-- `OR REPLACE` an toàn ở đây vì DROP phía trên đã dọn đúng chữ ký cũ, nên không
-- có cách nào còn lại hai bản nạp chồng.
CREATE OR REPLACE FUNCTION fn_create_class_assignment(
    p_cohort_id      uuid,
    p_skill          text,
    p_title          text,
    p_lesson_id      uuid        DEFAULT NULL,
    p_content_config jsonb       DEFAULT '{}'::jsonb,
    p_content_id     uuid        DEFAULT NULL,
    p_instructions   text        DEFAULT NULL,
    p_due_at         timestamptz DEFAULT NULL,
    p_publish_at     timestamptz DEFAULT NULL,
    p_status         text        DEFAULT 'published',
    p_assigned_by    uuid        DEFAULT NULL,
    -- Mặc định 'daily' để mọi lời gọi CŨ giữ nguyên hành vi: đường giao bài hằng
    -- ngày không phải sửa một dòng nào.
    p_kind           text        DEFAULT 'daily'
)
RETURNS TABLE (
    assignment        jsonb,
    student_count     integer,
    unactivated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id        uuid;
    v_ids       uuid[];
    v_total     integer;
    v_unactive  integer;
    v_row       class_assignments%ROWTYPE;
BEGIN
    -- ONE snapshot of the roster drives both the counts and the fan-out.
    --
    -- Counting and then inserting as two statements is not safe even inside a
    -- function: under READ COMMITTED each statement takes a fresh snapshot, so a
    -- concurrent roster change can be invisible to the count and visible to the
    -- INSERT (or the reverse). That returns a student_count that does not match
    -- the rows created, and removing the last student in between could still
    -- leave the zero-recipient give this function exists to prevent.
    --
    -- FOR UPDATE lives in the subquery because an aggregate cannot be combined
    -- with a row lock directly; it holds the roster still for the rest of the
    -- transaction.
    SELECT array_agg(t.id), count(*), count(*) FILTER (WHERE t.user_id IS NULL)
      INTO v_ids, v_total, v_unactive
      FROM (
        SELECT id, user_id FROM students WHERE cohort_id = p_cohort_id FOR UPDATE
      ) t;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'empty_roster'
            USING HINT = 'Lớp này chưa có học viên nào để giao bài.';
    END IF;

    INSERT INTO class_assignments (
        cohort_id, lesson_id, skill, content_id, content_config,
        title, instructions, due_at, publish_at, status, assigned_by, kind
    ) VALUES (
        p_cohort_id, p_lesson_id, p_skill, p_content_id, COALESCE(p_content_config, '{}'::jsonb),
        p_title, p_instructions, p_due_at, p_publish_at, COALESCE(p_status, 'published'),
        p_assigned_by, COALESCE(p_kind, 'daily')
    )
    RETURNING * INTO v_row;

    v_id := v_row.id;

    -- From the SAME snapshot, so the rows created and the counts returned always
    -- describe exactly the same students. Set-based: no page loop that could
    -- stop halfway, and no PostgREST row cap to trip over.
    INSERT INTO class_assignment_items (assignment_id, student_id)
    SELECT v_id, unnest(v_ids);

    assignment        := to_jsonb(v_row);
    student_count     := v_total;
    unactivated_count := v_unactive;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_create_class_assignment IS
'Tạo bài giao + nở ra toàn bộ sĩ số trong MỘT giao dịch (mig 179, thêm p_kind ở
mig 184). Trước đó cha và con là hai request PostgREST riêng: con hỏng thì còn
lại một bài đã publish mà không tới ai, nhìn như bài 0/N thật. Lớp rỗng thì raise
empty_roster. `p_kind` nằm TRONG hàm chứ không phải một UPDATE sau, vì cùng lý
do: một bài đã publish mang sai loại không có gì đỏ để báo.';

-- ── Quyền gọi: BACKEND-ONLY (cấp lại sau DROP) ──────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_create_class_assignment(
    uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_create_class_assignment(
    uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text)
    TO service_role;

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT count(*) AS so_ban_ham            -- phải = 1 (không bị nạp chồng)
--   FROM pg_proc WHERE proname = 'fn_create_class_assignment';
-- SELECT has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_goi_duoc,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS hv_goi_duoc,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS backend_goi_duoc
--   FROM pg_proc p WHERE p.proname = 'fn_create_class_assignment';
-- Kỳ vọng: 1 | f | f | t
