# Research record — STUDENTARCHIVE-0029 (Vietnamese, as approved)

> Approved by Vinh 2026-10-27 07:14 UTC+7. This is the reviewed Vietnamese
> draft, kept verbatim as the evidence record (file:line citations against
> `origin/staging@3aded02b`, read-only staging catalog/data queries on
> 2026-10-27). The canonical contract is `spec.md`; the locked migration
> number is **326**. Production was never queried: every production query
> below stays **chờ anh Vinh cho phép chạy chỉ đọc**.


# DELETE /admin/students/{id} — từ xoá cứng sang lưu trữ

> Hồ sơ nghiên cứu (bản nháp gốc đã được duyệt) gộp spec/plan/tasks/verification/rollout. Staging `zjphffoujxkpltixsbzj`
> chỉ SELECT/catalog; **production không được truy vấn; không chạy SQL ghi/DDL.**

## 1. Problem

- `backend/routers/admin_students.py:129–135` `delete_student`: "Hard delete (W2
  scope). Soft delete deferred to W3." → `student_service.delete_student`
  (`backend/services/student_service.py:306–319`) chạy
  `supabase_admin.table("students").delete().eq("id", …)` (service_role).
  Docstring đầu file `admin_students.py:1–8` xác nhận soft delete bị hoãn.
- Một lệnh này xoá dây chuyền (FK live staging):

| Bảng con | FK | ON DELETE |
| --- | --- | --- |
| `writing_assignments.student_id` | → students | CASCADE |
| `writing_drafts.student_id` (và qua `assignment_id`) | → students / writing_assignments | CASCADE |
| `writing_essays.student_id` | → students | CASCADE |
| ↳ `writing_feedback`, `writing_grade_ratings`, `writing_jobs`, `instructor_reviews`, `essay_regrade_requests` (`essay_id`) | → writing_essays | CASCADE |
| `essay_regrade_requests.student_id` | → students | CASCADE |
| `class_assignment_items.student_id` | → students | CASCADE |
| ↳ `course_writing_drafts`, `advanced_vocab_*` (5 bảng), `grammar_lesson_attempts` | → class_assignment_items | CASCADE |
| ↳ `sessions`, `listening/reading_test_attempts`, `quiz_sessions`, `course_{writing,section,pronunciation}_submissions` | → class_assignment_items | SET NULL (mất liên kết bài giao) |
| ↳ `grammar_diagnostic_sessions` | → class_assignment_items | **RESTRICT** (làm lệnh xoá fail 500) |
| ↳ trigger `trg_protect_advanced_vocab_item_evidence` BEFORE DELETE | class_assignment_items | chặn khi có bằng chứng Advanced Vocab (fail 500) |
| `student_cohort_memberships.student_id` | → students | CASCADE |

  ⇒ Mất toàn bộ bài viết, chấm điểm, nháp, lịch sử lớp; không audit; không khôi
  phục được; có lúc lại fail 500 giữa chừng do RESTRICT/trigger (trong một câu
  lệnh nên không xoá nửa vời, nhưng admin không hiểu lý do).
- Không xoá Supabase auth user hay `public.users` (`students.user_id → users
  ON DELETE SET NULL` là chiều ngược lại; không có code nào gọi
  `auth.admin.delete_user` ngoài `backend/scripts/staging_seed.py:175`).
