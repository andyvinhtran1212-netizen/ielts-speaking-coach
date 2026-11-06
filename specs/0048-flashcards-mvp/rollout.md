# Rollout and rollback

## Preconditions

- Anh Vinh duyệt spec (Q-1..Q-7) trên `staging`.
- Leader đã giữ số migration `372` cho FLASHCARD-0048 T002 tại
  `/workspace/cc-jobs/migrations-register.md` (04/11 14:51:45 UTC+7; dùng nếu
  Q-2 = migration). T002 thêm hàng `pending_feature` nhóm `flashcard_mvp`
  vào `forward-policy.tsv` theo plan; merge không tự áp migration.
- FD quyết P3-4 (import song song trùng slug) và P3-5 (truyền Chủ đề so với
  body FR-002) trước build; thay đổi FR đi qua PR spec-only riêng. Nếu muốn
  chặn thẻ ẩn wiki qua REST, cần duyệt phạm vi riêng như plan.
- `FLASHCARD_MVP_ENABLED` chưa đặt (mặc định false) trên staging và prod.

## Staging

1. Merge T001 (menu) — an toàn, không cờ.
2. Áp migration `372` lên staging (`zjphffoujxkpltixsbzj`) qua quy trình
   migration có advisory lock và opt-in `MIGRATION_FEATURES=flashcard_mvp`;
   kiểm `public_wiki` mặc định true, quyền/RLS không đổi và RPC có
   `search_path`/ACL như plan.
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
