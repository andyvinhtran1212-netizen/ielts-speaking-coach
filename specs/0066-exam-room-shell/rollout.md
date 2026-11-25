# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging` (có `approval-decision.md`).
- Component G03 trong `frontend/components/ui/` có trên `staging` (đã có
  `button`, `dialog`, `confirm-dialog`, `notice`, `tabs` @ `cc6dd4c8`).
- Không cần migration, env backend hay đổi API.

## Staging

- Bốn PR G08-T02…T05 vào `staging` lần lượt. Không trình nào dùng khung, nên
  `examRoomSurfaces` rỗng và mọi journey ở GOI-08 mục 9.1 phải xanh y như trước
  trên đúng SHA.
- Ghi đè `?exam_room=on` chỉ dùng được sau khi một spec trình lắp khung; spec này
  không có journey trên staging ngoài trang thử nằm trong test.

## Production

- Promote theo quy trình `staging` → `main` thường. Không có cờ nào bật trong spec
  này. Bật production cho từng trình chỉ khi anh Andy nói rõ cho trình đó (spec
  0067–0073).

## Rollback and repair

- Mức 1: bỏ trình khỏi `examRoomSurfaces` (phương án A: đổi biến trên Vercel rồi
  redeploy hoặc Instant Rollback; phương án B: tắt khoá trong `/admin/runtime-flags`,
  có hiệu lực trong khoảng 15 giây). Lượt đang làm tải lại sẽ về giao diện cũ với
  cùng dữ liệu server.
- Mức 2: revert PR trên `staging` rồi theo quy trình phát hành thường.
- Không có dữ liệu server cần sửa vì khung không ghi gì. Khoá `localStorage`
  `exam-room:*` bị bỏ lại là vô hại và tự hết hạn (FR-032).

## Observability

- Sự kiện `exam_room_*` qua `POST /api/analytics/events` (FR-033): đếm số lần mở hộp
  nộp, xác nhận, thoát còn câu chưa lưu, mất mạng, phiên hết hạn, tab khác theo
  `surface`.
- Lỗi khung hiện ở console và qua đường báo lỗi frontend hiện có; không có cảnh
  báo mới.
- Chủ: anh Andy.