- UI: Next `frontend/app/(authed-admin-students)/admin/students/admin-students-directory.tsx`
  **không** có nút xoá (chỉ PATCH, dòng 197). Nút xoá cũ ở
  `frontend/public/js/admin-students-panel.js:305–313` (confirm "Tất cả essays
  của học viên này cũng sẽ bị xóa") — không tìm thấy HTML nào còn nạp file này
  (`/pages/admin/students/` không tồn tại; chỉ test tham chiếu). ⇒ Hiện gọi qua
  API được, UI chính không có.

### Staging (đã chạy, chỉ đọc)

students **9** (8 đã liên kết user); writing_assignments 22; writing_drafts 4;
writing_essays 10 (4 học viên có essay); writing_feedback 16;
essay_regrade_requests 0; class_assignment_items 3; grammar_diagnostic_sessions
gắn item 0; student_cohort_memberships 5 (5 active). Cột lưu trữ trên `students`
(archived_at/deleted_at/…): **chưa có**; bảng audit đề xuất: chưa có.

### Schema `students` live (staging)

Cột: `id, student_code (UNIQUE students_student_code_key), full_name, target_band,
target_date, persona_notes, current_band_estimate, cohort_id, created_by,
instructor_id, user_id, is_under_review, flag_count, last_flagged_at,
created_at, updated_at`. FK ra: `cohort_id → cohorts SET NULL`, `created_by →
users`, `instructor_id → users SET NULL`, `user_id → users SET NULL`. Index:
`idx_students_{code,cohort_id,created_by,instructor_id,under_review,user_id}`.
Triggers: `trg_sync_legacy_student_cohort_membership` (AFTER INSERT/UPDATE OF
cohort_id), `update_students_updated_at`. RLS policies: `students_admin_all`,
`students_instructor_own` (106), `students_self_read`. Grants: anon/authenticated
SELECT; service_role đủ. Policies bảng khác tham chiếu `students`:
`essay_regrade_requests` (2), `writing_assignments_student_read`,
`writing_drafts_student_own`, `writing_essays_student_read`,
`writing_feedback_student_read`. 15 hàm public đọc `students` (vd.
`fn_create_class_assignment(…, uuid[])`, `fn_add_student(s)_cohort_membership`,
`fn_remove_student_cohort_membership`, `fn_admin_writing_queue_page`,
`fn_bind_session_to_class_item`, `create_assigned_grammar_*`,
`quiz_start_timed_course_session`, `fn_vocabulary_set_visible`, …).

## 2. Phương án

| | A. Lưu trữ hồ sơ học viên (`students.archived_at`) + kết thúc lớp + audit (**đề xuất**) | B. Khoá tài khoản (`users.is_active=false` / ban auth user) | C. Soft-delete toàn hệ (`deleted_at` + lọc mọi nơi) | D. Giữ xoá cứng, thêm xác nhận |
| --- | --- | --- | --- | --- |
| Giữ bài làm/điểm | Có | Có | Có | Không |
| Phạm vi | Hồ sơ Writing/lớp; tài khoản app (Speaking…) tuỳ chọn | Toàn bộ tài khoản | Toàn bộ | — |
| Đổi code đọc | Vừa (ít nơi, vì kết thúc membership cắt fan-out lớp) | Ít, nhưng `/auth/activate` có thể bật lại `is_active` | Rất lớn (mọi truy vấn + 15 hàm + 6 policy) | Ít |
| Khôi phục | Có (restore) | Có | Có | Không |
| GDPR xoá thật | Thao tác riêng, chỉ trên hồ sơ đã lưu trữ | — | — | Có nhưng không kiểm soát |

Vì sao không chỉ B: `students` là hồ sơ lớp/Writing, khác tài khoản `users` (một
user có thể dùng Speaking bằng mã riêng). Khoá tài khoản là quyết định riêng;
hơn nữa `/auth/activate` đặt `is_active=True` khi kích hoạt mã mới
(`backend/routers/auth.py:495–508`), nên khoá tài khoản đơn thuần có thể bị mã
mới mở lại. A đưa khoá tài khoản thành **tuỳ chọn** trong cùng giao dịch và chặn
kích hoạt cho hồ sơ đã lưu trữ.

Vì sao không C: phải sửa ~60 lời gọi `table("students")` trong backend (vd.
`services/student_service.py` 7, `services/essay_service.py` 7, `routers/auth.py` 6,
`services/class_membership_service.py` 4, `routers/instructor.py` 4,
`routers/admin.py` 4, …) + 15 hàm SQL + 6 policy; sót một chỗ là rò rỉ.

**Chọn A.** Lưu trữ = (1) đóng mọi membership lớp đang active (cùng cơ chế
`fn_remove_student_cohort_membership`, `227_student_cohort_memberships.sql:167–199`,
bản live đã kiểm khớp `SET is_active = false, left_at = now()`), nên mọi fan-out
lớp (đọc roster active) tự động không tới học viên này mà không phải sửa 15 hàm;
(2) đánh dấu `archived_at/by/reason`; (3) tuỳ chọn khoá tài khoản; (4) ghi audit
bất biến. Mọi dữ liệu bài làm giữ nguyên. Xoá thật (GDPR) là thao tác admin
riêng, giai đoạn 2.

## 3. Requirements

- **FR-001:** `DELETE /admin/students/{id}` không còn xoá dòng nào; nó lưu trữ
  học viên (204), idempotent; ghi audit (actor, lý do, lớp đã rời).
- **FR-002:** Học viên đã lưu trữ không xuất hiện ở danh sách mặc định
  (`GET /admin/students`, `GET /instructor/students`), không nhận bài giao lớp
  mới, không được giao bài Writing cá nhân mới, không đăng nhập được khu Writing/lớp
  (403 "chưa liên kết"/"đã lưu trữ"), không tự kích hoạt lại qua mã.
- **FR-003:** Admin xem được học viên đã lưu trữ (`?include_archived=true`),
  xem lịch sử, và khôi phục (`POST /admin/students/{id}/restore`) — lớp cũ được
  trả lại theo audit.
- **FR-004:** Tuỳ chọn `deactivate_account=true` đặt `users.is_active=false` cho
  user liên kết; client không thể tự bật lại (trigger 320 + không có UPDATE grant).
- **FR-005:** Không bảng dữ liệu bài làm nào bị xoá/sửa khi lưu trữ.
- **FR-006:** Xoá thật (GDPR) chỉ là endpoint riêng, chỉ cho học viên đã lưu
  trữ, yêu cầu xác nhận gõ mã học viên, ghi audit trước khi xoá (giai đoạn 2,
  spec/migration riêng).

## 4. Migration 326 (chưa chạy ở đâu)

```sql
-- Migration: 326_student_archive.sql
--
-- STUDENTARCHIVE-0029. DELETE /admin/students/{id} hard-deleted the roster row
-- and, through ON DELETE CASCADE, every Writing assignment, draft, essay,
-- feedback and class item of the learner. Replace it with an archive:
-- archived_at/by/reason on students, every active class membership ended (so no
-- class fan-out reaches the learner), optional account deactivation, and an
-- append-only audit row — all in one locked transaction. No learner evidence is
-- changed. Functions are service_role-only (320 left function EXECUTE defaults
-- open, so this migration revokes them explicitly).
-- The 227 membership writers are re-created with an archive guard so that no
-- later class add or legacy cohort_id write can reactivate a membership of an
-- archived learner.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions (abort if unsafe)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'students'
                  AND ((column_name = 'archived_at'    AND data_type <> 'timestamp with time zone')
                    OR (column_name = 'archived_by'    AND data_type <> 'uuid')
                    OR (column_name = 'archive_reason' AND data_type <> 'text'))) THEN
        RAISE EXCEPTION 'students_archive_columns_conflict';
    END IF;
    IF to_regclass('public.student_lifecycle_audit') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'student_lifecycle_audit'
                          AND column_name = 'detail') THEN
        RAISE EXCEPTION 'student_lifecycle_audit_conflict';
    END IF;
    -- Account deactivation relies on 320 keeping is_active server-owned.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.users'::regclass
                      AND tgname = 'trg_users_guard_privileged_columns' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'migration_320_guard_missing';
    END IF;
END $$;

-- 1. Archive state on the roster row
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS archive_reason text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.students'::regclass
                      AND conname = 'chk_students_archive_fields') THEN
        ALTER TABLE public.students ADD CONSTRAINT chk_students_archive_fields
            CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_archived_at
    ON public.students (archived_at) WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.students.archived_at IS
    'STUDENTARCHIVE-0029: NULL = active. Set only by fn_archive_student (service_role).';

-- 2. Append-only audit (no FK to students so it survives a later purge)
CREATE TABLE IF NOT EXISTS public.student_lifecycle_audit (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    uuid NOT NULL,
    user_id       uuid,
    action        text NOT NULL CHECK (action IN ('archive', 'restore')),
    actor_user_id uuid NOT NULL,
    reason        text,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_lifecycle_audit_student
    ON public.student_lifecycle_audit (student_id, created_at DESC);
ALTER TABLE public.student_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_lifecycle_audit FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.student_lifecycle_audit FROM service_role;
GRANT SELECT, INSERT ON public.student_lifecycle_audit TO service_role;

-- 3. Archive
CREATE OR REPLACE FUNCTION public.fn_archive_student(
    p_student_id         uuid,
    p_actor              uuid,
    p_reason             text DEFAULT NULL,
    p_deactivate_account boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_s           public.students%ROWTYPE;
    v_cohorts     uuid[];
    v_deactivated boolean := false;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'archive_actor_required';
    END IF;

    SELECT * INTO v_s FROM public.students WHERE id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;                                   -- caller 404s
    END IF;
    IF v_s.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_archived', 'archived_at', v_s.archived_at);
    END IF;

    -- Same effect as fn_remove_student_cohort_membership (227), for every class.
    WITH ended AS (
        UPDATE public.student_cohort_memberships
           SET is_active = false, left_at = now(), updated_at = now()
         WHERE student_id = p_student_id AND is_active
        RETURNING cohort_id
    )
    SELECT COALESCE(array_agg(cohort_id), '{}') INTO v_cohorts FROM ended;

    UPDATE public.students
       SET archived_at = now(), archived_by = p_actor, archive_reason = p_reason,
           cohort_id = NULL
     WHERE id = p_student_id;

    IF p_deactivate_account AND v_s.user_id IS NOT NULL THEN
        -- Runs as the function owner with the service_role JWT: allowed by the
        -- 320 guard; a client JWT cannot reach this function (EXECUTE revoked).
        UPDATE public.users SET is_active = false
         WHERE id = v_s.user_id AND is_active;
        v_deactivated := FOUND;
    END IF;

    INSERT INTO public.student_lifecycle_audit
        (student_id, user_id, action, actor_user_id, reason, detail)
    VALUES (p_student_id, v_s.user_id, 'archive', p_actor, p_reason,
            jsonb_build_object('ended_cohort_ids', to_jsonb(v_cohorts),
                               'previous_cohort_id', v_s.cohort_id,
                               'instructor_id', v_s.instructor_id,
                               'account_deactivated', v_deactivated));

    RETURN jsonb_build_object('status', 'archived', 'ended_cohort_ids', to_jsonb(v_cohorts),
                              'account_deactivated', v_deactivated);
END;
$$;

-- 4. Restore
CREATE OR REPLACE FUNCTION public.fn_restore_student(
    p_student_id         uuid,
    p_actor              uuid,
    p_reason             text DEFAULT NULL,
    p_restore_cohorts    boolean DEFAULT true,
    p_reactivate_account boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_s        public.students%ROWTYPE;
    v_detail   jsonb;
    v_cohorts  uuid[] := '{}';
    v_restored uuid[] := '{}';
    v_primary  uuid;
    v_reactivated boolean := false;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'restore_actor_required';
    END IF;
    SELECT * INTO v_s FROM public.students WHERE id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_s.archived_at IS NULL THEN
        RETURN jsonb_build_object('status', 'not_archived');
    END IF;

    SELECT detail INTO v_detail FROM public.student_lifecycle_audit
     WHERE student_id = p_student_id AND action = 'archive'
     ORDER BY created_at DESC LIMIT 1;

    IF p_restore_cohorts AND v_detail ? 'ended_cohort_ids' THEN
        SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_cohorts
          FROM jsonb_array_elements_text(v_detail -> 'ended_cohort_ids') AS x;
        WITH back AS (
            UPDATE public.student_cohort_memberships m
               SET is_active = true, left_at = NULL, updated_at = now()
             WHERE m.student_id = p_student_id AND m.cohort_id = ANY (v_cohorts)
               AND NOT m.is_active
               AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id)
            RETURNING m.cohort_id
        )
        SELECT COALESCE(array_agg(cohort_id), '{}') INTO v_restored FROM back;
        v_primary := CASE
            WHEN (v_detail ->> 'previous_cohort_id')::uuid = ANY (v_restored)
                THEN (v_detail ->> 'previous_cohort_id')::uuid
            ELSE v_restored[1] END;
    END IF;

    UPDATE public.students
       SET archived_at = NULL, archived_by = NULL, archive_reason = NULL,
           cohort_id = COALESCE(v_primary, cohort_id)
     WHERE id = p_student_id;

    IF p_reactivate_account AND v_s.user_id IS NOT NULL THEN
        UPDATE public.users SET is_active = true WHERE id = v_s.user_id AND NOT is_active;
        v_reactivated := FOUND;
    END IF;

    INSERT INTO public.student_lifecycle_audit
        (student_id, user_id, action, actor_user_id, reason, detail)
    VALUES (p_student_id, v_s.user_id, 'restore', p_actor, p_reason,
            jsonb_build_object('restored_cohort_ids', to_jsonb(v_restored),
                               'account_reactivated', v_reactivated));

    RETURN jsonb_build_object('status', 'restored', 'restored_cohort_ids', to_jsonb(v_restored),
                              'account_reactivated', v_reactivated);
END;
$$;

-- 4b. Archive guards on the 227 membership writers (FR-002). Ending memberships
-- at archive time is not enough: fn_add_student(s)_cohort_membership (cohorts.py
-- single/bulk add, admin.py direct-code bridge) and the legacy cohort_id trigger
-- (/auth/activate fold, rolling backends) would otherwise reactivate a class
-- membership and let fan-out reach an archived learner. Bodies are the 227
-- bodies plus the guard; signatures, SECURITY DEFINER, search_path and the 227
-- grants are unchanged (CREATE OR REPLACE keeps the ACL). The student row lock
-- conflicts with fn_archive_student's FOR UPDATE, so an add either commits
-- before the archive (and the archive then ends that membership) or sees
-- archived_at and refuses.
CREATE OR REPLACE FUNCTION public.fn_add_student_cohort_membership(
    p_student_id uuid,
    p_cohort_id  uuid,
    p_added_by   uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_archived_at timestamptz;
BEGIN
    SELECT archived_at INTO v_archived_at
      FROM students WHERE id = p_student_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student_not_found';
    END IF;
    IF v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
    END IF;

    INSERT INTO student_cohort_memberships (
        student_id, cohort_id, is_active, left_at, added_by, updated_at
    ) VALUES (p_student_id, p_cohort_id, true, NULL, p_added_by, now())
    ON CONFLICT (student_id, cohort_id) DO UPDATE
          SET is_active = true,
              left_at = NULL,
              added_by = COALESCE(EXCLUDED.added_by,
                                  student_cohort_memberships.added_by),
              updated_at = now();

    UPDATE students
       SET cohort_id = COALESCE(cohort_id, p_cohort_id)
     WHERE id = p_student_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_add_students_cohort_membership(
    p_student_ids uuid[],
    p_cohort_id   uuid,
    p_added_by    uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_count    integer;
    v_archived uuid[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
    END IF;

    -- Lock in id order (no deadlock between bulk calls), then refuse the whole
    -- batch if any requested learner is archived: no partial add.
    PERFORM 1 FROM students
      WHERE id = ANY (COALESCE(p_student_ids, '{}'::uuid[]))
      ORDER BY id FOR NO KEY UPDATE;
    SELECT array_agg(id ORDER BY id) INTO v_archived
      FROM students
     WHERE id = ANY (COALESCE(p_student_ids, '{}'::uuid[]))
       AND archived_at IS NOT NULL;
    IF v_archived IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived'
            USING DETAIL = array_to_string(v_archived, ',');
    END IF;

    WITH wanted AS (
        SELECT DISTINCT unnest(COALESCE(p_student_ids, '{}'::uuid[])) AS id
    ), valid AS (
        SELECT s.id, EXISTS (
            SELECT 1 FROM student_cohort_memberships current
             WHERE current.student_id = s.id
               AND current.cohort_id = p_cohort_id AND current.is_active
        ) AS was_active
          FROM students s JOIN wanted w ON w.id = s.id
    ), upserted AS (
        INSERT INTO student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, added_by, updated_at
        )
        SELECT id, p_cohort_id, true, NULL, p_added_by, now() FROM valid
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true,
                  left_at = NULL,
                  added_by = COALESCE(EXCLUDED.added_by,
                                      student_cohort_memberships.added_by),
                  updated_at = now()
        RETURNING student_id
    )
    SELECT count(*) FILTER (WHERE NOT was_active) INTO v_count FROM valid;

    UPDATE students s
       SET cohort_id = p_cohort_id
     WHERE s.cohort_id IS NULL
       AND s.id = ANY(COALESCE(p_student_ids, '{}'::uuid[]));
    RETURN v_count;
END;
$$;

-- The trigger fires inside the UPDATE that already holds the row lock.
-- fn_archive_student writes cohort_id = NULL and fn_restore_student clears
-- archived_at in the same UPDATE, so neither trips the guard.
CREATE OR REPLACE FUNCTION public.fn_sync_legacy_student_cohort_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.cohort_id IS NOT NULL THEN
        IF NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'student_archived';
        END IF;
        INSERT INTO student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, updated_at
        ) VALUES (NEW.id, NEW.cohort_id, true, NULL, now())
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true, left_at = NULL, updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_archive_student(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_restore_student(uuid, uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_archive_student(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_restore_student(uuid, uuid, text, boolean, boolean) TO service_role;

-- 5. Postconditions
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'students'
           AND column_name IN ('archived_at', 'archived_by', 'archive_reason')) <> 3 THEN
        RAISE EXCEPTION 'students_archive_columns_missing';
    END IF;
    IF has_function_privilege('anon', 'public.fn_archive_student(uuid,uuid,text,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_archive_student(uuid,uuid,text,boolean)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'student_archive_functions_client_executable';
    END IF;
    IF has_table_privilege('anon', 'public.student_lifecycle_audit', 'SELECT')
       OR has_table_privilege('authenticated', 'public.student_lifecycle_audit', 'SELECT')
       OR has_table_privilege('authenticated', 'public.student_lifecycle_audit', 'INSERT')
       OR has_table_privilege('service_role', 'public.student_lifecycle_audit', 'UPDATE')
       OR has_table_privilege('service_role', 'public.student_lifecycle_audit', 'DELETE')
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_lifecycle_audit'::regclass) THEN
        RAISE EXCEPTION 'student_lifecycle_audit_privileges_wrong';
    END IF;
    IF has_function_privilege('authenticated', 'public.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'membership_functions_client_executable';   -- 227 grants kept
    END IF;
    IF has_table_privilege('authenticated', 'public.students', 'UPDATE') THEN
        RAISE EXCEPTION 'students_client_update_privilege';   -- 320 invariant
    END IF;
END $$;

COMMIT;
```

Ghi chú:
- `UPDATE students SET cohort_id = NULL` kích hoạt `trg_sync_legacy_student_cohort_membership`
  (AFTER UPDATE OF cohort_id) — cùng đường mà `fn_remove_student_cohort_membership`
  đã dùng (227: `UPDATE students SET cohort_id = v_primary`, v_primary có thể NULL).
  Thân hàm trong repo (`227_student_cohort_memberships.sql:57–73`) chỉ ghi khi
  `NEW.cohort_id IS NOT NULL` → với NULL là no-op; T002a vẫn đối chiếu bản live
  và T004 phải test.
- Guard §4b (FR-002): lưu trữ chỉ kết thúc membership hiện có; nếu không chặn,
  thêm lớp đơn/hàng loạt (`routers/cohorts.py:283–311`, `:318–341` →
  `fn_add_student(s)_cohort_membership`), cầu nối mã direct
  (`routers/admin.py:2636–2653` → `add_student`) và trigger legacy (fold
  `cohort_id` ở `/auth/activate`, `routers/auth.py:610–623`) sẽ bật lại membership
  (`ON CONFLICT … SET is_active = true`, 227:99–108, 145–155) và fan-out lớp lại tới
  học viên đã lưu trữ. Guard khoá dòng `students` (xung đột với `FOR UPDATE` của
  `fn_archive_student`) rồi `RAISE 'student_archived'`; bulk từ chối cả lô.
- `students_self_read` vẫn cho học viên đọc dòng của chính mình (kể cả khi đã
  lưu trữ) — chấp nhận được (không lộ dữ liệu người khác); app chặn ở backend.
- Trigger 320 (`trg_users_guard_privileged_columns`) chỉ trên `users`, cấm client
  đổi `is_active`; trong hàm SECURITY DEFINER, `current_user` = owner (postgres)
  và JWT role = `service_role` → được phép. Gọi bằng JWT client là không thể
  (EXECUTE đã revoke); kể cả nếu có, trigger vẫn chặn vì JWT role
  `authenticated`.

### Rollback

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.students WHERE archived_at IS NOT NULL) THEN
        RAISE EXCEPTION 'rollback_unsafe_archived_students_exist';
    END IF;
    IF EXISTS (SELECT 1 FROM public.student_lifecycle_audit) THEN
        RAISE EXCEPTION 'rollback_unsafe_audit_rows_exist';
    END IF;
