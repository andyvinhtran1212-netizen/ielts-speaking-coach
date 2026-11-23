# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_account_data_api.py (sai email 422, nhân viên 403, gửi lại trả cùng yêu cầu) | PENDING |
| FR-002 | kind=test; ref=test thu hồi phiên và thư xác nhận, ca lỗi thu hồi/thư vẫn giữ yêu cầu | PENDING |
| FR-003 | kind=test; ref=test huỷ, 409 khi không có yêu cầu, 403 `account_deletion_pending` ở route học viên | PENDING |
| FR-004 | kind=test; ref=test sweep chỉ chọn yêu cầu đến hạn, huỷ đúng lúc xoá, dry-run không ghi | PENDING |
| FR-005 | kind=journey; ref=staging kịch bản 4, truy vấn kiểm trước/sau ở rollout.md | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_account_data_inventory.py và ca âm | PENDING |
| FR-007 | kind=test; ref=test thu hồi quyền lý do `account_erased`, sổ lượt và `access_codes` không đổi | PENDING |
| FR-008 | kind=journey; ref=staging: đăng nhập email cũ thất bại, đăng ký lại tạo `id` mới | PENDING |
| FR-009 | kind=test; ref=test lỗi giữa chừng rồi chạy lại, cảnh báo sau số lần tối đa | PENDING |
| FR-010 | kind=test; ref=test tạo việc xuất, trả việc đang có, 429 cooldown | PENDING |
| FR-011 | kind=test; ref=test nội dung ZIP và manifest, bỏ ghi âm khi vượt trần | PENDING |
| FR-012 | kind=test; ref=test 404 người khác, 409 chưa xong, 410 quá hạn, 302 no-store | PENDING |
| FR-013 | kind=test; ref=test 401 không phiên, OpenAPI drift, log không chứa email | PENDING |

## Contract evidence

- OpenAPI/type drift: PENDING (PR mã sinh lại `frontend/types/api.d.ts`).
- Backward compatibility: chỉ thêm route và bảng mới; route cũ không đổi.

## Data evidence

- Migration/schema query: PENDING (T001 catalog, T008 áp staging).
- Immediate state versus full reload: trạng thái yêu cầu và gói đọc lại từ API sau mỗi thao tác.

## UI evidence

- Viewports/themes/input methods: thuộc G07-T17.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: PENDING (cần anh Andy duyệt).
