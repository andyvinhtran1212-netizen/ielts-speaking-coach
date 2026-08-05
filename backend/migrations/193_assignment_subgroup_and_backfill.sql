-- Migration: 193_assignment_subgroup_and_backfill.sql
--
-- Hai việc mà bài giao theo lớp đang thiếu:
--
--   1. GIAO CHO MỘT NHÓM trong lớp, không phải luôn luôn cả lớp.
--   2. BÙ học viên mới vào một bài ĐÃ GIAO. Em vào lớp sau ngày giao thì không
--      có dòng nào trong `class_assignment_items`, nên bài ấy vô hình với em —
--      còn bảng của giáo viên thì đếm em vào mẫu số mà không bao giờ có bài nộp.
--
-- Chạy một lần (SAU mig 192):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/193_assignment_subgroup_and_backfill.sql
--
-- ── VÌ SAO VẪN LÀ MỘT HÀM, KHÔNG PHẢI HAI LỆNH ───────────────────────────────
-- Cùng lý do đã dựng nên mig 179: cha và con là hai request PostgREST riêng thì
-- con hỏng để lại một bài ĐÃ PUBLISH không tới ai — nhìn từ ngoài là một bài 0/N
-- hợp lệ, không có gì đỏ để báo. Giao theo nhóm càng dễ dính: danh sách nhóm là
-- thứ do người dùng chọn nên sai sót ở đó là chuyện thường ngày.
--
-- ── VÌ SAO DROP RỒI TẠO LẠI ──────────────────────────────────────────────────
-- `CREATE OR REPLACE` không đổi được danh sách tham số: thêm một tham số sẽ tạo
-- ra hàm THỨ HAI (nạp chồng) và từ đó mọi lời gọi đều mơ hồ — PostgREST báo
-- "could not choose the best candidate function". DROP đúng chữ ký cũ rồi tạo
-- lại, cả hai trong CÙNG giao dịch để không có khoảnh khắc nào hàm biến mất.

BEGIN;

-- ── Bài giao NHỚ nó được giao cho ai ────────────────────────────────────────
--
-- Không có cột này thì lệnh "bù người nhận" không phân biệt được hai chuyện:
-- bù cho một bài giao CẢ LỚP (thêm em mới vào lớp — đúng ý), và bù cho một bài
-- giao theo NHÓM (thêm cả những em cố ý không được chọn — sai hoàn toàn, và nó
-- lặng lẽ đổi phạm vi chính thức của bài giao). Suy từ "số người nhận ít hơn sĩ
-- số" là đoán, và đoán ấy sai đúng vào lúc cần nhất: khi lớp vừa có em mới.
ALTER TABLE class_assignments
    ADD COLUMN IF NOT EXISTS recipient_scope text NOT NULL DEFAULT 'class'
        CHECK (recipient_scope IN ('class', 'subset'));

COMMENT ON COLUMN class_assignments.recipient_scope IS
'class = giao cả lớp (bù người nhận thêm mọi em đang trong lớp);
subset = giao cho một nhóm (bù phải nêu ĐÍCH DANH, mig 193).';

