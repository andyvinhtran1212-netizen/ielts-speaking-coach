# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`.
- G08-T02, T03 (khung, hộp, thanh trên) đã merge vào `staging`.
- Không migration, không đổi backend.

## Staging

1. Merge PR G08-T20 (cờ vẫn tắt): ba journey Quick Check và test đọc nguồn xanh trên đúng SHA.
2. Bật cờ `drill` trong `examRoomSurfaces` trên staging, chỉ khi anh Andy gõ duyệt.
3. Nghiệm thu bằng tài khoản QA: Quick Check từ vựng và ngữ pháp, một bộ thẻ cá nhân, một bộ công
   khai chưa đăng nhập. Không gọi AI trả phí.

## Production

- Chỉ khi anh Andy nói rõ.
- Giữ nhánh cờ tắt tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.

## Rollback and repair

- Mức 1: bỏ `drill` khỏi `examRoomSurfaces`. Hai trang về giao diện cũ; outbox và đánh giá đã gửi
  không đổi; không có dữ liệu trình duyệt mới cần dọn.
- Mức 2: revert PR trên `staging` theo quy trình phát hành thường.
- Không có dữ liệu máy chủ cần sửa.

## Observability

- Sự kiện `exam_room_*` với `surface='drill'` và `kind`; theo dõi số lần "Vẫn thoát" khi còn câu
  chưa lưu và số hộp đăng nhập lại sau khi bật.
- Chủ: anh Andy.
