# Research record — ROLECHECK-0026 (Vietnamese, as approved)

> Approved by Vinh 2026-10-27 07:14 UTC+7. This is the reviewed Vietnamese
> draft, kept verbatim as the evidence record (file:line citations against
> `origin/staging@3aded02b`, read-only staging catalog/data queries on
> 2026-10-27). The canonical contract is `spec.md`; the locked migration
> number is **323**. Production read-only checks P1–P6 (§5.2) were run on
> 2026-10-27 ~07:19 UTC+7 with Vinh's permission; results are recorded in §5.2.


# A-05 — Tạo giảng viên thất bại vì hai CHECK trên `users.role` mâu thuẫn

> Hồ sơ nghiên cứu (bản nháp gốc đã được duyệt), gộp spec / plan / tasks / verification / rollout vào một file
> theo `specs/_templates/*` và mẫu `specs/0022-client-write-privilege-lockdown/`.
> Mọi nội dung dưới đây được đối chiếu với code ở `origin/staging@3aded02b` và
> catalog staging (`zjphffoujxkpltixsbzj`, chỉ SELECT) ngày 2026-10-27 (giờ VN).
> **Production (`huwsmtubwulikhlmcirx`) KHÔNG được truy vấn.**
> **Chưa chạy bất kỳ SQL ghi/DDL nào, kể cả SQL migration đề xuất ở §6.**

---

## 1. Problem (vấn đề)

Admin không thể biến một tài khoản thành giảng viên (`users.role = 'instructor'`).
Bảng `public.users` hiện có **hai** CHECK trên cột `role`; Postgres yêu cầu một
row thoả **tất cả** CHECK, nên tập giá trị thực sự được phép là **giao** của hai
tập:

| Constraint | Tập cho phép | Nguồn |
| --- | --- | --- |
| `chk_users_role` | `user, student, instructor, admin` | migration 106 (trong repo) |
| `users_role_check` | `user, admin` | tạo ngoài repo (dashboard / schema gốc) |
| **Giao (hiệu lực thực tế)** | **`user, admin`** | |

⇒ Mọi `INSERT/UPDATE` đặt `role = 'instructor'` (hoặc `'student'`) đều bị
Postgres từ chối với `23514 check_violation ... "users_role_check"`, kể cả khi
chạy bằng `service_role`. Bằng chứng gián tiếp trên staging: 0 row
`instructor`, 0 row `student` (xem §5).

## 2. Hai CHECK constraint hiện tại

### 2.1 Định nghĩa live trên staging (đã chạy, chỉ đọc)

```sql
SELECT c.conrelid::regclass AS tbl, c.conname, c.convalidated,
       pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
 WHERE c.contype = 'c'
   AND c.connamespace = 'public'::regnamespace
   AND (c.conrelid = 'public.users'::regclass
        OR pg_get_constraintdef(c.oid) ILIKE '%role%')
 ORDER BY 1, 2;
```

Kết quả staging (2026-10-27):

| tbl | conname | convalidated | def |
| --- | --- | --- | --- |
| users | `chk_users_role` | true | `CHECK ((role = ANY (ARRAY['user'::text, 'student'::text, 'instructor'::text, 'admin'::text])))` |
| users | `users_role_check` | true | `CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))` |
| access_codes | `chk_access_codes_grants_role` | true | `CHECK (((grants_role IS NULL) OR (grants_role = 'instructor'::text)))` (không liên quan bug, chỉ để đủ bức tranh) |

Đây là **toàn bộ** CHECK trên `public.users` ở staging (không còn CHECK nào khác).

Cột `users.role` trên staging: `text`, **nullable** (`is_nullable = YES`),
`DEFAULT 'user'::text`. Bảng thuộc owner `postgres`. PostgreSQL 17.6.

### 2.2 Nguồn gốc trong repo

- **`chk_users_role`** — `backend/migrations/106_instructor_role_foundation.sql`
  - dòng 84–88: lý do gồm `'user'` (DB đang có nhiều row `user`, app
    `_VALID_ROLES` thiếu `user`);
  - dòng 92–96: `DROP CONSTRAINT IF EXISTS chk_users_role` + `ADD CONSTRAINT
    chk_users_role CHECK (role IN ('user','student','instructor','admin')) NOT VALID`;
  - dòng 98–102: query chẩn đoán `SELECT role, count(*) ... GROUP BY role`;
  - dòng 106: `ALTER TABLE users VALIDATE CONSTRAINT chk_users_role;`
  - dòng 211: rollback tham khảo `DROP CONSTRAINT IF EXISTS chk_users_role`.
  - Migration 106 **không** đụng tới `users_role_check` → đây là gốc mâu thuẫn:
    106 thêm CHECK rộng hơn nhưng không gỡ CHECK hẹp cũ.
