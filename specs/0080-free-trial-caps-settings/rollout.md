# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging`; số migration 471 (phụ thuộc 371 của 0047 và 440 của G09) chưa bị file hay PR khác dùng; ghi vào sổ số migration (`backend/migrations/register.tsv` khi G01-T06 đã merge).
- Cờ mặc định tắt: `free_trial_enabled` (0047).
- Kiểm đua đồng thời trần toàn web (B1) bằng PG thử trước khi bật.

## Staging

- Thứ tự áp: 371 (G11-T14a) → 471 → service trạng thái → thẻ Cài đặt → màn chấm thử. Migration chạy trên staging trước dưới khoá advisory, test PG17 + postcondition; nghiệm thu các kịch bản B* bằng tài khoản QA/thử.

## Production

- Chỉ qua PR `staging → main`; migration production cần anh Andy duyệt bằng lời trước khi mã phụ thuộc lên. Không bật cờ, không gửi thông báo hay thư, không nộp bài trên production trong gói này.

## Rollback and repair

- Tắt cờ (hiệu lực ≤ 15 s qua `runtime_flags`), rồi deploy lại backend trước đó; migration chỉ thêm đối tượng nên tương thích với mã cũ.

## Observability

- Log theo lý do và trạng thái, không ghi email, tên, số tiền, mã đơn, nội dung bài (gói mục 8). Job ghi số dòng sinh / trùng / bỏ qua mỗi lần chạy.
