# Research record — ASSIGNDRAFT-0027 (Vietnamese, as approved)

> Approved by Vinh 2026-10-27 07:14 UTC+7. This is the reviewed Vietnamese
> draft, kept verbatim as the evidence record (file:line citations against
> `origin/staging@3aded02b`, read-only staging catalog/data queries on
> 2026-10-27). The canonical contract is `spec.md`; the locked migration
> number is **324**. Production was never queried: every production query
> below stays **chờ anh Vinh cho phép chạy chỉ đọc**.

> **Cập nhật 2026-10-27 (sau khi duyệt):** Phần A đã merge vào `staging` qua
> #1732 (`d129a1d23`, `backend/services/writing_assignment_delete_guard.py`):
> cả hai route DELETE chỉ xoá khi `pending`, `started_at`/`essay_id` NULL và
> không có nháp, ngược lại 409 "Học viên đã bắt đầu — không xoá được". Mục §1
> "Phần A — trạng thái" và §6.1–6.3 dưới đây được viết trước #1732; phần code
> còn lại của B chỉ là map lỗi `23503` của câu `DELETE` cuối trong guard sang
> cùng 409 đó (xem `spec.md`/`plan.md`). Hợp đồng chuẩn nằm ở `spec.md`.


# A-08B — Ngăn mất `writing_drafts` khi xoá `writing_assignments`

> Hồ sơ nghiên cứu (bản nháp gốc đã được duyệt) gộp spec/plan/tasks/verification/rollout theo `specs/_templates/*`.
> Code đối chiếu `origin/staging@3aded02b` (xuất bằng `git archive`, sau
> `git fetch` lúc 2026-10-27 00:3x giờ VN). Schema đối chiếu **staging**
> `zjphffoujxkpltixsbzj` chỉ bằng SELECT/catalog. **Production không được truy
> vấn. Chưa chạy bất kỳ SQL ghi/DDL nào.**

## 1. Problem

Bản nháp bài viết của học viên (`writing_drafts`) bị xoá dây chuyền khi bài
giao cha (`writing_assignments`) bị xoá:

- `backend/migrations/037_writing_drafts.sql:17` —
  `assignment_id UUID NOT NULL REFERENCES writing_assignments(id) ON DELETE CASCADE`
  (gợi ý của parent đã kiểm: đúng dòng 17, bảng cha `writing_assignments`).
- Staging live: `writing_drafts_assignment_id_fkey :: FOREIGN KEY (assignment_id)
  REFERENCES writing_assignments(id) ON DELETE CASCADE` — khớp 037, không drift.

Các đường xoá bài giao Writing cá nhân hiện có:

1. **Admin** `DELETE /admin/writing/assignments/{id}` —
   `backend/routers/admin_writing_assignments.py:665–699`. Đọc `status` (676–683),
   chỉ cho xoá khi `pending` (685–690, 409 nếu khác), rồi `DELETE` ở **request
   PostgREST thứ hai** (693–698), **không try/except** (lỗi DB → 500 thô).
   - Cửa sổ race: học viên lưu nháp ở `PATCH /writing/my-assignments/{id}/draft`
     (`backend/routers/writing_student.py:1403`) — upsert nháp trước
     (`writing_student.py:1456–1462`), rồi mới đổi `pending → in_progress`
     (1474–1481, lỗi bước này chỉ log, "Non-fatal"). Nếu admin đọc `pending`
     trong khoảng đó, nháp vừa lưu bị CASCADE xoá. Ngoài ra nếu bước đổi status
     lỗi, nháp tồn tại lâu dài trên bài `pending` và admin xoá được.
2. **Instructor** `DELETE /instructor/assignments/{id}` —
   `backend/routers/instructor.py:238–244`: **không kiểm status, không kiểm
   nháp**; chỉ lọc owner `assigned_by = me` qua `instructor_db`
   (`backend/services/instructor_access.py:66–113`). Xoá được cả bài
   `in_progress` có nháp → mất nháp. (Essay đã nộp không mất vì
   `writing_assignments.essay_id → writing_essays ON DELETE SET NULL` chiều
   ngược lại; xem §2.)