-- Bỏ chữ ký CŨ (12 tham số, từ mig 184).
DROP FUNCTION IF EXISTS fn_create_class_assignment(
    uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text);

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
    p_kind           text        DEFAULT 'daily',
    -- NULL = CẢ LỚP. Mọi lời gọi cũ không truyền tham số này nên giữ nguyên
    -- hành vi, không phải sửa một dòng nào.
    p_student_ids    uuid[]      DEFAULT NULL
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
    -- MỘT ảnh chụp sĩ số nuôi cả phần đếm lẫn phần nở ra.
    --
    -- Đếm rồi chèn thành hai lệnh là không an toàn kể cả bên trong một hàm: dưới
    -- READ COMMITTED mỗi lệnh lấy một ảnh chụp mới, nên một thay đổi sĩ số song
    -- song có thể vô hình với lệnh đếm mà hữu hình với lệnh chèn (hoặc ngược
    -- lại). FOR UPDATE nằm trong truy vấn con vì hàm gộp không đi cùng khoá dòng
    -- được; nó giữ sĩ số đứng yên cho hết giao dịch.
    --
    -- LỌC THEO NHÓM nằm NGAY TRONG ảnh chụp ấy, không phải một phép lọc sau:
    -- lọc sau là mở lại đúng khe hở mà FOR UPDATE vừa đóng. Và giao đúng lớp
    -- được lọc bằng `cohort_id` chứ không tin danh sách gửi lên — một id học
    -- viên lớp khác lọt vào sẽ bị bỏ ở đây, chứ không thành một bài giao xuyên
    -- lớp.
    SELECT array_agg(t.id), count(*), count(*) FILTER (WHERE t.user_id IS NULL)
      INTO v_ids, v_total, v_unactive
      FROM (
        SELECT id, user_id FROM students
         WHERE cohort_id = p_cohort_id
           AND (p_student_ids IS NULL OR id = ANY(p_student_ids))
         FOR UPDATE
      ) t;

    IF v_total = 0 THEN
        -- Nhóm rỗng cũng là lớp rỗng theo đúng nghĩa "không có ai để nhận bài".
        -- Dùng lại đúng mã lỗi để tầng ứng dụng không phải học thêm một nhánh.
        RAISE EXCEPTION 'empty_roster'
            USING HINT = 'Không có học viên nào nhận bài này.';
    END IF;

    INSERT INTO class_assignments (
        cohort_id, lesson_id, skill, content_id, content_config,
        title, instructions, due_at, publish_at, status, assigned_by, kind,
        recipient_scope
    ) VALUES (
        p_cohort_id, p_lesson_id, p_skill, p_content_id, COALESCE(p_content_config, '{}'::jsonb),
        p_title, p_instructions, p_due_at, p_publish_at, COALESCE(p_status, 'published'),
        p_assigned_by, COALESCE(p_kind, 'daily'),
        -- Ghi phạm vi NGAY LÚC TẠO, trong cùng giao dịch. Một UPDATE sau sẽ để
        -- lại một bài giao-theo-nhóm mang nhãn "cả lớp" nếu lệnh thứ hai hỏng,
        -- và từ đó lệnh bù sẽ mở rộng nó ra cả lớp mà không ai biết.
        CASE WHEN p_student_ids IS NULL THEN 'class' ELSE 'subset' END
    )
    RETURNING * INTO v_row;

    v_id := v_row.id;

    INSERT INTO class_assignment_items (assignment_id, student_id)
    SELECT v_id, unnest(v_ids);

    assignment        := to_jsonb(v_row);
    student_count     := v_total;
    unactivated_count := v_unactive;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_create_class_assignment IS
'Tạo bài giao + nở ra người nhận trong MỘT giao dịch (mig 179; p_kind ở 184;
p_student_ids ở 193). `p_student_ids` NULL = cả lớp. Danh sách gửi lên luôn được
giao với `cohort_id`, nên một id lớp khác lọt vào sẽ bị bỏ chứ không tạo ra bài
giao xuyên lớp. Không ai nhận thì raise empty_roster.';

