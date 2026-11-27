# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`.
- G08-T02, T03 (khung, hộp, thanh tập trung) đã merge vào `staging`.
- Không migration, không đổi backend.

## Staging

1. Merge PR G08-T18 rồi G08-T19 (cờ vẫn tắt): journey Speaking, bộ regression và test đọc nguồn
   xanh trên đúng SHA.
2. Bật cờ `speaking` trong `examRoomSurfaces` trên staging.
3. Nghiệm thu bằng tài khoản QA và Chromium có micro giả. Gửi bản ghi gọi Whisper (OpenAI) và chấm
   Speaking (Claude, dự phòng Gemini) trả phí: báo anh Andy chi phí dự kiến theo nhà cung cấp
   trước khi chạy, và chi phí thật sau. Ưu tiên kiểm micro, ghi âm, hộp mà không gửi bản ghi khi
   không cần.

## Production

- Chỉ khi anh Andy nói rõ. Không ghi âm thử trên production.
- Giữ nhánh cờ tắt tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.

## Rollback and repair

- Mức 1: bỏ `speaking` khỏi `examRoomSurfaces`. Trang về giao diện cũ; `practice.js` không phát
  sự kiện mới; không có dữ liệu trình duyệt cần dọn.
- Mức 2: revert PR trên `staging` theo quy trình phát hành thường.
- Không có dữ liệu máy chủ cần sửa.

## Observability

- Sự kiện `exam_room_*` với `surface='speaking'`, gồm tên ca micro; theo dõi tỉ lệ `denied` và
  `not_found` sau khi bật.
- Chủ: anh Andy.