3. **Gián tiếp**: xoá học viên `DELETE /admin/students/{id}` →
   `writing_assignments.student_id … ON DELETE CASCADE` → nháp mất. Thuộc spec
   `STUDENT-DELETE-soft-delete.md`.

UI: không tìm thấy nút gọi hai route xoá (1) và (2) trong `frontend/` hiện tại
(`rg` không thấy DELETE tới `/admin/writing/assignments/{id}` hay
`/instructor/assignments/{id}`; chỉ có trong `frontend/types/api.d.ts:3929, 4115`).
⇒ Hiện chỉ gọi được qua API/công cụ; vẫn là lỗ mất dữ liệu.

### Phần A (code chặn + 409) — trạng thái

Brief nói Code Manager đang làm phần A. **Không tìm thấy PR nào** cho phần A:
`gh pr list --state open` (5 PR mở: #1728, #1727, #1725, #1720, #1716 — không
liên quan), 40 PR gần nhất mọi trạng thái, `gh search prs` với "A-08",
"writing_drafts", "delete assignment", "409 assignment", và tên branch remote
(`a08|draft|assign`) — không khớp. Spec này vì thế định nghĩa hợp đồng 409 để
phần A và B khớp nhau (§7); khi PR phần A xuất hiện cần đối chiếu lại.

## 2. Schema hiện tại (staging, đã đọc)

FK **vào** `writing_assignments` (toàn DB): **chỉ một**
`writing_drafts.assignment_id → writing_assignments(id) ON DELETE CASCADE`.

FK của `writing_assignments`:
| FK | Hành vi |
| --- | --- |
| `student_id → students(id)` | CASCADE |
| `essay_id → writing_essays(id)` | SET NULL (essay sống độc lập) |
| `prompt_id → writing_prompts(id)` | RESTRICT |
| `assigned_by → users(id)` | SET NULL |
| `cohort_id → cohorts(id)` | SET NULL |

`writing_drafts`: PK `id`; `UNIQUE (assignment_id)` (`writing_drafts_assignment_id_key`);
`student_id → students(id) ON DELETE CASCADE`; index `idx_writing_drafts_student`.
Trigger: `trg_guard_writing_draft_mutation BEFORE INSERT OR UPDATE` →
`fn_guard_writing_draft_mutation()` (SECURITY INVOKER) **khoá dòng cha bằng
`SELECT … FROM writing_assignments WHERE id = NEW.assignment_id FOR UPDATE`**,
từ chối nếu status ∉ (`pending`,`in_progress`) hoặc lease hết hạn
(`active_player_expired`, 55000); `update_writing_drafts_updated_at`.
`writing_assignments` triggers: `trg_guard_writing_assignment_terminal_mutation`
(BEFORE UPDATE OF status), `update_writing_assignments_updated_at`.
CHECK status: `pending, in_progress, submitted, graded, delivered`.
RLS bật cả hai bảng; policies: `writing_drafts_admin_all`, `writing_drafts_student_own`
(ALL, authenticated), `writing_assignments_admin_all`, `writing_assignments_instructor_own`,
`writing_assignments_student_read`. Grants: anon/authenticated chỉ SELECT
(sau 320); service_role đủ quyền.

### 2.1 Các bảng con CASCADE khác liên quan "assignment" (để đủ bức tranh)

| Con → Cha | ON DELETE | Được bảo vệ bởi |
| --- | --- | --- |
| `class_assignment_items → class_assignments` | CASCADE | RPC `fn_delete_class_assignment_if_unsubmitted` (179, bản live = 283:767–847) |
| `course_writing_drafts → class_assignment_items` | CASCADE | gián tiếp qua RPC trên (`opened_at`) — **chưa kiểm chứng** mọi ghi nháp course đều set `opened_at` |
| `advanced_vocab_{stage_progress,question_attempts,listening_attempts,practice_selections,rewrite_submissions} → class_assignment_items` | CASCADE | trigger `trg_protect_advanced_vocab_item_evidence BEFORE DELETE` (263) |
| `grammar_lesson_attempts → class_assignment_items` | CASCADE | RPC qua `opened_at` (312:130 set `opened_at`) |
| `grammar_diagnostic_sessions → class_assignment_items` | RESTRICT | FK |
| `sessions, listening/reading_test_attempts, quiz_sessions, course_{writing,section,pronunciation}_submissions → class_assignment_items` | SET NULL | RPC khoá + kiểm bằng chứng |