-- ── Bù học viên mới vào bài ĐÃ GIAO ─────────────────────────────────────────
--
-- Chỉ THÊM dòng còn thiếu. Không bao giờ xoá: một em đã rời lớp mà đã nộp bài
-- thì bài ấy là chuyện đã xảy ra, xoá đi là làm sổ nói dối.
CREATE OR REPLACE FUNCTION fn_backfill_assignment_items(
    p_assignment_id uuid,
    -- NULL = mọi học viên đang trong lớp mà chưa có dòng.
    p_student_ids   uuid[] DEFAULT NULL
)
RETURNS TABLE (
    added         integer,
    student_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cohort uuid;
    v_scope  text;
    v_added  integer;
    v_total  integer;
BEGIN
    SELECT cohort_id, recipient_scope INTO v_cohort, v_scope
      FROM class_assignments WHERE id = p_assignment_id
       FOR UPDATE;

    IF v_cohort IS NULL THEN
        RAISE EXCEPTION 'assignment_not_found'
            USING HINT = 'Không tìm thấy bài giao này.';
    END IF;

    -- Bài giao theo NHÓM phải nêu ĐÍCH DANH. "Bù cả lớp" ở đây là thêm đúng
    -- những em cố ý không được chọn, và nó đổi phạm vi chính thức của bài giao
    -- mà không có gì đỏ để báo (codex PR 945).
    IF v_scope = 'subset' AND p_student_ids IS NULL THEN
        RAISE EXCEPTION 'subset_needs_explicit_students'
            USING HINT = 'Bài này giao cho một nhóm — hãy chọn đích danh học viên cần thêm.';
    END IF;

    -- `NOT EXISTS` chứ không `ON CONFLICT`: bảng không có ràng buộc duy nhất
    -- trên (assignment_id, student_id), nên `ON CONFLICT` sẽ đổ chứ không bỏ
    -- qua. Cách này cũng khiến lệnh chạy lại được bao nhiêu lần cũng vô hại.
    WITH ins AS (
        INSERT INTO class_assignment_items (assignment_id, student_id)
        SELECT p_assignment_id, s.id
          FROM students s
         WHERE s.cohort_id = v_cohort
           AND (p_student_ids IS NULL OR s.id = ANY(p_student_ids))
           AND NOT EXISTS (
               SELECT 1 FROM class_assignment_items i
                WHERE i.assignment_id = p_assignment_id
                  AND i.student_id = s.id)
        RETURNING 1
    )
    SELECT count(*) INTO v_added FROM ins;

    SELECT count(*) INTO v_total
      FROM class_assignment_items WHERE assignment_id = p_assignment_id;

    added         := v_added;
    student_count := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_backfill_assignment_items IS
'Thêm dòng người-nhận còn thiếu cho một bài ĐÃ GIAO (mig 193). Em vào lớp sau
ngày giao vốn không có dòng nào nên bài ấy vô hình với em. Chỉ THÊM, không bao
giờ xoá: bài đã nộp là chuyện đã xảy ra. Chạy lại bao nhiêu lần cũng vô hại.';

-- ── Quyền gọi: BACKEND-ONLY ─────────────────────────────────────────────────
-- PostgreSQL cấp EXECUTE cho PUBLIC trên MỌI hàm mới, và Supabase phơi mọi hàm
-- trong `public` ra PostgREST cho anon/authenticated. DROP xoá sạch phân quyền
-- cũ, nên không cấp lại là mở đúng lỗ mà mig 179 đã bịt: một học viên đăng nhập
-- biết cohort_id sẽ tự giao bài cho cả lớp.
REVOKE EXECUTE ON FUNCTION public.fn_create_class_assignment(
    uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text, uuid[])
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_create_class_assignment(
    uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text, uuid[])
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_backfill_assignment_items(uuid, uuid[])
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_backfill_assignment_items(uuid, uuid[])
    TO service_role;

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT column_name, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'class_assignments' AND column_name = 'recipient_scope';
-- Kỳ vọng: recipient_scope | 'class'::text | NO
--
-- SELECT proname, count(*) AS so_ban
--   FROM pg_proc
--  WHERE proname IN ('fn_create_class_assignment', 'fn_backfill_assignment_items')
--  GROUP BY proname;
-- Kỳ vọng: mỗi hàm ĐÚNG 1 bản (không bị nạp chồng).
--
-- SELECT p.proname,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_goi_duoc,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS hv_goi_duoc,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS backend_goi_duoc
--   FROM pg_proc p
--  WHERE p.proname IN ('fn_create_class_assignment', 'fn_backfill_assignment_items');
-- Kỳ vọng: cả hai dòng = f | f | t
--
-- Rollback: chạy lại mig 184 (dựng lại chữ ký 12 tham số) và
--   DROP FUNCTION IF EXISTS fn_backfill_assignment_items(uuid, uuid[]);
