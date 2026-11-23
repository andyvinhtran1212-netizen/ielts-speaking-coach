# Rollout and rollback

## Preconditions

- Spec duyệt; câu hỏi mở 1, 2 có quyết định (2 có thể đi với mặc định 30 nếu anh đồng ý).
- G04-T04 (outbox, `send_direct`, sweep) và G04-T09 (phiên học viên) đã ở staging.
- T001 đã đối chiếu danh mục với catalog staging.

## Staging

1. Anh Andy gõ duyệt áp migration nhãn 500 bằng runner có khoá tư vấn; đọc lại hai bảng, hàm, trigger, bucket.
2. Deploy SHA có PR mã; cờ `ACCOUNT_ERASURE_ENABLED` tắt.
3. Tạo tài khoản thử có phiên Speaking kèm ghi âm, bài Writing, một đơn đăng ký đã xác nhận, dòng sổ lượt.
4. Truy vấn "trước" (chỉ đọc): số dòng theo bảng của danh mục cho `id` thử; số object `audio-responses`; số dòng chứng từ/sổ lượt.
5. Yêu cầu tải dữ liệu, chờ gói, tải, kiểm manifest; kiểm link quá hạn bằng cách đặt `expires_at` lùi (ghi DB trên staging cần anh gõ duyệt).
6. Gửi yêu cầu xoá; kiểm đăng xuất; đặt `erase_after` lùi (cần anh gõ duyệt); chạy job dry-run, đối chiếu danh sách.
7. Bật cờ trên staging (anh), chạy job; truy vấn "sau": 0 dòng ở bảng `delete`, `users` không còn PII, chứng từ/sổ lượt bằng "trước"; đăng nhập email cũ thất bại; đăng ký lại email cũ tạo `id` mới.

## Production

- Áp migration và bật cờ là hai bước riêng, mỗi bước cần anh Andy gõ duyệt. Trước khi bật cờ: dry-run trên production một chu kỳ, gửi anh danh sách (thường rỗng).

## Rollback and repair

- Mã: revert PR; bảng mới không được mã cũ đọc. Yêu cầu `pending` còn trong bảng, bật lại sau.
- Migration: rollback chỉ khi hai bảng rỗng hoặc đã xuất. Migration không nới trigger chỉ ghi thêm nào (trừ khi anh chọn phương án xoá ở câu hỏi mở 6).
- Xoá là không hoàn tác được. Bảo vệ: hạn huỷ, cờ tắt mặc định, dry-run, khoá dòng và đọc lại trạng thái. Yêu cầu kẹt `erasing`: hợp đồng thuê hết hạn thì job tự tiếp quản; yêu cầu `failed`: đọc `last_error_code`, sửa nguyên nhân, đặt lại `status='erasing'`, `attempts=0`, `lease_until=now()` (cần anh duyệt ghi DB) để job làm lại.

## Observability

- Log sự kiện FR-013 có `user_id`, id yêu cầu, bước, số dòng theo bảng; không email.
- Cảnh báo chủ dự án khi một yêu cầu lỗi đủ `ACCOUNT_ERASURE_MAX_ATTEMPTS` lần hoặc gói tải trễ quá `ACCOUNT_EXPORT_READY_HOURS`.
- Chủ: anh Andy.
