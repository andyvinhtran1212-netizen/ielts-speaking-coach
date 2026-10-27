# Research record — CODEUNIQ-0028 (Vietnamese, as approved)

> Approved by Vinh 2026-10-27 07:14 UTC+7. This is the reviewed Vietnamese
> draft, kept verbatim as the evidence record (file:line citations against
> `origin/staging@3aded02b`, read-only staging catalog/data queries on
> 2026-10-27). The canonical contract is `spec.md`; the locked migration
> number is **325**. Production was never queried: every production query
> below stays **chờ anh Vinh cho phép chạy chỉ đọc**.

> **Cập nhật 2026-10-27 (sau khi duyệt):** #1733 (`f489d9296`) đã merge vào
> `staging`: `backend/services/access_code_gen.py` sinh mã bằng `secrets`
> dạng `XXXX-XXXX-XXXX` (bảng chữ 31 ký tự in hoa/số), khử trùng trong lô,
> pre-check và retry khi 23505 cho hai điểm insert của admin. Mục §3 và
> §7.1–7.2 dưới đây mô tả code trước #1733; phần code còn lại chỉ là
> instructor mint (`backend/routers/instructor.py` `mint_codes`) vẫn insert
> không retry. Mã mới vẫn ở dạng chuẩn `upper(btrim(code))`. Hợp đồng chuẩn nằm ở `spec.md`.


# F07 — UNIQUE trên `access_codes.code`

> Hồ sơ nghiên cứu (bản nháp gốc đã được duyệt) gộp spec/plan/tasks/verification/rollout. Staging `zjphffoujxkpltixsbzj`
> chỉ SELECT/catalog; **production không được truy vấn; không chạy SQL ghi/DDL.**

## 1. Problem

Mã kích hoạt là "access-code truth" (`specs/README.md`: high-risk). Toàn bộ
kích hoạt tài khoản, phân quyền và nhập lớp tra mã bằng so khớp chính xác
`.eq("code", code)` (`backend/routers/auth.py:396–402`). Nếu hai dòng trùng mã,
`.limit(1)` chọn một dòng tuỳ ý → kích hoạt sai quyền/sai lớp/sai instructor.

**Trạng thái thực tế:**
- **Staging đã có** `access_codes_code_key :: UNIQUE (code)` (constraint +
  index `CREATE UNIQUE INDEX access_codes_code_key ON public.access_codes USING btree (code)`).
- **Repo không có migration nào tạo bảng `access_codes` hay UNIQUE này** (đã
  kiểm, khớp gợi ý của parent): `rg "CREATE TABLE[^;]*access_codes"` = 0;
  `009_access_code_upgrade.sql:7` chỉ `ALTER TABLE access_codes` thêm cột;
  `062_access_codes_extensions.sql:4` ghi "Extends the existing access_codes table
  (Migration 009 origin)… The 16-column original table is preserved verbatim";
  `106_instructor_role_foundation.sql:50–63` thêm cột/CHECK grants_role.
  ⇒ UNIQUE(code) là **drift ngoài repo** (tạo ở dashboard/schema gốc). Môi trường
  dựng từ repo (CI, DB mới) sẽ **không** có ràng buộc; production chưa xác minh.
- Ràng buộc hiện tại **phân biệt hoa/thường và khoảng trắng**: `abcd-1234` và
  `ABCD-1234` có thể cùng tồn tại; trong khi `/auth/activate` chuẩn hoá đầu vào
  `payload.access_code.strip().upper()` (`auth.py:393`) → dòng chữ thường không
  bao giờ kích hoạt được, và "trùng theo người dùng" không bị DB chặn.

## 2. Schema live staging (đã đọc)

| Loại | Nội dung |
| --- | --- |
| Cột `code` | `text NOT NULL`, không default |
| UNIQUE | `access_codes_code_key UNIQUE (code)` |
| PK | `access_codes_pkey (id)`, `id uuid default gen_random_uuid()` |
| CHECK | `access_codes_code_type_check (code_type IN mass,direct,staff)`; `chk_access_codes_grants_role` |
| FK ra | `cohort_id → cohorts ON DELETE SET NULL`; `issued_by → users ON DELETE SET NULL`; `used_by → users` (NO ACTION) |
| FK vào | `user_code_assignments.code_id → access_codes(id) ON DELETE CASCADE` |
| Index khác | `idx_access_codes_code_type`, `idx_access_codes_cohort_id` (partial), `idx_access_codes_issued_by` (partial) |
| Trigger | không có |
| Policies | `"Admin only"` ALL {public} (`EXISTS users.role='admin'`, **không có trong repo** — drift), `access_codes_admin_all`, `access_codes_instructor_own` |
| Grants | anon/authenticated: SELECT; service_role: đủ quyền |