Đường bài giao lớp (`DELETE /admin/cohorts/{cohort_id}/assignments/{id}`,
`backend/routers/admin_class_assignments.py:2993–3040`) đã dùng RPC khoá dòng
(179/283) và map FALSE → 409 "Đã có học viên nộp bài này — không xoá được…".
Bài giao Writing cá nhân **chưa có** cơ chế tương đương — đó là lỗ của A-08.

### 2.2 Số liệu staging (đã chạy, chỉ đọc)

| status | assignments | có nháp | nháp không rỗng | có essay |
| --- | --- | --- | --- | --- |
| in_progress | 5 | 4 | 4 | 0 |
| pending | 8 | 0 | 0 | 0 |
| submitted | 9 | 0 | 0 | 9 |

Nháp mồ côi (assignment không tồn tại): **0**. Nháp lệch `student_id` với bài
cha: **0**. Tổng nháp: 4. Nháp trên bài `pending`: 0. `course_writing_drafts`: 0.
Ledger staging cao nhất: `320_client_write_privilege_lockdown.sql`.

## 3. So sánh phương án

| | A. FK → RESTRICT | A'. FK → NO ACTION (**đề xuất**) | B. Soft-delete `deleted_at` | C. RPC xoá nguyên tử (kiểu 179/283) |
| --- | --- | --- | --- | --- |
| Chặn mọi đường xoá (admin, instructor, script, SQL tay) | Có | Có | Chỉ đường đã sửa code | Chỉ đường gọi RPC |
| Race-free | Có (FK khoá) | Có | Có nếu update đơn | Có (FOR UPDATE) |
| Đổi code | Map 23503 → 409 | Map 23503 → 409 | Lớn: mọi truy vấn đọc phải lọc | Vừa: 2 route gọi RPC |
| Tương thích xoá học viên (cascade 2 nhánh) | **Rủi ro**: RESTRICT kiểm ngay, có thể lỗi tuỳ thứ tự cascade | Kiểm cuối câu lệnh → nhánh `student_id` CASCADE đã xoá nháp | Không ảnh hưởng | Không ảnh hưởng |
| Rollback | Dễ (đổi lại FK) | Dễ | Khó (dữ liệu đã "ẩn") | Dễ |

Chi tiết B (soft-delete): phải thêm `deleted_at` và lọc ở **mọi** nơi đọc
`writing_assignments`: ~43 lời gọi `table("writing_assignments")` trong 10 file
backend (`routers/writing_student.py` 14, `routers/admin_writing_assignments.py` 8,
`routers/instructor.py` 5, `services/cohort_assignment_service.py` 5,
`services/essay_service.py` 4, `routers/admin_writing_cohorts.py` 2,
`services/instructor_access.py` 2, `services/core_attempt_outcomes.py` 2,
`routers/class_student.py` 1, `services/access_code_permissions.py` 1) cùng các
endpoint list/detail: `GET /admin/writing/assignments` (admin_writing_assignments.py:240),
`GET /admin/writing/assignments/{id}` (:570), `GET /instructor/assignments`
(instructor.py:204), `GET /instructor/assignments/{id}` (:211),
`GET /instructor/students/{id}/summary` (:603), `GET /writing/my-assignments`
(writing_student.py:1237), `GET /writing/my-assignments/{id}` (:1318) và các
route con `/submission` (:1841), `/timer` (:1864), `/entry` (:2018),
admissions (:2047, :2117), `GET /class/my-assignments` (class_student.py:600),
`GET /admin/writing/cohorts…` (admin_writing_cohorts.py:128, 193, 306), RLS
`writing_assignments_student_read`, cộng các RPC SQL đọc bảng (vd.
`fn_admin_writing_queue_page`, `fn_create_writing_assignments_idempotent`).
Bỏ sót một chỗ = bài "đã xoá" hiện lại. Quá rộng cho một bug fix; **không chọn**.