- **`users_role_check`** — **không có migration nào trong `backend/migrations/`
  tạo hoặc sửa nó** (`rg users_role_check` trên toàn repo; bảng `public.users`
  cũng không được `CREATE TABLE` trong migration nào — được tạo ngoài repo).
  Các chỗ repo nhắc tới nó:
  - `backend/scripts/staging_seed.py:109–112`: "users_role_check only allows
    'user' | 'admin' (production truth)" — identity instructor phải seed bằng
    `role='user'` (cũng `staging_seed.py:14`).
  - `backend/migrations/README.md:55`: "`users_role_check` is intentionally
    untouched" (ghi chú của 320).
  - `specs/0022-client-write-privilege-lockdown/spec.md:62` (Non-goals):
    "Dropping `users_role_check` (batch 3, after this fix)".
  - `specs/0022-client-write-privilege-lockdown/plan.md:40`: "`users_role_check`
    and `chk_users_role` are untouched."
  - `backend/tests/test_migration_320_client_write_lockdown.py:165–166`: assert
    file 320 không chứa `users_role_check` / `DROP CONSTRAINT` ("Out of scope for
    this PR (batch 3)").
  - ⇒ Spec này chính là "batch 3" mà SECWRITE-0022 để lại.

### 2.3 Drift so với migration

- `chk_users_role`: live staging **khớp** migration 106 (cùng tập 4 giá trị, đã
  VALIDATED). Không drift.
- `users_role_check`: **không có trong repo** → bản thân nó là drift
  (schema-only-in-DB). Comment ở `staging_seed.py:109` gọi đó là "production
  truth", và repo có `backend/scripts/staging_clone_schema_from_prod.sh` (được
  `test_migration_forward_policy.py` tham chiếu) — **suy luận** constraint này
  có cả ở production, nhưng **chưa kiểm chứng** vì không được truy vấn prod.
  Query xác nhận cho production nằm ở §5.2.

## 3. Tập role đúng

**Kết luận: `{'user', 'student', 'instructor', 'admin'}`** — đúng bằng
`chk_users_role` (106). Cột vẫn nullable như hiện tại (NULL không vi phạm CHECK;
xem Open questions).

Căn cứ từ code (origin/staging):

| Nơi | Giá trị | Trích dẫn |
| --- | --- | --- |
| `require_admin` | chỉ `admin` | `backend/routers/admin.py:82–101` (`role != "admin"` → 403) |
| `require_instructor` | `instructor` hoặc `admin` | `backend/routers/admin.py:104–129` (`not in ("instructor","admin")` → 403) |
| PATCH role allow-list | `admin, instructor, student` | `backend/routers/admin.py:718` `_VALID_ROLES`, dùng ở 824/841 |
| Tạo row mới (`/auth/me`, `/auth/activate`) | `user` | `backend/routers/auth.py:204`, `auth.py:481` |
| Promote qua access code | `instructor` | `backend/routers/auth.py:449–462, 503–506` |
| Query giảng viên | `instructor` | `backend/routers/admin_instructors.py:36`, `routers/auth.py:533–537`, `routers/instructor.py:118`, `writing_student.py:1153` |
| RLS helper | `instructor` | `106_instructor_role_foundation.sql:124–133` `is_current_user_instructor()` |
| Response model admin | `user, student, instructor, admin` | `backend/models/admin_users.py:37–40` ("`user` is a validated legacy database value; the frontend deliberately normalizes it to the learner-facing `student` role") |
| Frontend type / select | `admin, instructor, student` | `frontend/app/(authed-admin-users)/admin/users/admin-user-types.ts:7, 63`; `frontend/lib/admin-users-model.mjs:1, 87` (role lạ/`user` → hiển thị `student`); legacy `frontend/public/js/admin-users.js:25` |

Lý giải:
- `instructor` bắt buộc phải hợp lệ: toàn bộ bề mặt W-2…W-8 (router
  `/instructor`, metrics `/admin/instructors`, enroll-chain, grading tier) dựa
  trên `users.role = 'instructor'`.
- `user` phải giữ: là giá trị mặc định của cột và mọi row mới do backend tạo;
  staging có 18 row `user`.
- `student` phải giữ: là giá trị backend ghi khi admin chọn "student" trong
  dropdown (`_VALID_ROLES`), là giá trị frontend dùng để hiển thị learner, và có
  trong response model. Bỏ `student` sẽ làm "hạ instructor về student" (đường
  duy nhất UI có để gỡ quyền GV) tiếp tục lỗi.
- `admin`: hiển nhiên.
- Không có tên "teacher"/"giang_vien" nào khác được ghi vào `users.role` (chỉ
  thấy "giảng viên" ở chuỗi UI/HTTP message).
- Lưu ý ngữ nghĩa: `user` và `student` đều là "learner"; `require_*` không phân
  biệt chúng. Hợp nhất `student`→`user` là việc riêng (Non-goal).

## 4. Đường tạo giảng viên end-to-end & điểm lỗi

Không có endpoint nào tạo Supabase auth user cho giảng viên (chỉ
`backend/scripts/staging_seed.py:86` gọi `auth.admin.create_user`, dành cho E2E
staging). GV tự đăng nhập Supabase Auth; `GET /auth/me`
(`backend/routers/auth.py:174`, insert `role='user'`, `is_active=False` ở
dòng ~198–206) tạo row `public.users` với `role='user'` — hợp lệ với cả hai
CHECK. Sau đó có **hai** đường nâng lên `instructor`:

### 4.1 Đường A — Admin đổi vai trò trong trang Người dùng (đường UI chính)