### 2.1 Dữ liệu staging (đã chạy, chỉ đọc)

| Đo | Kết quả |
| --- | --- |
| Tổng mã | **503** |
| Nhóm trùng chính xác (`code`) | **0** |
| Nhóm trùng `lower(code)` | **0** |
| Nhóm trùng `upper(btrim(code))` | **0** |
| Mã có khoảng trắng đầu/cuối | **0** |
| Mã không ở dạng chữ hoa | **0** |
| Mã ngoài `^[A-Z0-9-]+$` | **0** |
| Độ dài | 9–38 |
| `code_type` có mặt | `direct, mass` |

⇒ Không cần dedupe trên staging.

## 3. Mã được sinh và tra cứu thế nào

Sinh:
- `_gen_code()` `backend/routers/admin.py:169–176`: `XXXX-XXXX`, 36 ký tự
  `A–Z0–9` (`random.choices`, không phải `secrets`), luôn chữ hoa, không kiểm trùng.
- Dùng ở: `POST /admin/access-codes/generate` (`admin.py:1084` sinh list,
  `1104–1109` insert **cả lô một lần**, lỗi → 500 "Lỗi khi tạo access codes");
  `_issue_code_and_assign` (`admin.py:2448–2472`, insert một mã, không bắt lỗi);
  instructor mint (`backend/routers/instructor.py:61` import, `673` sinh,
  `685` insert lô qua `instructor_db`).
- `backend/scripts/staging_seed.py:142–145`: mã `E2E-<NS>-UNUSED/USED/REVOKED`
  với `ns.upper()`, kiểm tồn tại trước (`:122`).
- **Không có retry khi trùng**: một va chạm (kể cả hai mã trùng trong cùng lô —
  không khử trùng trong list) làm cả lô fail 500. Không gian 36^8 ≈ 2,8·10^12
  nên xác suất thấp, nhưng hành vi lỗi không xác định và `random` không phải
  CSPRNG (anti-enumeration ở `auth.py:409–416` dựa vào độ khó đoán).

Tra cứu/chuẩn hoá:
- `/auth/activate` (`auth.py:383`): `code = payload.access_code.strip().upper()`
  (`:393`) → `.eq("code", code).limit(1)` (`:396–402`); claim CAS
  `.eq("id", …).eq("is_used", False)` (`:678–684`).
- Nhập lớp bằng mã (#1693, merged 2026-10-25): **không có endpoint riêng**; mã
  lớp là `access_codes` có `cohort_id` (`code_type='direct'`), đi qua chính
  `/auth/activate`. #1693 sửa `auth.py` (gắn học viên vào roster chủ lớp,
  `enroll_owner`), dùng `code` đã chuẩn hoá làm `students.student_code`
  (`auth.py:571, 646`) — `students.student_code` cũng UNIQUE
  (`students_student_code_key`). Không đổi cách tra mã.
- Các truy vấn admin khác theo `id`, không theo `code`.

## 4. Phương án

| | A. Giữ UNIQUE(code) thường + CHECK dạng chuẩn (**đề xuất**) | B. UNIQUE INDEX trên `lower(code)` / `upper(btrim(code))` | C. Chỉ codify UNIQUE(code) |
| --- | --- | --- | --- |
| Chặn trùng theo cách người dùng nhập | Có (CHECK ép mọi mã đã ở dạng `upper(btrim)` ⇒ unique thường = unique chuẩn hoá) | Có | Không (chữ thường lọt) |
| Index mới / CONCURRENTLY | Không, nếu UNIQUE đã có | Có — phải `CREATE UNIQUE INDEX CONCURRENTLY` ngoài transaction | Chỉ khi môi trường thiếu |
| Index dùng được cho `.eq("code")` | Có | Không (biểu thức) — vẫn cần index thường | Có |
| Đổi code | Không bắt buộc | Không | Không |