C (RPC) đúng mô hình 179/283 và cho thông điệp 409 sạch, nhưng chỉ bảo vệ
đường gọi nó; instructor route và script vẫn có thể `DELETE` thẳng.

**Chọn A' (FK `ON DELETE NO ACTION`)**: Postgres đảm bảo không còn đường nào
(hiện tại hay tương lai) xoá được bài giao đang có nháp; race được đóng bởi
chính FK (DELETE cha phải chờ khoá của INSERT/UPDATE nháp, và trigger nháp đã
`FOR UPDATE` dòng cha). Chọn NO ACTION thay RESTRICT để xoá học viên (khi còn
được phép, vd. purge GDPR) — nơi cha và con bị xoá trong **cùng** câu lệnh qua
hai nhánh CASCADE — không bị chặn bởi thứ tự kích hoạt trigger RI. **Hành vi
này phải được chứng minh bằng test Postgres trong CI (T004) trước khi merge;
chưa kiểm chứng thực nghiệm** (không được chạy DDL).

Tuỳ chọn bổ sung (không bắt buộc): RPC kiểu C cho admin route để trả 409 với
lý do cụ thể mà không cần parse lỗi 23503 — có thể làm sau.

## 4. Requirements

- **FR-001:** Xoá một `writing_assignments` đang có dòng `writing_drafts` bị DB
  từ chối (mọi role, mọi đường).
- **FR-002:** Admin và instructor nhận **409** (không 500) với thông điệp tiếng
  Việt thống nhất khi bài có nháp; bài `pending` không nháp vẫn xoá được (204/200 như cũ).
- **FR-003:** Instructor không xoá được bài khác `pending` (đồng bộ với admin).
- **FR-004:** Xoá học viên theo đường purge có chủ đích (nếu còn) vẫn hoạt động.
- **FR-005:** Không row nào bị đổi/xoá bởi migration.

## 5. Migration 324 (chưa chạy ở đâu)

```sql
-- Migration: 324_writing_drafts_assignment_fk_no_action.sql
--
-- A-08B / ASSIGNDRAFT-0027. writing_drafts.assignment_id was ON DELETE CASCADE
-- (037:17): deleting a writing assignment silently erased the learner's draft
-- (admin check-then-delete race, instructor route with no status check).
-- NO ACTION makes Postgres refuse any assignment delete while a draft exists;
-- the backend maps 23503 to 409. NO ACTION (not RESTRICT) so a single-statement
-- student purge that removes both rows through student_id CASCADE still works.
-- No data change. Idempotent.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Precheck: VALIDATE would fail on orphans; refuse to guess.
DO $$
DECLARE
    v_orphans BIGINT;
BEGIN
    SELECT count(*) INTO v_orphans
      FROM public.writing_drafts d
     WHERE NOT EXISTS (SELECT 1 FROM public.writing_assignments a WHERE a.id = d.assignment_id);
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'writing_drafts_orphans_exist'
            USING DETAIL = format('%s drafts reference a missing assignment', v_orphans);
    END IF;
END $$;

-- 2. Replace the FK only when it is still the 037 CASCADE (catalog fields, not
--    pg_get_constraintdef text, so search_path cannot change the comparison).
DO $$
DECLARE
    v_deltype "char";
BEGIN
    SELECT c.confdeltype INTO v_deltype
      FROM pg_constraint c
     WHERE c.conrelid = 'public.writing_drafts'::regclass
       AND c.conname = 'writing_drafts_assignment_id_fkey'
       AND c.contype = 'f'
       AND c.confrelid = 'public.writing_assignments'::regclass;

    IF v_deltype = 'a' THEN
        RETURN;                                   -- already NO ACTION (re-run)
    ELSIF v_deltype = 'c' OR v_deltype IS NULL THEN
        ALTER TABLE public.writing_drafts
            DROP CONSTRAINT IF EXISTS writing_drafts_assignment_id_fkey;
        ALTER TABLE public.writing_drafts
            ADD CONSTRAINT writing_drafts_assignment_id_fkey
            FOREIGN KEY (assignment_id) REFERENCES public.writing_assignments(id)
            ON DELETE NO ACTION NOT VALID;
    ELSE
        RAISE EXCEPTION 'writing_drafts_assignment_fk_unexpected'
            USING DETAIL = format('confdeltype=%s; review before changing', v_deltype);
    END IF;
END $$;

ALTER TABLE public.writing_drafts VALIDATE CONSTRAINT writing_drafts_assignment_id_fkey;

-- 3. Postcondition
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.writing_drafts'::regclass
           AND c.conname = 'writing_drafts_assignment_id_fkey'
           AND c.confrelid = 'public.writing_assignments'::regclass
           AND c.confdeltype = 'a'
           AND c.convalidated
    ) THEN
        RAISE EXCEPTION 'writing_drafts_assignment_fk_postcondition_failed';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.writing_assignments'::regclass
           AND c.confdeltype = 'c'
    ) THEN
        RAISE EXCEPTION 'writing_assignments_still_has_cascading_child';
    END IF;
END $$;

COMMIT;
```

