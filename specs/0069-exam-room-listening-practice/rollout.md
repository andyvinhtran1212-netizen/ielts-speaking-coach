# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`; quyết định về tên cờ (câu hỏi mở 4): trước khi sửa đổi 1 mục (b) của 0066 lên `staging`, dùng `listening` theo FR-015 và chỉ bật khi EXAMLISTENT-0070 cũng sẵn sàng.
- G08-T02…T05 và `AudioPlayer` (#2492) đã merge vào `staging`.
- Không migration, không đổi backend.

## Staging

1. Merge PR G08-T11 (cờ vẫn tắt): journey context, React test và test đọc nguồn xanh trên
   đúng SHA; kết quả journey guided chạy tại máy ghi trong PR.
2. Bật cờ Listening luyện trong `examRoomSurfaces` trên staging (phương án A của 0066).
3. Nghiệm thu bằng tài khoản QA: Day 52 và một bài General "Vận dụng", Scenario 1–5. Không
   gọi AI trả phí (Listening luyện không chấm bằng AI).

## Production

- Anh Andy nói rõ thì bật trên production.
- Giữ nhánh cờ tắt tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.

## Rollback and repair

- Mức 1: bỏ cờ. Runner về giao diện cũ, cùng dữ liệu máy chủ; bản sao khoá mới vô hại.
  Khoá cũ chỉ bị xoá sau khi khoá mới đọc lại khớp hoặc máy chủ đã ack, nên câu chưa lưu trong bản sao không hiện ở
  giao diện cũ cho tới khi bật lại; câu đã ack vẫn ở máy chủ.
- Mức 2: revert PR trên `staging` theo quy trình phát hành thường.
- Không có dữ liệu máy chủ cần sửa.

## Observability

- Sự kiện `exam_room_*` với `surface='listening-practice'`.
- Chủ: anh Andy.