1. UI: `frontend/app/(authed-admin-users)/admin/users/page.tsx` →
   `admin-users-panel.tsx:265–272` (select vai trò, options = `ROLES` từ
   `admin-user-types.ts:63`) → `askRoleChange` `admin-users-panel.tsx:122–138`
   → `window.api.patch('/admin/users/{id}/role', { role: 'instructor' })`
   (dòng 134). (UI legacy: `frontend/public/js/admin-users.js:198–205`.)
2. API: `PATCH /admin/users/{user_id}/role` → `admin_set_user_role`
   `backend/routers/admin.py:827–861`: `require_admin` → kiểm `_VALID_ROLES`
   (pass với `instructor`) → chặn tự hạ quyền.
3. DB: `supabase_admin.table("users").update({"role": role}).eq("id", user_id)`
   **`admin.py:852–856`** — chạy bằng `service_role`.
   - Trigger 320 `trg_users_guard_privileged_columns` (BEFORE UPDATE) **cho qua**
     vì `current_user`/JWT role = `service_role` (`320_…sql:306–309`).
   - CHECK được đánh giá sau BEFORE trigger, **không role nào bypass được**:
     `chk_users_role` pass, **`users_role_check` FAIL** (23514).
4. **Điểm lỗi:** exception bị bắt ở `admin.py:858–859` →
   `HTTPException(500, "Role update failed: …users_role_check…")`. UI hiện
   banner lỗi (mutate → `setBanner({kind:'error'})`, `admin-users-panel.tsx:115–116`).
   Không có ghi gì vào DB.
   - Cùng lỗi khi đổi bất kỳ ai sang `student` (kể cả hạ instructor về student).

### 4.2 Đường B — Mã kích hoạt promote (W-2, email-bound)

1. Mint: `POST /admin/access-codes/generate` (`admin.py:1056–1110`) với
   `grants_role='instructor'` + `intended_email` (model `admin.py:432–436`,
   validate `admin.py:1077–1082`). **Frontend admin hiện không gửi
   `grants_role`** (chỉ có trong `frontend/types/api.d.ts`; `rg` trong
   `admin-access-codes-panel.tsx` không thấy) → đường này chỉ dùng được qua API
   trực tiếp. Staging: 0 mã `grants_role='instructor'`, 0 audit
   `promote_role*`.
2. Redeem: `POST /auth/activate` (`backend/routers/auth.py:383`): kiểm email
   (449–462) → upsert row `role='user'` (472–490) → gộp
   `update_fields["role"]="instructor"` vào **cùng** update kích hoạt (503–506).
3. **Điểm lỗi:** `supabase_admin.table("users").update(update_fields)`
   **`auth.py:508`** → `users_role_check` fail → 500 "Lỗi khi kích hoạt tài
   khoản" (`auth.py:509–513`). Vì role nằm trong cùng UPDATE, **cả việc kích
   hoạt (`is_active`, `permissions`) cũng không được ghi**; Step 4 (claim mã,
   `auth.py:665`) không chạy → mã vẫn còn dùng được (đúng thiết kế fail-closed).

### 4.3 Root cause

Schema, không phải code: `users_role_check` (ngoài repo, `{user, admin}`) mâu
thuẫn với `chk_users_role` (mig 106, `{user, student, instructor, admin}`);
106 thêm CHECK mới mà không gỡ CHECK cũ. Điểm nổ cụ thể: `admin.py:852–856`
(đường A) và `auth.py:508` (đường B).

### 4.4 Code cần đổi ngoài migration

Bắt buộc: **không có** — cả hai đường đã ghi đúng giá trị; chỉ DB từ chối.
Nên làm cùng PR (thuộc tasks, không đổi hành vi):
- `backend/migrations/README.md`: cập nhật "highest is `NNN`" / "next … `NNN+1`"
  (bị `backend/tests/test_migration_forward_policy.py:29–40` kiểm), thêm đoạn
  mô tả migration, sửa câu "`users_role_check` is intentionally untouched"
  (dòng 55) thành tham chiếu tới migration mới.
- `backend/scripts/staging_seed.py:14, 109–112`: sửa comment đã lỗi thời (có thể
  giữ seed `role='user'` cho instructor để E2E vẫn đi đường promote).
- Test mới `backend/tests/test_migration_<NNN>_users_role_single_check.py`
  (tĩnh + Postgres nếu CI có PG, theo mẫu `test_migration_320_*`).
- Tuỳ chọn (không bắt buộc): bỏ gói `str(exc)` thô trong 500 ở `admin.py:859`
  (lộ tên constraint ra client). Ngoài phạm vi nếu muốn giữ PR tối thiểu.

## 5. Kiểm tra dữ liệu hiện có

### 5.1 Staging (đã chạy, chỉ đọc, 2026-10-27)

```sql
-- Q1: phân bố role
SELECT role, count(*) AS n FROM public.users GROUP BY role ORDER BY 2 DESC;

-- Q2: row vi phạm tập mới + các dạng bẩn
SELECT count(*) FILTER (WHERE role IS NOT NULL
                          AND role NOT IN ('user','student','instructor','admin')) AS violates_new_set,
       count(*) FILTER (WHERE role IS NULL)                         AS role_null,
       count(*) FILTER (WHERE role <> lower(btrim(role)))           AS non_canonical_case_or_space,
       count(*) FILTER (WHERE role IN ('student','instructor'))     AS student_or_instructor,
       count(*)                                                     AS total
  FROM public.users;
```