END $$;
-- Restore the unguarded 227 bodies FIRST: the §4b bodies reference
-- students.archived_at and would fail at runtime once the column is dropped.
-- Copy fn_sync_legacy_student_cohort_membership, fn_add_student_cohort_membership
-- and fn_add_students_cohort_membership verbatim from
-- 227_student_cohort_memberships.sql:57–165 (CREATE OR REPLACE keeps the grants).
DROP FUNCTION IF EXISTS public.fn_restore_student(uuid, uuid, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.fn_archive_student(uuid, uuid, text, boolean);
DROP TABLE IF EXISTS public.student_lifecycle_audit;
DROP INDEX IF EXISTS public.idx_students_archived_at;
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_archive_fields;
ALTER TABLE public.students
    DROP COLUMN IF EXISTS archive_reason,
    DROP COLUMN IF EXISTS archived_by,
    DROP COLUMN IF EXISTS archived_at;
COMMIT;
```

An toàn **chỉ khi** 0 học viên đang lưu trữ **và** bảng audit rỗng (block trên tự
abort). Nếu đã có học viên lưu trữ: khôi phục từng người bằng `fn_restore_student`
(hoặc quyết định riêng) trước — nếu không, drop cột sẽ "hồi sinh" họ trong mọi
danh sách (dù membership đã kết thúc) và mất audit. Code backend phải rollback
**trước** schema (code mới gọi RPC/cột). Rollback = migration forward mới.

Rollback backend **không** chỉ là "code cũ bỏ qua cột mới": backend trước 0029
gọi lại xoá cứng (`routers/admin_students.py:129–136` →
`student_service.delete_student`, cascade xoá bài làm của học viên đã lưu trữ —
trái FR-005/FR-006) và `fetch_linked_student` cũ cho học viên đã lưu trữ vào
Writing (trái FR-002); guard schema không chặn được hai điều này và bảng audit
append-only không thể làm rỗng. Vì vậy: chỉ revert nguyên trạng backend khi
`SELECT count(*) FROM public.students WHERE archived_at IS NOT NULL` = 0; nếu > 0
thì rollback bằng bản build tương thích lưu trữ (commit revert forward chỉ gỡ phần
lỗi, giữ DELETE → `fn_archive_student`, lọc `fetch_linked_student`, chặn
`/auth/activate`, 409 `student_archived`) và kiểm tra lại AC-2, AC-7, AC-8, AC-14 trên
bản đó trước khi chuyển traffic. Xem `rollout.md`.

## 5. Code thay đổi

| File / hàm | Thay đổi |
| --- | --- |
| `routers/admin_students.py:129–135` `delete_student` | Gọi `fn_archive_student(p_student_id, p_actor=admin id, p_reason, p_deactivate_account)` (body/query tuỳ chọn `reason`, `deactivate_account`); NULL → 404; trả 204. Cập nhật docstring đầu file (1–8). |
| `services/student_service.py:306–319` `delete_student` | Thay bằng `archive_student(...)` gọi RPC; bỏ `.delete()`. |
| Mới: `POST /admin/students/{id}/restore` | Gọi `fn_restore_student`; `not_archived` → 409. |
| `services/student_service.py:86` `list_students` (+ `GET /admin/students`, `admin_students.py:86`) | Mặc định `.is_("archived_at", "null")`; `?include_archived=true` cho admin; trả `archived_at` trong `models/admin_students.py`. |
| `GET /admin/students/{id}` (`admin_students.py:99`, `get_student_with_history`:253) | Trả kèm trạng thái lưu trữ (admin vẫn xem được). |
| `routers/instructor.py:587–600` roster & detail | Lọc `archived_at IS NULL` (instructor không thấy học viên đã lưu trữ). |
| `services/student_service.py:445` `fetch_linked_student` (dùng ở `routers/writing_student.py:142` `get_current_student`) | Bỏ dòng đã lưu trữ → học viên nhận 403 hiện có ở Writing/lớp. |
| Thêm lớp: `routers/cohorts.py:283` (đơn), `:319` (hàng loạt); cầu nối mã direct `routers/admin.py:2636–2653` | DB guard §4b từ chối học viên đã lưu trữ (`student_archived`). Route đơn/hàng loạt trả 409 `student_archived` thay vì 500 (bulk: cả lô bị từ chối, không thêm phần nào). Cầu nối mã direct kiểm hồ sơ liên kết đã lưu trữ **trước** khi tạo mã → 409, không nuốt lỗi bằng `logger.warning`. |
| `routers/auth.py:568–572` (`/auth/activate`, by_user/by_code) | Nếu hồ sơ khớp đã lưu trữ → 403 "Hồ sơ học viên đã được lưu trữ — liên hệ admin", **trước** khi kích hoạt/claim mã (không đổi `users.is_active`, mã không bị tiêu). |
| Giao bài Writing cá nhân (`routers/admin_writing_assignments.py` tạo bài; `fn_create_writing_assignments_idempotent`) và instructor tạo bài (`routers/instructor.py` `create_assignment`) | Từ chối `student_id` đã lưu trữ (422/409). Hàm SQL `fn_create_writing_assignments_idempotent` — **chưa đọc thân hàm**; nếu nó nhận danh sách student_id, cần thêm kiểm trong migration riêng hoặc ở Python trước khi gọi. |
| Fan-out lớp (`fn_create_class_assignment(…, uuid[])` và các hàm roster) | Không cần sửa nếu chúng đọc roster qua membership active — **cần xác nhận** bằng đọc thân hàm live trước khi implement (T002a). |
| UI admin Next (`admin-students-directory.tsx`) | Thêm hành động "Lưu trữ" (xác nhận, lý do, tuỳ chọn khoá tài khoản), bộ lọc "Đã lưu trữ", nút "Khôi phục". Xoá/ẩn `public/js/admin-students-panel.js` cũ hoặc đổi chữ confirm. |
| Purge GDPR (giai đoạn 2) | Endpoint riêng `POST /admin/students/{id}/purge` chỉ cho học viên đã lưu trữ ≥ N ngày, xác nhận gõ `student_code`, ghi audit trước; RPC xoá nháp tường minh trước (xem A-08B), xử lý `grammar_diagnostic_sessions` RESTRICT và trigger Advanced Vocab, quyết định essay: xoá hay ẩn danh. Spec + migration riêng; auth user Supabase xoá bằng tay sau khi xác nhận (trigger `grammar_quiz_account_erasure_gate` trên `auth.users`, 309:91–93, cần được tính đến). |

Test: `backend/tests/test_migration_326_student_archive.py` (tĩnh + PG): archive
→ membership kết thúc, dữ liệu bài làm không đổi (đếm trước/sau), audit 1 dòng,
idempotent; restore trả lớp; `SET ROLE authenticated` + claims không gọi được RPC
và không đổi được `users.is_active` (42501); rollback block abort khi có archived.
PG cũng test guard §4b: thêm đơn/hàng loạt/`UPDATE students SET cohort_id` cho
học viên đã lưu trữ → `student_archived`, membership không đổi, bulk không thêm
phần nào; hai phiên đồng thời (archive vs thêm lớp) không bao giờ kết thúc với
học viên đã lưu trữ có membership active; restore không vấp guard.
Test route: DELETE → 204 không gọi `.delete()`; activate với hồ sơ archived → 403;
thêm lớp đơn/hàng loạt và mã direct cho học viên archived → 409.

## 6. Kiểm tra production — **chờ anh Vinh cho phép chạy chỉ đọc**

```sql
BEGIN TRANSACTION READ ONLY;
-- P1: FK vào students / writing_essays / class_assignment_items (so với staging)
SELECT conrelid::regclass, confrelid::regclass, conname, confdeltype
  FROM pg_constraint
 WHERE contype = 'f' AND confrelid IN ('public.students'::regclass,
       'public.writing_essays'::regclass, 'public.class_assignment_items'::regclass)
 ORDER BY 2, 1;
-- P2: cột/bảng mới chưa tồn tại
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'students'
   AND column_name IN ('archived_at', 'archived_by', 'archive_reason', 'deleted_at');
SELECT to_regclass('public.student_lifecycle_audit');
-- P3: quy mô (bán kính ảnh hưởng của xoá cứng hiện tại)
SELECT (SELECT count(*) FROM public.students) students,
       (SELECT count(*) FROM public.students WHERE user_id IS NOT NULL) linked,
       (SELECT count(*) FROM public.writing_essays) essays,
       (SELECT count(*) FROM public.writing_drafts) drafts,
       (SELECT count(*) FROM public.student_cohort_memberships WHERE is_active) active_memberships;
-- P4: trigger 320 có và bật
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.users'::regclass AND tgname = 'trg_users_guard_privileged_columns';
-- P5: thân hàm roster/fan-out (đọc để xác nhận dùng membership active)
SELECT p.oid::regprocedure, p.prosrc FROM pg_proc p
 WHERE p.proname IN ('fn_create_class_assignment', 'fn_create_writing_assignments_idempotent',
                     'fn_sync_legacy_student_cohort_membership');
-- P6: ledger
SELECT filename FROM public._schema_migrations ORDER BY filename DESC LIMIT 5;
ROLLBACK;
```

## 7. Tiêu chí chấp nhận trên staging

Dùng học viên E2E (`staging_seed.py --ns <ns>`) có: 1 bài Writing có nháp, 1
essay đã chấm, 1 membership lớp.

| # | Bước | Kỳ vọng |
| --- | --- | --- |
| AC-1 | Catalog sau apply | 3 cột + CHECK + index; bảng audit RLS bật, client không quyền; 2 hàm chỉ service_role EXECUTE. |
| AC-2 | Chụp số dòng (assignments, drafts, essays, feedback, items, memberships) của học viên E2E; `DELETE /admin/students/{id}` | 204; mọi số dòng **giữ nguyên**, chỉ membership chuyển `is_active=false`; `students.archived_at` có giá trị; audit 1 dòng `archive`. |
| AC-3 | Gọi lại DELETE | 204, không thêm audit (idempotent). |
| AC-4 | `GET /admin/students` | Không có học viên E2E; `?include_archived=true` có, kèm `archived_at`. |
| AC-5 | Instructor roster | Không có học viên E2E. |
| AC-6 | Admin giao bài lớp cho lớp cũ | Học viên E2E không nhận item. Giao bài Writing cá nhân cho học viên E2E → bị từ chối. |
| AC-7 | Học viên E2E đăng nhập, vào Writing / lớp | 403; Speaking vẫn dùng được nếu `deactivate_account=false`. |
| AC-8 | Học viên E2E kích hoạt một mã mới | 403 "đã lưu trữ"; mã chưa bị tiêu (`is_used=false`). |
| AC-9 | Lưu trữ với `deactivate_account=true` | `users.is_active=false`; `/auth/check-active` false. |
| AC-10 | Bằng JWT học viên: PATCH `/rest/v1/users?id=eq.<self>` `{"is_active":true}`; PATCH `/rest/v1/students?id=eq.<sid>` `{"archived_at":null}`; POST `/rest/v1/rpc/fn_restore_student` | Đều bị từ chối (không UPDATE grant / EXECUTE; trigger 320). |
| AC-11 | `POST /admin/students/{id}/restore` | Học viên trở lại danh sách, membership lớp cũ active, `students.cohort_id` = lớp chính cũ; audit `restore`; dữ liệu bài làm vẫn đủ. |
| AC-12 | Học viên khác không bị ảnh hưởng | Danh sách/roster/lớp của 8 học viên còn lại không đổi. |
| AC-13 | Dọn E2E | `staging_seed.py --cleanup` vẫn chạy (đường xoá cứng chỉ trong script). |
| AC-14 | Với học viên E2E đã lưu trữ: `POST /admin/cohorts/{lớp cũ}/students` và `POST /admin/cohorts/{lớp cũ}/students/bulk` (kèm 1 học viên E2E khác chưa lưu trữ); `POST /admin/access-codes/generate-and-assign` mã direct có `cohort_id` cho user của học viên; rồi giao bài lớp | Đơn/hàng loạt/mã direct đều 409 `student_archived`; không membership nào bật lại (bulk không thêm cả học viên kia), không mã nào được tạo; bài giao lớp không tạo item cho học viên đã lưu trữ. |

## 8. Rủi ro & phân loại

- **Change class: high-risk**, đề xuất `risk: critical` (đổi ngữ nghĩa xoá dữ
  liệu học viên, chạm `users.is_active` — cột auth đặc quyền do 320 bảo vệ,
  migration + RLS/grant).
- Mất dữ liệu: giảm mạnh (không còn cascade). Migration chỉ thêm cột/bảng/hàm.
- Rò rỉ: sót chỗ lọc `archived_at` → học viên đã lưu trữ vẫn hiện ở danh sách
  nào đó (không lộ dữ liệu người khác, nhưng sai nghiệp vụ). Giảm thiểu bằng việc
  kết thúc membership (cắt fan-out lớp) + checklist §5 + AC-4…AC-8.
- Leo thang: hàm SECURITY DEFINER sửa `users.is_active` — chỉ service_role
  EXECUTE (postcondition kiểm); backend gọi sau `require_admin`.
- GDPR: lưu trữ **không** phải xoá dữ liệu cá nhân; yêu cầu xoá thật cần giai
  đoạn 2 (FR-006).
- `trg_sync_legacy_student_cohort_membership` với `cohort_id = NULL` chưa kiểm
  thân hàm.

## 9. Tasks

- [ ] T001 Duyệt spec (critical) lên `staging`; chốt số.
- [ ] T002a Đọc thân hàm live P5 trên staging (chỉ đọc) — xác nhận fan-out dùng membership active.
- [ ] T002 Viết 326. - [ ] T003 Backend §5. - [ ] T004 Tests (PG + route).
- [ ] T005 UI Next lưu trữ/khôi phục; gỡ panel cũ. - [ ] T006 README migrations.
- [ ] T007 P1–P6 production (chờ anh Vinh cho phép chạy chỉ đọc).
- [ ] T008 Staging AC-1…AC-14; T009 production sau duyệt.
- [ ] T010 (giai đoạn 2) Spec purge GDPR.

## 10. Chưa kiểm chứng

- Thân hàm `fn_create_class_assignment`, `fn_create_writing_assignments_idempotent`,
  `fn_sync_legacy_student_cohort_membership` (live) — chưa đọc.
- SQL 326 và rollback chưa chạy ở đâu.
- Production: chưa truy vấn.
- Có công cụ/UI nào khác ngoài `admin-students-panel.js` (có vẻ không còn được
  nạp) đang gọi `DELETE /admin/students/{id}` — không tìm thấy trong repo.
