# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging`; số migration 473, 474 (475, 476 hoãn) chưa bị file hay PR khác dùng; ghi vào sổ số migration (`backend/migrations/register.tsv` khi G01-T06 đã merge).
- Cờ mặc định tắt: `COURSE_TEST_DEFAULT_RELEASE_MODE` (cấu hình mặc định khi giao bài).
- Bài giao trước gói (chế độ NULL) và bài `mastery` không đổi hành vi (FR-074, E6): so JSON và ảnh trước/sau trên staging.
- Mặc định `COURSE_TEST_DEFAULT_RELEASE_MODE`: lớp offline `teacher_release` (câu 13).

## Staging

- Thứ tự áp: 473 (lược đồ + thu quyền đọc thẳng) → cổng máy chủ trên mọi đường đọc → 474 (RPC công bố, hẹn giờ) → bước hẹn giờ trong job → màn học viên; 475, 476 hoãn. Migration chạy trên staging trước dưới khoá advisory, test PG17 + postcondition; nghiệm thu các kịch bản E* bằng tài khoản QA/thử.

## Production

- Chỉ qua PR `staging → main`; migration production cần anh Andy duyệt bằng lời trước khi mã phụ thuộc lên. Không bật cờ, không gửi thông báo hay thư, không nộp bài trên production trong gói này.

## Rollback and repair

- Tắt cờ (hiệu lực ≤ 15 s qua `runtime_flags`), rồi deploy lại backend trước đó; migration chỉ thêm đối tượng nên tương thích với mã cũ. Thu quyền đọc thẳng ở 473 không quay lui (là sửa lỗ hổng dữ liệu đã ghi ở `01` mục 6).

## Observability

- Log theo lý do và trạng thái, không ghi email, tên, số tiền, mã đơn, nội dung bài (gói mục 8). Job ghi số dòng sinh / trùng / bỏ qua mỗi lần chạy.