Chọn **A**: tận dụng index đang có, không cần index biểu thức, khớp đúng cách
`auth.py:393` chuẩn hoá đầu vào.

CONCURRENTLY: `CREATE INDEX CONCURRENTLY` không chạy được trong transaction
block. Runner `backend/scripts/apply_migrations.sh:22–23` ghi rõ không bọc file
trong một transaction (vì 093/094/096). Vì vậy 325 **không** có `BEGIN` ngoài
cùng ở phần index; phần CHECK dùng transaction riêng. Trên staging bước index là
no-op (đã có).

## 5. Migration 325 (chưa chạy ở đâu)

```sql
-- Migration: 325_access_codes_code_unique_canonical.sql
--
-- F07 / CODEUNIQ-0028. access_codes.code uniqueness existed only outside the
-- repo (dashboard: access_codes_code_key on staging). Codify it and require the
-- canonical form upper(btrim(code)) that /auth/activate looks up, so the plain
-- unique index is also unique for every way a learner can type the code.
-- NO outer BEGIN: CREATE INDEX CONCURRENTLY cannot run in a transaction block
-- (the runner does not wrap files; see apply_migrations.sh).
-- No data change. Aborts on duplicates or non-canonical codes.

SET lock_timeout = '5s';

-- 1. Precheck (fail loud; dedupe is a reviewed manual step, see spec §6).
DO $$
DECLARE
    v_exact BIGINT; v_norm BIGINT; v_noncanon BIGINT;
BEGIN
    SELECT count(*) INTO v_exact FROM (
        SELECT code FROM public.access_codes GROUP BY code HAVING count(*) > 1) x;
    SELECT count(*) INTO v_norm FROM (
        SELECT upper(btrim(code)) FROM public.access_codes GROUP BY 1 HAVING count(*) > 1) x;
    SELECT count(*) INTO v_noncanon FROM public.access_codes
     WHERE code <> upper(btrim(code)) OR btrim(code) = '';
    IF v_exact > 0 OR v_norm > 0 OR v_noncanon > 0 THEN
        RAISE EXCEPTION 'access_codes_code_not_unique_or_not_canonical'
            USING DETAIL = format('exact_dup_groups=%s normalized_dup_groups=%s non_canonical=%s',
                                  v_exact, v_norm, v_noncanon);
    END IF;
END $$;

-- 2. Unique index. No-op where access_codes_code_key already exists (staging).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS access_codes_code_key
    ON public.access_codes (code);

-- 3. A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS
--    would silently accept: refuse it. Then expose the index as a constraint.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_index i
                WHERE i.indexrelid = to_regclass('public.access_codes_code_key')
                  AND NOT i.indisvalid) THEN
        RAISE EXCEPTION 'access_codes_code_key_invalid'
            USING HINT = 'DROP INDEX CONCURRENTLY public.access_codes_code_key; then re-run 325.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.access_codes'::regclass
                      AND conname = 'access_codes_code_key' AND contype = 'u') THEN
        ALTER TABLE public.access_codes
            ADD CONSTRAINT access_codes_code_key UNIQUE USING INDEX access_codes_code_key;
    END IF;
END $$;

-- 4. Canonical form, in its own transaction.
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.access_codes'::regclass
                      AND conname = 'chk_access_codes_code_canonical') THEN
        ALTER TABLE public.access_codes
            ADD CONSTRAINT chk_access_codes_code_canonical
            CHECK (code = upper(btrim(code)) AND code <> '') NOT VALID;
    END IF;
END $$;
ALTER TABLE public.access_codes VALIDATE CONSTRAINT chk_access_codes_code_canonical;

-- 5. Postcondition
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
         WHERE c.conrelid = 'public.access_codes'::regclass
           AND c.contype = 'u' AND c.conname = 'access_codes_code_key'
           AND i.indisvalid AND i.indisunique AND i.indnatts = 1
           AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                               WHERE attrelid = 'public.access_codes'::regclass AND attname = 'code')
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.access_codes'::regclass
           AND conname = 'chk_access_codes_code_canonical' AND convalidated
    ) THEN
        RAISE EXCEPTION 'access_codes_code_unique_postcondition_failed';
    END IF;
END $$;
COMMIT;

RESET lock_timeout;
```

