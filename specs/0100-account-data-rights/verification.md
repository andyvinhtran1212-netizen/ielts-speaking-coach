# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_account_data_api.py (sai email 422, nhân viên 403, gửi lại trả cùng yêu cầu) | PENDING |
| FR-002 | kind=test; ref=test thu hồi phiên và thư xác nhận, ca lỗi thu hồi/thư vẫn giữ yêu cầu | PENDING |
| FR-003 | kind=test; ref=test huỷ, 409 khi không có yêu cầu/đang xoá, test kê danh sách cho phép của `account_deletion_gate` và 403 `account_deletion_pending` ở route học viên | PENDING |
| FR-004 | kind=test; ref=test sweep chỉ chọn yêu cầu đến hạn, huỷ đúng lúc xoá, dry-run không ghi | PENDING |
| FR-005 | kind=journey; ref=staging kịch bản 4, truy vấn kiểm trước/sau ở rollout.md | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_account_data_inventory.py (ca âm: cột `user_id`, `student_id`, `*_user_id` chưa phân loại; cột đã bỏ còn trong danh mục) và tệp danh sách sinh ở T001 (test pass ở máy 23/11; catalog staging T001 gate 2 còn chờ) | PENDING |
| FR-007 | kind=test; ref=test thu hồi quyền lý do `account_erased`, sổ lượt và `access_codes` không đổi | PENDING |
| FR-008 | kind=journey; ref=staging: đăng nhập email cũ thất bại, đăng ký lại tạo `id` mới | PENDING |
| FR-009 | kind=test; ref=test lỗi giữa chừng rồi chạy lại, cảnh báo sau số lần tối đa | PENDING |
| FR-010 | kind=test; ref=test tạo việc xuất, trả việc đang có, 429 cooldown | PENDING |
| FR-011 | kind=test; ref=test nội dung ZIP và manifest, bỏ ghi âm khi vượt trần | PENDING |
| FR-012 | kind=test; ref=test 404 người khác, 409 chưa xong, 410 quá hạn, 302 no-store | PENDING |
| FR-014 | kind=test; ref=test hai tiến trình xoá; job xuất đang chạy khi sang `erasing`; tiến trình xuất cũ hoàn tất sau khi tiến trình mới `ready`; tiến trình xuất chết sau khi tải lên trong lúc xoá; dọn định kỳ; tiền tố `account-exports/<user_id>/` rỗng sau `erased` | PENDING |
| FR-013 | kind=test; ref=test 401 không phiên, OpenAPI drift, log không chứa email | PENDING |

## Contract evidence

- OpenAPI/type drift: PENDING (PR mã sinh lại `frontend/types/api.d.ts`).
- Backward compatibility: chỉ thêm route và bảng mới; route cũ không đổi.

## Data evidence

- Migration/schema query: PENDING (T001 gate 2: truy vấn catalog chỉ đọc trên staging, cần anh Andy gõ duyệt; T008 áp staging).
- T001 gate 1 (tĩnh, 2026-11-23, nhánh `claude/project-thread-t9dexw-g04-t18`): `python backend/scripts/account_data_inventory_scan.py --with-action` liệt kê 155 cột trỏ người dùng trong 372 migration (gồm 2 cột của migration 500); phân loại: 69 `delete`, 26 `keep`, 1 `anonymize` (`students.user_id`; `users.id` ghi tay ở `PRE_MIGRATION`), 57 `staff_actor`, 2 `staff_only`, 0 chưa phân loại. So với quét CR/SA R1 (133 dòng, quy tắc cũ): thêm 21 cột theo quy tắc mở rộng (`student_id`, `*_user_id`), bỏ `vocabulary_set_sessions.id` (quét cũ đọc nhầm dòng có hai cột; cột đúng là `user_id`). Bảng từ trước hệ migration: `users.id`, `sessions.user_id`, `access_codes.used_by`. `learner_care_notes` (#2471), `learner_active_sessions` (G04-T09), `learner_login_events` (G04-T16) đã phân loại trước trong `UPCOMING`.
- T001 gate 3 (`ai_usage_logs` và cột JSON của nhật ký `keep`): PENDING, làm cùng gate 2.
- Immediate state versus full reload: trạng thái yêu cầu và gói đọc lại từ API sau mỗi thao tác.

## UI evidence

- Viewports/themes/input methods: thuộc G07-T17.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: PENDING (cần anh Andy duyệt).