| Q | Kết quả staging |
| --- | --- |
| Q1 | `user` = 18, `admin` = 6 (không có `student`, `instructor`, NULL) |
| Q2 | violates_new_set = **0**, role_null = 0, non_canonical = 0, student_or_instructor = 0, total = 24 |

Đọc thêm (đã chạy): `access_codes` có `grants_role='instructor'` = 0; không có
audit `promote_role`/`promote_role_rejected`; Postgres logs 24h gần nhất không
có dòng nào chứa `users_role_check`/`chk_users_role` (log trống → **không** xác
nhận được thông báo lỗi gốc của bot từ log).

### 5.2 Production — đã chạy chỉ đọc (P1–P6) với sự cho phép của anh Vinh, 2026-10-27 ~07:19 UTC+7

Đã chạy P1–P6 (chỉ đọc) trên production ngày 2026-10-27 khoảng 07:19 UTC+7,
với sự cho phép của anh Vinh. Kết quả (chỉ số đếm, không PII):

| Q | Kết quả production |
| --- | --- |
| P1 | Có cả hai: `chk_users_role` (`user, student, instructor, admin`, validated, chuỗi `pg_get_constraintdef` trùng đúng chuỗi chuẩn ở §6.2) và `users_role_check` (`user, admin`, validated). |
| P2 | `role` kiểu `text`, nullable, `DEFAULT 'user'`. |
| P3 | `user` = 125, `admin` = 1. |
| P4 | violates_new_set = **0**, role_null = 0, non_canonical = 0, total = 126. |
| P5 | `trg_users_guard_privileged_columns` có và bật (`tgenabled = 'O'`). |
| P6 | Ledger cao nhất = `320`. |

Kết luận: **không có drift giữa production và staging**; theo dữ liệu hiện tại
migration 323 an toàn trên production (precheck, nhánh tạo lại constraint là
no-op, postcondition "đúng một CHECK" và kiểm trigger 320 đều sẽ qua).
Trước khi apply production vẫn chạy lại P1/P4/P5 ngay trước đó.

Truy vấn đã dùng (transaction read-only):

```sql
BEGIN TRANSACTION READ ONLY;

-- P1: định nghĩa CHECK live trên users (xác nhận users_role_check có ở prod, phát hiện drift)
SELECT c.conname, c.convalidated, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
 WHERE c.conrelid = 'public.users'::regclass AND c.contype = 'c'
 ORDER BY 1;

-- P2: cột role
SELECT data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role';

-- P3: phân bố role
SELECT role, count(*) AS n FROM public.users GROUP BY role ORDER BY 2 DESC;

-- P4: row vi phạm tập mới (phải = 0 trước khi apply)
SELECT count(*) FILTER (WHERE role IS NOT NULL
                          AND role NOT IN ('user','student','instructor','admin')) AS violates_new_set,
       count(*) FILTER (WHERE role IS NULL)                     AS role_null,
       count(*) FILTER (WHERE role <> lower(btrim(role)))       AS non_canonical_case_or_space,
       count(*)                                                 AS total
  FROM public.users;

-- P5: trigger 320 đã có và bật
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
  FROM pg_trigger
 WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal;

-- P6: ledger — số migration cao nhất đã apply
SELECT filename FROM public._schema_migrations ORDER BY filename DESC LIMIT 5;

ROLLBACK;
```

Nếu P4 > 0: **dừng**, liệt kê `SELECT id, email, role FROM public.users WHERE
role IS NOT NULL AND role NOT IN (...)` (cũng chờ cho phép) và quyết định sửa
data hay mở rộng tập — migration đề xuất sẽ tự abort (fail-loud) trong trường
hợp này.

## 6. Migration forward đề xuất

### 6.1 Số migration