Ghi chú: drop + add FK trong một transaction → không có khoảnh khắc thiếu FK.
`ADD … NOT VALID` lấy SHARE ROW EXCLUSIVE ngắn trên hai bảng; `VALIDATE` quét
`writing_drafts` (staging 4 dòng). `lock_timeout` 5s để fail nhanh. Không đụng
trigger/policy/grant (tương thích 320). Không cần dòng `forward-policy.tsv`.

### Rollback

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.writing_drafts DROP CONSTRAINT IF EXISTS writing_drafts_assignment_id_fkey;
ALTER TABLE public.writing_drafts
    ADD CONSTRAINT writing_drafts_assignment_id_fkey
    FOREIGN KEY (assignment_id) REFERENCES public.writing_assignments(id) ON DELETE CASCADE;
COMMIT;
```

An toàn về dữ liệu ở mọi thời điểm (không dòng nào đổi; FK CASCADE luôn hợp lệ
khi không có nháp mồ côi). Nhưng rollback **mở lại lỗ mất nháp** — chỉ dùng nếu
FK mới chặn một luồng hợp lệ chưa lường trước (vd. purge học viên bị lỗi theo
thứ tự cascade) và chưa kịp sửa code. Rollback phải là migration forward mới.

## 6. Code thay đổi

1. `backend/routers/admin_writing_assignments.py:693–698` (`delete_assignment`):
   bọc `DELETE` trong try/except; lỗi có code `23503` / tên
   `writing_drafts_assignment_id_fkey` → `HTTPException(409, …)`; lỗi khác → 500
   có thông điệp chung. Giữ kiểm `pending` (676–690).
2. `backend/routers/instructor.py:238–244` (`delete_assignment`): thêm kiểm
   status `pending` giống admin (409 nếu khác) và map 23503 → 409 như trên.
3. Thông điệp thống nhất với phần A (đề xuất, cần khớp PR phần A khi có):
   "Học viên đã bắt đầu làm bài này (có bản nháp) — không xoá được. Hãy để bài
   lại hoặc liên hệ học viên." HTTP 409.
4. Test: `backend/tests/test_migration_324_writing_drafts_fk.py` (tĩnh + PG):
   xoá bài có nháp → 23503; xoá bài pending không nháp → OK; xoá học viên có bài
   + nháp trong một DELETE → OK (chứng minh NO ACTION); tạo nháp song song với
   xoá → một bên thắng, nháp không bao giờ mất. Test route admin/instructor
   (fake DB ném lỗi 23503 → 409).
5. `backend/migrations/README.md`: cập nhật "highest is"/"next" (test
   `test_migration_forward_policy.py:29–40`) + đoạn mô tả 324.

## 7. Kiểm tra production — **chờ anh Vinh cho phép chạy chỉ đọc**

```sql
BEGIN TRANSACTION READ ONLY;
-- P1: FK hiện tại + mọi FK trỏ vào writing_assignments
SELECT conrelid::regclass, conname, confdeltype, convalidated, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.writing_assignments'::regclass;
-- P2: nháp mồ côi (phải = 0)
SELECT count(*) FROM public.writing_drafts d
 WHERE NOT EXISTS (SELECT 1 FROM public.writing_assignments a WHERE a.id = d.assignment_id);
