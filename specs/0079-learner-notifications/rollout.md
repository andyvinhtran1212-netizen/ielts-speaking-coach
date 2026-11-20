# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging`; số migration 470 chưa bị file hay PR khác dùng; ghi vào sổ số migration (`backend/migrations/register.tsv` khi G01-T06 đã merge).
- Cờ mặc định tắt: `notifications_enabled`, `notification_emails`.

## Staging

- Thứ tự áp: 470 → backend (API, bộ đếm) → job + cron → giao diện. Migration chạy trên staging trước dưới khoá advisory, test PG17 + postcondition; nghiệm thu các kịch bản A* bằng tài khoản QA/thử.

## Production

- Chỉ qua PR `staging → main`; migration production cần anh Andy duyệt bằng lời trước khi mã phụ thuộc lên. Không bật cờ, không gửi thông báo hay thư, không nộp bài trên production trong gói này.

## Rollback and repair

- Tắt cờ (hiệu lực ≤ 15 s qua `runtime_flags`), rồi deploy lại backend trước đó; migration chỉ thêm đối tượng nên tương thích với mã cũ.

## Observability

- Log theo lý do và trạng thái, không ghi email, tên, số tiền, mã đơn, nội dung bài (gói mục 8). Job ghi số dòng sinh / trùng / bỏ qua mỗi lần chạy.
