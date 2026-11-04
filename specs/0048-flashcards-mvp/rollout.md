# Rollout and rollback

## Preconditions

- Anh Vinh duyệt spec (Q-1..Q-7) trên `staging`.
- Leader đã cấp số migration `372` (dùng nếu Q-2 = migration).
- `FLASHCARD_MVP_ENABLED` chưa đặt (mặc định false) trên staging và prod.

## Staging

1. Merge T001 (menu) — an toàn, không cờ.
2. Áp migration `372` lên staging (`zjphffoujxkpltixsbzj`) qua quy trình
   migration thường; kiểm `public_wiki` mặc định true, quyền không đổi.
3. Merge T002–T006 với cờ tắt; xác nhận hành vi y như cũ (Scenario 8).
4. Đặt `FLASHCARD_MVP_ENABLED=true` trên Railway staging; chạy Scenario 1–7.

## Production

Chỉ sau khi anh Vinh cho phép riêng: áp migration `372` (cộng cột) trước,
promote code với cờ tắt, rồi bật cờ. Không ghi dữ liệu prod khác.

## Rollback and repair

- Tắt cờ → import 404, trình học về 4 nút; dữ liệu đã nhập giữ nguyên.
- Thẻ import sai: admin bỏ khỏi bộ trong trình biên tập; xoá thẻ ở "Nội dung
  từ vựng" (đường sẵn có). Cột `public_wiki` để nguyên (vô hại).

## Observability

- Log mỗi commit: `set_id`, số dòng new/existing, admin id (không log nội
  dung thẻ).
- Theo dõi 5xx `/admin/vocabulary-sets/*/import`, thời gian p95 dry-run
  (< 1 s cho 200 dòng).