Lưu ý: nếu môi trường đích có UNIQUE trên `code` dưới **tên khác**, bước 2 tạo
thêm một unique index trùng (vô hại nhưng thừa) — vì vậy chạy P1 ở production
trước và đổi tên/điều chỉnh nếu cần. Trên staging bước 2 và 3 là no-op; chỉ bước 4
thực sự thay đổi schema (thêm CHECK, quét 503 dòng).

### Rollback

```sql
ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS chk_access_codes_code_canonical;
-- KHÔNG drop access_codes_code_key ở môi trường đã có nó trước 325 (staging).
-- Chỉ ở môi trường mà 325 tạo index (P1 trước apply cho thấy thiếu) mới có thể:
--   ALTER TABLE public.access_codes DROP CONSTRAINT access_codes_code_key;
```

An toàn: bỏ CHECK luôn an toàn về dữ liệu (không dòng nào đổi) nhưng mở lại
khả năng chèn mã chữ thường. Bỏ UNIQUE **không bao giờ khuyến nghị** — mở lại
rủi ro kích hoạt nhầm mã trùng; chỉ khi chứng minh unique gây sự cố và có biện
pháp thay thế. Rollback = migration forward mới.

## 6. Kế hoạch dedupe (nếu P2–P4 ở production > 0)

Staging: không cần. Production: chưa biết. Nếu có trùng:
1. Liệt kê (chỉ đọc) nhóm trùng kèm `id, code, is_used, used_by, used_at,
   is_active, is_revoked, cohort_id, created_at` và số `user_code_assignments`.
2. Quy tắc giữ: giữ dòng **đã dùng** (`is_used` / có assignment active); dòng
   chưa dùng còn lại → **đổi mã mới** (`_gen_code`) chứ không xoá (giữ lịch sử,
   FK `user_code_assignments` CASCADE sẽ xoá assignment nếu delete). Nếu ≥2 dòng
   cùng đã dùng: không tự xử — báo anh Vinh từng trường hợp.
3. Mã không chuẩn hoá (chữ thường/khoảng trắng): nếu chưa dùng → cập nhật
   `code = upper(btrim(code))` khi không va chạm; nếu đã dùng → xem
   `users.access_code_used` và `students.student_code` liên quan trước khi đổi.
4. Script dedupe là bước dữ liệu riêng, dry-run mặc định, cần duyệt; không nằm
   trong 325.

## 7. Code thay đổi

1. `backend/routers/admin.py:169–176` `_gen_code`: dùng `secrets.choice`
   (CSPRNG) — giữ format `XXXX-XXXX`.
2. Insert có retry khi `23505` trên `access_codes_code_key`: `generate_access_codes`
   (`admin.py:1084–1109`), `_issue_code_and_assign` (`admin.py:2457–2470`),
   instructor mint (`instructor.py:673–685`). Khử trùng trong lô (dùng `set`),
   tối đa ~3 lần sinh lại; lỗi khác giữ 500.
3. Không cần đổi `/auth/activate` (đã `strip().upper()`).
4. Test: `backend/tests/test_migration_325_access_codes_unique.py` (tĩnh: không
   có `BEGIN` trước `CONCURRENTLY`, có precheck/postcondition; PG: chèn
   `abcd-1234` → 23514; chèn trùng → 23505; re-run 325 no-op) + test retry.
5. README migrations: "highest is"/"next" và đoạn mô tả 325, ghi chú drift.

## 8. Kiểm tra production — **chờ anh Vinh cho phép chạy chỉ đọc**