- Repo `origin/staging`: max = `320` (README.md:23–24 "highest is `320` … next
  `321`").
- Ledger staging `public._schema_migrations`: cao nhất = `320_client_write_privilege_lockdown.sql`.
- **Nhưng** `321` và `322` đã được giữ chỗ bởi PR draft đang mở base `staging`:
  #1727 `321_writing_grade_ratings_feedback_version.sql`, #1720
  `322_ai_model_overrides_and_failures.sql` (không có branch remote nào khác có
  323+).
- ⇒ Đề xuất **`323_users_role_single_check.sql`**. Nếu thứ tự merge thay đổi,
  lấy số kế tiếp trên max tại thời điểm merge (README: không lấp gap, không tái
  dùng số). Không cần dòng trong `forward-policy.tsv` (migration active bình
  thường).

### 6.2 SQL (chưa chạy ở đâu cả)

```sql
-- Migration: 323_users_role_single_check.sql
--
-- A-05 / ROLECHECK-0026 (batch 3 của SECWRITE-0022). public.users có hai CHECK
-- trên role: chk_users_role (106: user|student|instructor|admin) và
-- users_role_check (ngoài repo: user|admin). Giao = {user, admin} nên không thể
-- gán instructor/student, kể cả bằng service_role. Giữ MỘT constraint đúng
-- (chk_users_role) và gỡ users_role_check.
--
-- Tương thích 320: không đổi trigger trg_users_guard_privileged_columns, không
-- GRANT gì cho anon/authenticated, không đổi policy. Client vẫn không có
-- INSERT/UPDATE trên users và trigger vẫn chặn đổi role từ client role.
-- Không ghi/sửa data. Idempotent.
--
-- Read-only pre-check: xem specs ROLECHECK-0026 §5 (P1–P6).
-- ROLLBACK: xem §6.3 — chỉ an toàn khi không còn row role IN ('student','instructor').

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Fail-loud nếu có row ngoài tập chuẩn (không tự sửa data).
DO $$
DECLARE
    bad BIGINT;
BEGIN
    SELECT count(*) INTO bad
      FROM public.users
     WHERE role IS NOT NULL
       AND role NOT IN ('user', 'student', 'instructor', 'admin');
    IF bad > 0 THEN
        RAISE EXCEPTION 'users_role_outside_canonical_set'
            USING DETAIL = format('%s public.users rows have a role outside user|student|instructor|admin', bad);
    END IF;
END $$;

-- 2. Đảm bảo constraint chuẩn tồn tại với ĐÚNG định nghĩa. Bình thường (staging
--    hiện tại) đã có và đã VALIDATED → nhánh IF bị bỏ qua. Chỉ tạo lại nếu thiếu
--    hoặc drift; NOT VALID rồi VALIDATE ngay sau (bảng nhỏ; trong cùng
--    transaction nên lợi ích lock của NOT VALID chủ yếu là tách lỗi rõ ràng).
DO $$
DECLARE
    current_def TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO current_def
      FROM pg_constraint c
     WHERE c.conrelid = 'public.users'::regclass
       AND c.conname = 'chk_users_role';
    IF current_def IS DISTINCT FROM
       'CHECK ((role = ANY (ARRAY[''user''::text, ''student''::text, ''instructor''::text, ''admin''::text])))' THEN
        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS chk_users_role;
        ALTER TABLE public.users
            ADD CONSTRAINT chk_users_role
            CHECK (role IN ('user', 'student', 'instructor', 'admin')) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.users VALIDATE CONSTRAINT chk_users_role;  -- no-op nếu đã validated

-- 3. Gỡ constraint mâu thuẫn (tạo ngoài repo).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- 4. Postcondition: đúng MỘT CHECK trên cột role, đúng tên/định nghĩa, đã
--    validated; trigger 320 vẫn còn và đang bật.
DO $$
DECLARE
    role_attnum SMALLINT;
    n_checks INT;
    ok_canonical BOOLEAN;
BEGIN
    SELECT attnum INTO role_attnum
      FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attname = 'role' AND NOT attisdropped;

    SELECT count(*) INTO n_checks
      FROM pg_constraint c
     WHERE c.conrelid = 'public.users'::regclass
       AND c.contype = 'c'
       AND role_attnum = ANY (c.conkey);

    SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.users'::regclass
           AND c.conname = 'chk_users_role'
           AND c.convalidated
           AND pg_get_constraintdef(c.oid) =
               'CHECK ((role = ANY (ARRAY[''user''::text, ''student''::text, ''instructor''::text, ''admin''::text])))'
    ) INTO ok_canonical;

    IF n_checks <> 1 OR NOT ok_canonical THEN
        RAISE EXCEPTION 'users_role_single_check_postcondition_failed'
            USING DETAIL = format('role CHECK count=%s, canonical=%s', n_checks, ok_canonical);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.users'::regclass
           AND tgname = 'trg_users_guard_privileged_columns'
           AND tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'users_privileged_column_guard_missing'
            USING DETAIL = 'Migration 320 trigger must exist and be enabled before 323.';
    END IF;
END $$;

COMMIT;
```

Ghi chú thiết kế:
- **Vì sao giữ `chk_users_role` thay vì tạo tên mới:** nó đã đúng tập, đã
  validated trên staging và là constraint duy nhất có nguồn trong repo (106); giữ
  nguyên tránh rewrite/scan và giữ rollback 106 (dòng 211) vẫn đúng tên.
- **Thứ tự:** đảm bảo constraint đúng (bước 2) **trước** khi drop constraint sai
  (bước 3) — trong cùng transaction nên không có khoảnh khắc nào `users.role`
  không có CHECK.
- **Lock:** `DROP CONSTRAINT` (và `ADD … NOT VALID` nếu chạy nhánh drift) lấy
  `ACCESS EXCLUSIVE` trên `users` tới hết transaction; `lock_timeout = 5s` để
  migration fail nhanh thay vì xếp hàng chặn mọi request đăng nhập. Nếu lỗi
  timeout: chạy lại lúc vắng.
- **Không xoá cũng không đổi `role` của row nào; không đổi `NULL`-ability /
  default** (Non-goal).
- Runner (`backend/scripts/apply_migration_locked.sql`) `\i` file rồi ghi
  ledger; file tự `BEGIN/COMMIT` giống 320.
- Kiểm tra tĩnh nên thêm: test 320 dòng 165–166 chỉ đọc file 320 → không ảnh hưởng.

### 6.3 Tương tác với trigger 320 (`trg_users_guard_privileged_columns`)

Đọc từ `backend/migrations/320_client_write_privilege_lockdown.sql`:
- Hàm `fn_guard_users_privileged_columns()` (dòng 290–317), SECURITY INVOKER,
  `BEFORE UPDATE … FOR EACH ROW` (321–324). Chỉ UPDATE, không INSERT/DELETE.
- Cột được phép đổi bởi client: `display_name, target_band, exam_date,
  self_level, preferred_topics, onboarding_completed, timezone, weekly_goal,
  notification_email, updated_at` (296–299). **Mọi cột khác** — gồm `role`,
  `is_active`, `permissions`, `feature_flags`, `access_code_used`, `email`,
  `id` và cột thêm sau — bị cấm với client: `RAISE 'users_privileged_column_change_forbidden'`
  ERRCODE `42501` (310–314).
- "Client" = `current_user IN ('anon','authenticated')` **hoặc** JWT role
  (`request.jwt.claim.role` / `request.jwt.claims->>'role'`) ∈ (`anon`,
  `authenticated`) (300–309) → chặn cả wrapper SECURITY DEFINER gọi bằng JWT
  client. `service_role` (FastAPI `supabase_admin`) và owner/migration role
  **được bỏ qua** (return NEW sớm).
- Kèm theo: client mất mọi INSERT/UPDATE/DELETE trên `users` (bước 1 + 3 của
  320). Staging xác nhận: `anon`: SELECT; `authenticated`: SELECT;
  `service_role`: đủ quyền. Policy "Users can update own data" = `UPDATE TO
  authenticated USING/WITH CHECK (auth.uid() = id)`; ACL hàm guard
  `{postgres=X, service_role=X}`.
- ⇒ Migration 323 **không làm yếu** 320: nó chỉ mở rộng tập *giá trị* hợp lệ;
  *ai* được ghi `role` vẫn do privilege + trigger quyết định (chỉ
  service_role/owner, tức `require_admin` ở đường A và mã email-bound ở đường
  B). CHECK áp dụng cho mọi role, nên sau 323 `service_role` vẫn không ghi được
  giá trị rác (`'superadmin'`…).

### 6.4 Rollback

```sql
-- CHỈ chạy khi điều kiện an toàn bên dưới đúng.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.users WHERE role IN ('student', 'instructor')) THEN
        RAISE EXCEPTION 'rollback_unsafe_rows_exist'
            USING DETAIL = 'users_role_check(user|admin) would reject existing student/instructor rows.';
    END IF;
END $$;
ALTER TABLE public.users
    ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
COMMIT;
```

Khi nào an toàn:
- Chỉ khi **0 row** `role IN ('student','instructor')` (query trong block). Nếu
  đã có GV thật, rollback bằng `NOT VALID` cũng **không** an toàn: CHECK NOT
  VALID vẫn kiểm mọi row được UPDATE → mọi update về sau trên row GV (kích hoạt,
  đổi permissions…) sẽ 500.
- Rollback = **tái tạo bug A-05** (lại không tạo được GV). Chỉ dùng nếu 323 gây
  sự cố ngoài dự kiến; ưu tiên forward-fix.
- Không bao giờ rollback bằng cách động vào trigger/grant của 320.
- Rollback chỉ bằng migration forward mới (README: forward-only), không xoá
  dòng ledger.

## 7. Scope / Non-goals / Requirements

### Scope
- Một migration forward gỡ `users_role_check`, giữ duy nhất `chk_users_role`.
- Cập nhật README migrations, comment `staging_seed.py`, test migration mới.

### Non-goals
- Hợp nhất `student`↔`user`, đổi `NOT NULL`/default của `role`.
- UI mint mã `grants_role='instructor'`.
- Đổi trigger/grant/policy của 320; đổi `require_admin`/`require_instructor`.
- Bất kỳ data rewrite nào.

### Requirements
- **FR-001:** Admin (qua `PATCH /admin/users/{id}/role`) đặt được role
  `instructor` và `student` cho user khác; thành công trả 200 và DB phản ánh.
- **FR-002:** Mã `grants_role='instructor'` đúng email khi kích hoạt nâng user
  lên `instructor` và kích hoạt tài khoản trong cùng một update.
- **FR-003:** `public.users.role` có đúng một CHECK
  `role IN ('user','student','instructor','admin')`, validated; giá trị ngoài
  tập bị DB từ chối với mọi role (kể cả service_role).
- **FR-004:** Client role (anon/authenticated, gồm user vừa được làm GV) không
  thể đổi `role` của chính mình hay người khác qua PostgREST; trigger 320 và
  privilege 320 giữ nguyên.
- **FR-005:** Row hiện có không bị đổi; đăng nhập/`/auth/me`/activate thường
  của user cũ không đổi hành vi.

## 8. Tiêu chí chấp nhận trên staging (Verification)

Tiền điều kiện: PR merged vào `staging`, migration 323 apply bằng runner khoá
advisory; backend staging đúng SHA. Dùng identity E2E namespace riêng
(`staging_seed.py`) — **không** dùng account người thật.

| # | Bước | Kỳ vọng |
| --- | --- | --- |
| AC-1 (FR-003) | Chạy query §2.1 trên staging | Trên `users` chỉ còn `chk_users_role`, `convalidated = true`, def đúng 4 giá trị; không còn `users_role_check`. `_schema_migrations` có `323_users_role_single_check.sql`. |
| AC-2 (FR-005) | Chạy lại Q1/Q2 §5.1 | Phân bố role **y hệt trước khi apply** (staging hiện: user 18, admin 6, tổng 24 — hoặc giá trị chụp ngay trước apply). |
| AC-3 (FR-001) | Đăng nhập admin E2E → `/admin/users` → đổi user E2E "instructor" (đang `user`, hiển thị `student`) sang `instructor` → xác nhận | Banner "Đã cập nhật vai trò thành instructor."; API 200 `{ok:true, role:"instructor"}`; `SELECT role FROM users WHERE id=…` = `instructor`; user đó xuất hiện ở `GET /admin/instructors`. |
| AC-4 (FR-001) | User GV đó đăng nhập → vào `/instructor` | Qua `require_instructor` (không 403). |
| AC-5 (FR-001) | Admin đổi GV đó về `student` | 200; DB `student`; `/instructor` giờ 403. |
| AC-6 (FR-002) | Qua API admin mint 1 mã `grants_role='instructor'`, `intended_email` = email E2E; user E2E (role `user`, chưa kích hoạt) `POST /auth/activate` | 200; DB: `role='instructor'`, `is_active=true`; `access_code_audit` có `promote_role`; mã `is_used=true`. |
| AC-7 (FR-002, âm) | Activate mã đó bằng email khác | 403 "Email không khớp…"; audit `promote_role_rejected`; mã vẫn chưa dùng; role không đổi. |
| AC-8 (FR-004) | Bằng JWT của user `student` E2E: `PATCH /rest/v1/users?id=eq.<self>` body `{"role":"admin"}` (và `{"role":"instructor"}`) với anon key | Bị từ chối (401/403 permission denied — không có UPDATE privilege); DB không đổi. |
| AC-9 (FR-004) | Bằng JWT của **GV vừa tạo**: PATCH `{"role":"admin"}` lên chính mình, và lên user khác | Bị từ chối; DB không đổi. |
| AC-10 (FR-004) | Query catalog: trigger `trg_users_guard_privileged_columns` `tgenabled='O'`; `has_table_privilege('authenticated','public.users','UPDATE')` = false; 4 query read-only ở header 320 trả 0 dòng | Đúng như mô tả. |
| AC-11 (FR-003) | `PATCH /admin/users/{id}/role` với `role="superadmin"` | 400 từ `_VALID_ROLES` (không tới DB). (Kiểm DB-level bằng test Postgres CI, không thử ghi tay trên staging.) |
| AC-12 (FR-005) | Admin tự hạ quyền mình | Vẫn 400 "Không thể tự hạ quyền admin của chính mình." |
| AC-13 (FR-005) | User cũ (`user`) đăng nhập, `/auth/me`, sửa profile `PATCH /auth/profile` | Không đổi hành vi, 200. |
| AC-14 | Dọn dẹp: `staging_seed.py --ns <ns> --cleanup` | Identity E2E bị xoá; Q1 quay về phân bố trước test. |

Test tự động đề xuất (CI):
- Tĩnh: file 323 chứa `DROP CONSTRAINT IF EXISTS users_role_check`, giữ đúng 4
  giá trị, có postcondition và kiểm trigger 320, không có `GRANT`/`DROP TRIGGER`.
- Postgres (nếu harness như `test_migration_320_*` có sẵn): tạo `users` với cả
  hai CHECK + trigger 320 → apply 323 → `UPDATE role='instructor'` dưới
  `service_role` OK; dưới `SET ROLE authenticated` + claims → `42501`/permission
  denied; `role='bogus'` → `23514`; chạy 323 lần hai = no-op.
- `test_migration_forward_policy.py` pass sau khi sửa README.

## 9. Rủi ro bảo mật & phân loại thay đổi

**Change class: `high-risk`** (`specs/README.md` mục Risk profiles: "auth/RLS…,
schema migrations" → cần spec/plan/tasks/verification + rollout; đường dẫn
migration bị CI kiểm, không hạ class qua PR metadata). Đề xuất `risk: high`.

Rủi ro & giảm thiểu:
1. **Leo thang quyền qua role mới hợp lệ.** Mở `instructor` làm tăng số người
   qua `require_instructor`. Ai được ghi `role` không đổi: chỉ `service_role`
   (FastAPI) sau `require_admin`, hoặc mã email-bound do admin mint. Client không
   có UPDATE/INSERT trên `users` + trigger 320 → không tự leo thang. AC-8/9/10
   chứng minh.
2. **Phụ thuộc 320.** Nếu 320 chưa có ở môi trường đích, mở thêm role sẽ kết
   hợp với lỗ F01 cũ (client tự set role). 323 abort nếu thiếu trigger 320 (bước
   4). Production: 320 được báo là đã chạy (theo brief) — xác nhận bằng P5/P6
   trước khi apply.
3. **Drift production.** `users_role_check` ở prod chưa xác minh; có thể có
   CHECK khác tên. Postcondition "đúng 1 CHECK trên cột role" sẽ abort nếu prod
   có CHECK lạ thứ ba → cần P1 trước.
4. **Lock trên `users`.** ACCESS EXCLUSIVE ngắn; `lock_timeout` 5s.
5. **Lộ thông tin lỗi.** `admin.py:859` trả `str(exc)` (tên constraint) cho
   admin — thấp, chỉ admin thấy.
6. **Rollback tái tạo bug / phá row GV** (§6.4).
7. **Instructor isolation** (cross-tenant) phụ thuộc route-filter W-3/W-4 và RLS
   instructor-own (106) — lần đầu có GV thật trên staging sẽ thực sự thử các
   đường này; nên chạy `backend/tests/test_instructor_routes_isolation.py` và
   journey 2 GV trước khi tạo GV thật ở production.

## 10. Plan / Tasks / Rollout

### Tasks (thứ tự phụ thuộc)
- [ ] T001 Merge spec này (approved) lên `staging` trước implementation (quy
  trình high-risk). Chốt số spec + số migration tại thời điểm merge.
- [ ] T002 Viết `backend/migrations/323_users_role_single_check.sql` (§6.2).
  `owns: backend/migrations/323_*`. `depends: T001`
- [ ] T003 Cập nhật `backend/migrations/README.md` (highest/next, đoạn mô tả,
  dòng 55). `depends: T002`
- [ ] T004 Test tĩnh + Postgres cho 323. `owns: backend/tests/test_migration_323_*`. `depends: T002`
- [ ] T005 Sửa comment `backend/scripts/staging_seed.py:14,109–112`. [P]
- [x] T006 Chạy P1–P6 ở production (chỉ đọc, anh Vinh cho phép, 2026-10-27 ~07:19 UTC+7; kết quả §5.2).
- [ ] T007 Apply staging bằng runner khoá advisory → AC-1…AC-14. `depends: T002–T005`
- [ ] T008 Apply production (sau T006 sạch + T007 PASS + anh Vinh duyệt). Sau
  apply: P1, P3 lặp lại; AC-3 với một account GV thật do anh Vinh chỉ định.

### Rollout
- Không cần đồng bộ backend: code hiện tại đã đúng; migration có thể apply độc
  lập (thứ tự với 321/322 không quan trọng về logic).
- Staging trước, production sau; mỗi bước dùng `backend/scripts/apply_migrations.sh`
  (DRY_RUN trước).
- Observability: theo dõi 500 "Role update failed" / "Lỗi khi kích hoạt tài
  khoản" (phải về 0 với role hợp lệ); `access_code_audit` action `promote_role`.

### Verification (bảng theo template)

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | AC-3, AC-4, AC-5 (journey staging) | PENDING |
| FR-002 | AC-6, AC-7 | PENDING |
| FR-003 | AC-1, AC-11, test Postgres CI | PENDING |
| FR-004 | AC-8, AC-9, AC-10 | PENDING |
| FR-005 | AC-2, AC-12, AC-13 | PENDING |

## 11. Open questions

1. Có hợp nhất `student` → `user` (một giá trị learner) không? Hiện giữ cả hai
   để không phá `_VALID_ROLES`/UI.
2. Có đặt `role NOT NULL` không? Staging 0 NULL; prod chưa biết (P4). Không làm
   trong spec này.
3. Có thêm UI admin để mint mã `grants_role='instructor'` không? (Đường B hiện
   chỉ có qua API.)
4. ~~Xác nhận `users_role_check` có ở production~~ — đã xác nhận 2026-10-27 (P1, §5.2): có, cùng định nghĩa với staging.
5. Thông báo lỗi nguyên văn mà Assignment Tracker bot ghi nhận cho A-05 — không
   tìm thấy trong repo, inbox bot, hay Postgres log 24h của staging.

## 12. Những gì chưa kiểm chứng

- Production: đã chạy P1–P6 chỉ đọc (2026-10-27 ~07:19 UTC+7, anh Vinh cho
  phép) — không drift so với staging (§5.2). Chưa chạy gì khác trên production.
- SQL migration/rollback ở §6 **chưa chạy ở bất kỳ DB nào** (kể cả DB local),
  do ràng buộc "không chạy SQL ghi/DDL". Chuỗi so sánh `pg_get_constraintdef`
  khớp đúng output staging thực tế.
- Chưa tái hiện lỗi bằng cách ghi thật trên staging (không được phép ghi); lỗi
  được suy ra từ định nghĩa constraint + code path. Không có log staging 24h
  ghi nhận lỗi.
- Số `323` đã khoá (321 = #1727, 322 = #1720). Nếu 323 merge/apply trước
  321/322, ledger tạm có khoảng trống. `backend/migrations/README.md` cho phép:
  "The runner applies any unapplied file regardless of order" và "do not assume
  the sequence is dense"; `apply_migrations.sh` duyệt mọi file theo thứ tự tên
  và chỉ bỏ qua file đã có trong ledger, nên 321/322 vẫn được apply sau. 323
  không phụ thuộc logic vào 321/322. Chỉ cần PR sau cùng cập nhật dòng
  "highest is"/"next" của README cho đúng max.
