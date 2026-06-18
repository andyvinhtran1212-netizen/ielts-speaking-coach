-- Migration: 106_instructor_role_foundation.sql
-- Mô tả: W-1 (Track A "slim") — đặt NỀN multi-tenancy cho INSTRUCTOR role.
--
-- Đây là migration-ONLY: thêm cột + FK + index + CHECK role + RLS instructor-own.
-- CHƯA có logic route (require_instructor / accessor / route-filter = W-2/W-3/W-4).
--
-- Track A (1 instructor trial tin-cậy). KHÔNG thêm is_suspended / budget /
-- cohorts.term-archived (= Track B / defer). 1 GV/student → students.instructor_id
-- là SOFT-POINTER ĐƠN (không junction). Ownership essay DERIVE qua
-- student/assignment/cohort — KHÔNG thêm cột owner trên essay.
--
-- ADDITIVE THUẦN: 0 data-loss, 0 drop column. Idempotent (IF NOT EXISTS /
-- DROP POLICY IF EXISTS) — chạy lại an toàn.
--
-- ⚠ ÁP DỤNG: Andy chạy TAY trong Supabase SQL editor (KHÔNG auto-apply). Đọc
--   ghi chú "BƯỚC 4" (role CHECK 2 bước) + "PHẦN 5" (RLS) trước khi chạy.
--
-- Rủi ro #1 = cross-tenant leak (instructor A thấy data instructor B). Phòng thủ
-- chính = route-filter (W-3/W-4); RLS ở đây là DEFENSE-IN-DEPTH cho anon-key path.
-- writing endpoints dùng service_role → service_role có BYPASSRLS → API KHÔNG bị
-- ảnh hưởng bởi mọi policy bên dưới. (Frontend không truy vấn trực tiếp bảng nào
-- bằng anon-key — mọi thứ qua API service-role.)


