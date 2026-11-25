# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`.
- G08-T02…T05 và `AudioPlayer` (#2492) đã merge vào `staging`; G10 (tách router Listening) đã
  có trên `staging` (đã kiểm @ `cc6dd4c8`).
- Không migration. Route bỏ bài (T004) có `response_model` và `types/api.d.ts` đã sinh lại.

## Staging

1. Merge PR G08-T14 (cờ vẫn tắt): journey Listening test, React test và test đọc nguồn xanh
   trên đúng SHA.
2. Merge PR T004 (route bỏ bài); không cần migration.
3. Có dữ liệu nghiệm thu theo câu hỏi mở 3 (fixture tự động, và một đề thử trên staging nếu
   anh Andy cho). Không nhập đề lên staging khi anh chưa cho.
4. Bật cờ `listening` trong `examRoomSurfaces` trên staging, nghiệm thu Scenario 1–6 bằng tài
   khoản QA. Listening test không gọi AI trả phí.

## Production

- Chỉ khi anh Andy nói rõ, và chỉ sau một lần nghiệm thu thật trên staging (không chỉ fixture).
- Giữ nhánh cờ tắt tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.

## Rollback and repair

- Mức 1: bỏ `listening` khỏi `examRoomSurfaces`. Trình về giao diện cũ, cùng dữ liệu máy chủ;
  bản sao khoá mới vô hại và tự dọn sau 7 ngày.
- Mức 2: revert PR trên `staging` theo quy trình phát hành thường. Route bỏ bài có thể giữ
  (chỉ nhánh cờ bật gọi); lượt đã `abandoned` giữ nguyên, giống lượt bị bỏ khi bắt đầu lượt mới.
- Không có dữ liệu máy chủ cần sửa.

## Observability

- Sự kiện `exam_room_*` với `surface='listening'`.
- Theo dõi tỉ lệ lượt `abandoned` so với `submitted` theo tuần sau khi bật, và số lần nộp đi
  qua `unconfirmed`.
- Chủ: anh Andy.