-- P3: phân bố
SELECT a.status, count(*), count(d.id) AS with_draft
  FROM public.writing_assignments a LEFT JOIN public.writing_drafts d ON d.assignment_id = a.id
 GROUP BY a.status ORDER BY 1;
-- P4: trigger nháp còn khoá dòng cha
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.writing_drafts'::regclass AND NOT tgisinternal;
-- P5: ledger
SELECT filename FROM public._schema_migrations ORDER BY filename DESC LIMIT 5;
ROLLBACK;
```

## 8. Tiêu chí chấp nhận trên staging

Tiền điều kiện: 324 apply bằng runner khoá advisory; backend đúng SHA. Dùng
học viên/bài E2E (`backend/scripts/staging_seed.py`), không dùng dữ liệu thật.

| # | Bước | Kỳ vọng |
| --- | --- | --- |
| AC-1 | Query P1 trên staging | FK `confdeltype='a'`, validated; không còn con CASCADE nào vào `writing_assignments`. |
| AC-2 | Đếm lại §2.2 | Số liệu không đổi so với ngay trước apply. |
| AC-3 | Admin tạo bài cho học viên E2E, học viên lưu nháp (PATCH draft), admin `DELETE /admin/writing/assignments/{id}` | 409 (do status `in_progress` hoặc do FK); nháp còn nguyên (`SELECT draft_text`). |
| AC-4 | Tạo bài `pending` không nháp; admin xoá | Thành công như trước. |
| AC-5 | Instructor E2E: bài của mình có nháp → `DELETE /instructor/assignments/{id}` | 409; nháp còn. Bài `in_progress` không nháp → 409 (status). Bài `pending` không nháp → 204. |
| AC-6 | Instructor xoá bài của instructor khác | 404 như cũ (owner filter). |
| AC-7 | Học viên submit bài (nháp bị xoá ở submit như thiết kế 037) | Submit thành công; không lỗi FK. |
| AC-8 | Dọn dữ liệu E2E (`staging_seed.py --cleanup`) | Hoạt động (xác nhận đường xoá auth user/students không bị FK chặn, hoặc ghi rõ cần xoá nháp trước). |

## 9. Rủi ro & phân loại

- **Change class: high-risk** (`specs/README.md`: schema migration; dữ liệu bài
  làm học viên). `risk: high`.
- Mất dữ liệu: migration không xoá gì; ngược lại giảm rủi ro mất nháp.
- Có thể chặn luồng hợp lệ: (a) cleanup E2E/purge học viên nếu thứ tự cascade
  khác dự đoán — giảm thiểu bằng test CI (T004) và purge RPC xoá nháp tường minh
  trước (xem spec học viên); (b) script vận hành xoá bài hàng loạt — sẽ nhận
  lỗi 23503 thay vì âm thầm xoá nháp (mong muốn).
- Bảo mật: không đổi quyền/RLS; tương thích 320.
- Phần A chưa có PR để đối chiếu — rủi ro lệch thông điệp/HTTP code.

## 10. Tasks

- [ ] T001 Duyệt spec (high-risk) lên `staging`; chốt số spec/migration khi merge.
- [ ] T002 Viết 324. `owns: backend/migrations/324_*`
- [ ] T003 Sửa 2 route + map 409. `owns: routers/admin_writing_assignments.py, routers/instructor.py`
- [ ] T004 Test tĩnh + Postgres (bao gồm xoá học viên một câu lệnh). `depends: T002`
- [ ] T005 README migrations. [P]
- [ ] T006 P1–P5 production (chờ anh Vinh cho phép chạy chỉ đọc).
- [ ] T007 Staging AC-1…AC-8; T008 production sau duyệt.

## 11. Chưa kiểm chứng

- Hành vi NO ACTION vs RESTRICT khi xoá học viên một câu lệnh — lập luận theo
  cơ chế RI của Postgres, **chưa chạy thử**.
- Mọi ghi `course_writing_drafts` có set `opened_at` hay không (đường lớp học).
- PR phần A: không tìm thấy.
- Production: chưa truy vấn.