-- ============================================================
-- 1. students.instructor_id — soft single-pointer (1 GV / student)
-- ============================================================
-- ON DELETE SET NULL: xoá user-instructor KHÔNG làm student mồ-côi cứng.
-- Backfill: ĐỂ NULL cho student cũ (KHÔNG gán admin → tránh bẩn metric "học viên
-- của instructor"). Việc gán do route giao-học-viên ở W-2+.
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS instructor_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_instructor_id
    ON students(instructor_id) WHERE instructor_id IS NOT NULL;

COMMENT ON COLUMN students.instructor_id IS
    'W-1 Track A — GV phụ trách (soft single-pointer, 1 GV/student). NULL = chưa gán '
    '(student cũ giữ NULL, KHÔNG gán admin). FK ON DELETE SET NULL.';


-- ============================================================
-- 2. access_codes — provenance phát-hành + role-grant (email-bound promote)
-- ============================================================
--   issued_by      — user đã PHÁT HÀNH mã (admin hoặc instructor). Khác used_by
--                    (người REDEEM). ON DELETE SET NULL.
--   grants_role    — NULL (mã thường) | 'instructor' (mã promote → nâng quyền khi
--                    activate). CHECK gọn dưới (cột mới toàn NULL → validate ngay).
--   intended_email — email ràng buộc cho promote-by-email sau (W-2+). NULL = không ràng.
ALTER TABLE access_codes
    ADD COLUMN IF NOT EXISTS issued_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS grants_role    TEXT,
    ADD COLUMN IF NOT EXISTS intended_email TEXT;

CREATE INDEX IF NOT EXISTS idx_access_codes_issued_by
    ON access_codes(issued_by) WHERE issued_by IS NOT NULL;

-- Cột grants_role mới → mọi row hiện tại = NULL → CHECK pass tức thì (không cần NOT VALID).
ALTER TABLE access_codes
    DROP CONSTRAINT IF EXISTS chk_access_codes_grants_role;
ALTER TABLE access_codes
    ADD CONSTRAINT chk_access_codes_grants_role
        CHECK (grants_role IS NULL OR grants_role IN ('instructor'));

COMMENT ON COLUMN access_codes.issued_by IS
    'W-1 — user phát hành mã (admin/instructor). Khác used_by (người redeem). FK SET NULL.';
COMMENT ON COLUMN access_codes.grants_role IS
    'W-1 — NULL = mã thường; ''instructor'' = mã promote (nâng role khi activate, W-2+).';
COMMENT ON COLUMN access_codes.intended_email IS
    'W-1 — email ràng buộc cho promote-by-email (W-2+). NULL = không ràng buộc.';


-- ============================================================
-- 3. writing_assignments.due_at — hạn nộp tuỳ chọn
-- ============================================================
ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

COMMENT ON COLUMN writing_assignments.due_at IS
    'W-1 — hạn nộp tuỳ chọn (nullable). NULL = không hạn. UI/nhắc-hạn ở W sau.';


-- ============================================================
-- 4. users.role CHECK — gồm 'user' (DB ĐANG có) + set mới. 2 BƯỚC tránh lock + lộ row lỗi.
-- ============================================================
-- App _VALID_ROLES (admin.py:638) = {admin,instructor,student} — THIẾU 'user',
-- nhưng DB nhiều khả năng còn nhiều row role='user'. CHECK phải gồm 'user' để
-- KHÔNG reject row cũ.
--
-- BƯỚC 4a — thêm constraint NOT VALID: KHÔNG quét row cũ, KHÔNG lock dài, KHÔNG
--   reject row hiện tại. Chỉ ép buộc trên INSERT/UPDATE mới kể từ giờ.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE users
    ADD CONSTRAINT chk_users_role
        CHECK (role IN ('user', 'student', 'instructor', 'admin')) NOT VALID;

-- ⚠⚠ TRƯỚC KHI chạy BƯỚC 4b: chạy CHẨN ĐOÁN sau để xem có role lạ không —
--   SELECT role, count(*) FROM users GROUP BY role ORDER BY 2 DESC;
-- Nếu có giá trị NGOÀI ('user','student','instructor','admin') → BƯỚC 4b sẽ FAIL.
-- Khi đó QUYẾT: (a) UPDATE/sửa row lạ về giá trị hợp lệ, hoặc (b) nới CHECK thêm
-- giá trị đó. (Constraint NOT VALID ở 4a VẪN bảo vệ row mới dù 4b chưa chạy.)
--
-- BƯỚC 4b — VALIDATE: quét row cũ (lock SHARE UPDATE EXCLUSIVE — KHÔNG chặn
--   read/write thường). Fail-LOUD nếu có row vi phạm. Chạy SAU khi chẩn đoán sạch.
ALTER TABLE users VALIDATE CONSTRAINT chk_users_role;


-- ============================================================
-- 5. RLS — thêm tier INSTRUCTOR-OWN (giữ nguyên admin-all đã có)
-- ============================================================
-- Mô hình hiện tại = nhị phân admin-all qua is_current_user_admin() (mig 033/035/
-- 036/060). Students/instructors truy cập qua API service-role (service_role
-- BYPASSRLS) → các policy dưới CHỈ ảnh hưởng anon-key path (defense-in-depth).
--
-- W-1 thêm DUY NHẤT tier instructor-own (= phòng thủ multi-tenancy, rủi ro #1).
-- KHÔNG thêm student-self (xem ghi chú "STUDENT-SELF" cuối phần) — chưa có
-- consumer anon-key cho student + không phải rủi ro cross-tenant.
--
-- Predicate instructor-own = <cột-owner> = auth.uid() AND is_current_user_instructor().
-- Cross-tenant chặn ngay ở <cột-owner> = auth.uid() (uid của A ≠ owner của B).

-- Helper: user hiện tại có role 'instructor' không (mirror is_current_user_admin).
CREATE OR REPLACE FUNCTION public.is_current_user_instructor()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()
        AND role = 'instructor'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 5.1 students — owner = instructor_id
DROP POLICY IF EXISTS students_instructor_own ON students;
CREATE POLICY students_instructor_own ON students
    FOR ALL
    USING      (instructor_id = auth.uid() AND public.is_current_user_instructor())
    WITH CHECK (instructor_id = auth.uid() AND public.is_current_user_instructor());

-- 5.2 writing_assignments — owner = assigned_by (đã có sẵn, mig 036)
DROP POLICY IF EXISTS writing_assignments_instructor_own ON writing_assignments;
CREATE POLICY writing_assignments_instructor_own ON writing_assignments
    FOR ALL
    USING      (assigned_by = auth.uid() AND public.is_current_user_instructor())
    WITH CHECK (assigned_by = auth.uid() AND public.is_current_user_instructor());

-- 5.3 writing_prompts — owner = created_by (đã có sẵn, mig 035)
DROP POLICY IF EXISTS writing_prompts_instructor_own ON writing_prompts;
CREATE POLICY writing_prompts_instructor_own ON writing_prompts
    FOR ALL
    USING      (created_by = auth.uid() AND public.is_current_user_instructor())
    WITH CHECK (created_by = auth.uid() AND public.is_current_user_instructor());

-- 5.4 cohorts — owner = created_by (đã có sẵn, mig 060)
DROP POLICY IF EXISTS cohorts_instructor_own ON cohorts;
CREATE POLICY cohorts_instructor_own ON cohorts
    FOR ALL
    USING      (created_by = auth.uid() AND public.is_current_user_instructor())
    WITH CHECK (created_by = auth.uid() AND public.is_current_user_instructor());

-- 5.5 access_codes — owner = issued_by (cột MỚI ở phần 2)
-- ⚠ access_codes là bảng DUY NHẤT trong nhóm CHƯA bật RLS. Bật lần đầu = rủi ro
--   khoá anon-key path. ĐÃ XÁC NHẬN: frontend không truy vấn access_codes trực
--   tiếp bằng anon-key (mọi activation qua API service-role → BYPASSRLS). Vì vậy
--   bật RLS + 2 policy dưới KHÔNG phá luồng hiện tại. (Andy: confirm không có
--   anon-key activation path trước khi apply — reversible: DISABLE ROW LEVEL SECURITY.)
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_codes_admin_all ON access_codes;
CREATE POLICY access_codes_admin_all ON access_codes
    FOR ALL
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS access_codes_instructor_own ON access_codes;
CREATE POLICY access_codes_instructor_own ON access_codes
    FOR ALL
    USING      (issued_by = auth.uid() AND public.is_current_user_instructor())
    WITH CHECK (issued_by = auth.uid() AND public.is_current_user_instructor());

-- STUDENT-SELF (tier 3): CHỦ Ý HOÃN ở W-1.
--   • Hôm nay students truy cập 100% qua API service-role — KHÔNG có path anon-key
--     student trực tiếp lên các bảng này → policy student-self chưa có consumer.
--   • Student-self KHÔNG phải rủi ro cross-tenant (đó là instructor-vs-instructor).
--   • writing_assignments/cohorts owner-student là DERIVED (JOIN students.user_id)
--     → policy phức tạp; thêm khi có path student trực tiếp (W sau).
--
-- ESSAY (writing_essays): RLS instructor-own CHỦ Ý HOÃN → ROUTE-ONLY ở W-4.
--   Ownership essay = DERIVED (essay→student→instructor_id, và qua assignment/
--   cohort) — KHÔNG phải column-owner. Policy JOIN trung thực phải MIRROR logic
--   route (chưa tồn tại tới W-3/W-4) → nhồi bây giờ dễ DRIFT giữa RLS và route, và
--   một JOIN-chỉ-students.instructor_id sẽ THIẾU nhánh assignment/cohort → ảo giác
--   an toàn. writing_essays đã có admin-all RLS + service-role bypass + student
--   không query trực tiếp → không leak anon-key hôm nay. Phòng thủ chính =
--   route-filter W-4 (đúng framing "route-filter mới là chính").


-- ============================================================
-- ROLLBACK (tham khảo — chỉ chạy nếu cần gỡ; thứ tự ngược)
-- ============================================================
-- DROP POLICY IF EXISTS access_codes_instructor_own ON access_codes;
-- DROP POLICY IF EXISTS access_codes_admin_all       ON access_codes;
-- ALTER TABLE access_codes DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS cohorts_instructor_own            ON cohorts;
-- DROP POLICY IF EXISTS writing_prompts_instructor_own    ON writing_prompts;
-- DROP POLICY IF EXISTS writing_assignments_instructor_own ON writing_assignments;
-- DROP POLICY IF EXISTS students_instructor_own           ON students;
-- DROP FUNCTION IF EXISTS public.is_current_user_instructor();
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_role;
-- ALTER TABLE writing_assignments DROP COLUMN IF EXISTS due_at;
-- ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS chk_access_codes_grants_role;
-- ALTER TABLE access_codes DROP COLUMN IF EXISTS intended_email;
-- ALTER TABLE access_codes DROP COLUMN IF EXISTS grants_role;
-- ALTER TABLE access_codes DROP COLUMN IF EXISTS issued_by;       -- index tự rơi theo cột
-- ALTER TABLE students DROP COLUMN IF EXISTS instructor_id;       -- index tự rơi theo cột