```sql
BEGIN TRANSACTION READ ONLY;
-- P1: unique/index hiện có trên code
SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.access_codes'::regclass ORDER BY 1;
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'access_codes';
-- P2–P4: trùng & dạng chuẩn
SELECT (SELECT count(*) FROM public.access_codes) total,
       (SELECT count(*) FROM (SELECT code FROM public.access_codes GROUP BY code HAVING count(*) > 1) x) dup_exact_groups,
       (SELECT count(*) FROM (SELECT lower(code) FROM public.access_codes GROUP BY 1 HAVING count(*) > 1) x) dup_lower_groups,
       (SELECT count(*) FROM (SELECT upper(btrim(code)) FROM public.access_codes GROUP BY 1 HAVING count(*) > 1) x) dup_norm_groups,
       (SELECT count(*) FROM public.access_codes WHERE code <> btrim(code)) untrimmed,
       (SELECT count(*) FROM public.access_codes WHERE code <> upper(code)) not_upper,
       (SELECT count(*) FROM public.access_codes WHERE btrim(code) = '') empty_code;
-- P5 (chỉ khi P2–P4 > 0): chi tiết nhóm trùng
SELECT upper(btrim(code)) AS norm, id, code, is_used, used_by, used_at, is_active, is_revoked, cohort_id, created_at
  FROM public.access_codes
 WHERE upper(btrim(code)) IN (SELECT upper(btrim(code)) FROM public.access_codes GROUP BY 1 HAVING count(*) > 1)
 ORDER BY 1, created_at;
-- P6: ledger
SELECT filename FROM public._schema_migrations ORDER BY filename DESC LIMIT 5;
ROLLBACK;
```

## 9. Tiêu chí chấp nhận trên staging

| # | Bước | Kỳ vọng |
| --- | --- | --- |
| AC-1 | Catalog P1 trên staging sau apply | `access_codes_code_key` (u, index valid, 1 cột `code`) + `chk_access_codes_code_canonical` validated; không có index trùng mới. |
| AC-2 | Đếm lại §2.1 | Tổng mã không đổi (503 hoặc số chụp ngay trước apply); 0 trùng. |
| AC-3 | Admin `POST /admin/access-codes/generate` count=100 | 200; 100 mã dạng `XXXX-XXXX`. |
| AC-4 | Instructor E2E mint 5 mã | 200, `issued_by` = instructor. |
| AC-5 | Học viên E2E kích hoạt mã mới nhập `  abcd-efgh ` (chữ thường + khoảng trắng) với mã thật `ABCD-EFGH` | Kích hoạt OK (chuẩn hoá `auth.py:393`). |
| AC-6 | Kích hoạt mã lớp (direct, có cohort) | Vào lớp + roster chủ lớp như #1693. |
| AC-7 | Test unit retry: mô phỏng 23505 lần đầu | Lần 2 thành công; không 500. |
| AC-8 | Re-run 325 (DRY_RUN của runner báo skipped; chạy file trong DB test CI) | No-op, không lỗi. |

(Thử chèn trùng/chữ thường trực tiếp chỉ làm trong DB test CI, không ghi tay trên staging.)

## 10. Rủi ro & phân loại

- **Change class: high-risk** (schema migration, access-code truth). `risk: high`.
- Mất dữ liệu: không (325 không ghi dữ liệu; dedupe là bước riêng có duyệt).
- Khoá: VALIDATE CHECK quét bảng (SHARE UPDATE EXCLUSIVE); ADD … NOT VALID khoá
  ACCESS EXCLUSIVE rất ngắn; CONCURRENTLY không khoá ghi. `lock_timeout` 5s.
- Có thể chặn luồng hợp lệ: bất kỳ script nào chèn mã chữ thường (không tìm thấy
  trong repo) sẽ nhận 23514.
- Bảo mật: không đổi grant/RLS. Policy `"Admin only"` drift — ngoài phạm vi, ghi nhận.
- `random.choices` cho mã kích hoạt: đề xuất đổi sang `secrets` (§7.1).

## 11. Tasks

- [ ] T001 Duyệt spec; chốt số. - [ ] T002 Viết 325. - [ ] T003 Code §7.1–7.2.
- [ ] T004 Tests. - [ ] T005 README. - [ ] T006 P1–P6 prod (chờ anh Vinh cho phép
  chạy chỉ đọc); dedupe nếu cần (spec §6, duyệt riêng). - [ ] T007 Staging AC.
- [ ] T008 Production sau duyệt.

## 12. Chưa kiểm chứng

- Production: có `access_codes_code_key` không, tên gì, có trùng không.
- Nội dung gốc của finding F07 (không có trong repo/spec); spec dựa trên mô tả
  của brief.
- SQL 325 chưa chạy ở đâu; hành vi `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`
  qua runner `\i` cần xác nhận trong CI.
