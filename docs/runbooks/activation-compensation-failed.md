# Cảnh báo kích hoạt mã: `compensation_failed` / `promote_role_failed`

> **Runbook này chỉ mô tả, không cấp quyền chạy.** Production: mọi bước, kể cả
> `SELECT` chỉ đọc, cần anh Vinh duyệt trước. Staging: kiểm
> `/workspace/cc-jobs/STAGING_FREEZE` trước. Không in hay commit secret, mã
> kích hoạt hay email học viên; báo cáo chỉ ghi ID và số đếm.

Nguồn: `activate_account` trong
[`backend/routers/auth.py`](../../backend/routers/auth.py) (CLASSARCHIVE-0030
FR-008, SA-REVIEW-152).

## 1. Ý nghĩa

**A. `compensation_failed` (503 `activation_incomplete`).** Lớp của mã bị lưu trữ
trong lúc kích hoạt (race, Scenario 3). Bước 3 đã ghi `users`, ghi danh bị 337
từ chối, và hoàn tác snapshot lỗi cả 2 lần. Dấu hiệu:

- log `CRITICAL [auth] cohort-archive activation revert FAILED request_id=… user=…`;
- một dòng `access_code_audit` có `action='enroll_rejected_cohort_archived'`,
  `after.detail.compensation_failed=true`, `after.detail.unrestored_fields` liệt kê
  các cột `users` có thể vẫn giữ giá trị của request này (`is_active`,
  `access_code_used`, `permissions`).

Mã **chưa** được dùng (`is_used=false`) và không có hồ sơ học viên mới.
`role` không bao giờ đổi ở nhánh này: nâng quyền giảng viên chỉ chạy sau khi
claim mã thành công. Rủi ro: tài khoản có thể đang active với quyền của mã
trong khi mã vẫn dùng được (mã lớp không ràng email → sau khi khôi phục lớp,
người khác có thể dùng lại mã → 1 mã, 2 tài khoản).

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

A cần xử lý khi `users.access_code_used` vẫn là mã này (so trong DB, đừng chép
mã ra báo cáo) hoặc `is_active` vẫn `true` dù trước đó tài khoản chưa active.
Nếu `users` đã khác (admin đã sửa, hoặc người dùng đã kích hoạt mã khác) thì
không động vào.

## 3. Khắc phục

**A.**
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
