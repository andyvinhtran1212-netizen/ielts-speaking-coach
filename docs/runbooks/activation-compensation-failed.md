# Cảnh báo kích hoạt mã: `compensation_failed` / `promote_role_failed`

> **Runbook này chỉ mô tả, không cấp quyền chạy.** Production: mọi bước, kể cả
> `SELECT` chỉ đọc, cần anh Vinh duyệt trước. Staging: kiểm
> `/workspace/cc-jobs/STAGING_FREEZE` trước. Không in hay commit secret, mã
> kích hoạt hay email học viên; báo cáo chỉ ghi ID và số đếm.

Nguồn: `activate_account` trong
[`backend/routers/auth.py`](../../backend/routers/auth.py) (CLASSARCHIVE-0030
FR-008, SA-REVIEW-152).

## 1. Ý nghĩa

**A. `compensation_failed` (503 `activation_incomplete`).** Với backend dùng
migration 359, không xác nhận được kết quả RPC và lần đọc lại chưa chứng minh
được claim cùng trạng thái tài khoản đã commit. RPC ghi tài khoản, hồ sơ,
membership và claim trong một transaction: hoặc tất cả commit, hoặc tất cả
rollback. Backend không gửi UPDATE/DELETE hoàn tác và không tự gọi lại RPC.
Không suy ra mã chưa dùng chỉ từ lỗi kết nối.

Dấu hiệu:

- log `CRITICAL [auth] activation transaction unconfirmed request_id=… user=…`;
- audit tương thích `action='enroll_rejected_cohort_archived'`,
  `after.detail.compensation_failed=true`; `unrestored_fields` là các cột chưa
  xác nhận được, không chứng minh chúng bị ghi một phần hay lớp đã lưu trữ.

Với backend cũ trước 359, cờ này có nghĩa hoàn tác snapshot lỗi cả hai lần sau
khi ghi danh bị từ chối. Chỉ trường hợp cũ đó mới có nguy cơ tài khoản active
mà chưa claim mã. Phải phân biệt SHA/backend trước khi sửa dữ liệu.
`role` chỉ nâng sau khi claim mã thành công ở cả hai phiên bản.

**B. `promote_role_failed` (503 `promote_incomplete` hoặc 403 `account_suspended`).**
Mã giảng viên đã claim (bất biến), nhưng ghi `role='instructor'` không thành.
Dấu hiệu: log `CRITICAL [auth] instructor promote FAILED after claim …` và audit
`action='promote_role_failed'` với `after.role` = role thật sau cùng (null = không
đọc được), `after.reason` ∈ `write_failed | role_changed | account_suspended`.

## 2. Kiểm tra (chỉ đọc)

Lấy `request_id` từ log/ref của phản hồi rồi:

```sql
SELECT id, action, code_id, target_user_id, before, after, created_at
FROM access_code_audit
WHERE after->'detail'->>'request_id' = :request_id   -- A
   OR after->>'request_id' = :request_id;            -- B

SELECT id, role, is_active, access_code_used, permissions, suspended_at
FROM users WHERE id = :target_user_id;

SELECT id, is_used, used_by, used_at, is_revoked, cohort_id, grants_role
FROM access_codes WHERE id = :code_id;

SELECT id, is_active, archived_at FROM cohorts WHERE id = :cohort_id;  -- A
```

Với RPC 359, xác minh tài khoản, claim và hồ sơ/membership cùng phản ánh một
lần kích hoạt hoàn chỉnh trước khi quyết định có cần sửa. Không hoàn tác một
claim đã commit. Với backend cũ, A cần xử lý khi `users.access_code_used` vẫn là mã này (so trong DB, đừng chép
mã ra báo cáo) hoặc `is_active` vẫn `true` dù trước đó tài khoản chưa active.
Nếu `users` đã khác (admin đã sửa, hoặc người dùng đã kích hoạt mã khác) thì
không động vào.

## 3. Khắc phục

**A.** Với kết quả RPC 359 chưa xác nhận, chỉ đọc lại trạng thái canonical;
không chạy hoàn tác snapshot. Các bước sau chỉ dành cho dữ liệu lỗi được xác
nhận từ backend cũ:

1. Leader/owner quyết: tài khoản có được giữ active không. Mặc định (FR-008):
   lớp đã lưu trữ thì không ghi danh; nếu trước đó tài khoản chưa active thì
   đưa về chưa active.
2. Viết một câu `UPDATE users … WHERE id = :uid AND access_code_used = :code`
   chỉ cho các cột trong `unrestored_fields` mà vẫn mang giá trị của request
   này; lấy giá trị cũ từ ngữ cảnh (audit/admin). Chạy theo job rules mục A
   (file, `SENDING`/`RESULT`). Không bao giờ sửa `access_codes.is_used/used_by/used_at`.
3. Nếu lớp sẽ được khôi phục mà mã không nên dùng lại, admin thu hồi mã:
   `DELETE /admin/access-codes/{code_id}` (soft-revoke).
4. Đọc lại bước 2 và ghi kết quả vào job log.

**B.**
1. Kiểm tra `access_codes.intended_email` khớp email tài khoản và tài khoản
   không bị đình chỉ (`suspended_at IS NULL`).
2. `reason=account_suspended`: không làm gì; role chỉ đổi sau khi admin gỡ đình
   chỉ (FR-019).
3. `reason=role_changed`: có người đã đổi role sau bước 2; hỏi admin trước khi
   ghi đè.
4. Còn lại: admin cấp role qua `PATCH /admin/users/{user_id}/role`
   `{"role": "instructor"}` (có audit, `fn_set_staff_privilege`). Mã đã thuộc
   tài khoản này, không cần kích hoạt lại.
