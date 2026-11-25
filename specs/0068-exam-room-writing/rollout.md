# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`.
- G08-T02…T05 (khung và thành phần) đã merge vào `staging`.
- Không migration, không đổi backend.

## Staging

1. Merge PR G08-T09 (cờ `writing` vẫn tắt): `verify-write-flows.mjs`,
   `verify-writing-admission-flow.mjs` và bộ test Writing xanh trên đúng SHA.
2. Bật `writing` trong `examRoomSurfaces` trên staging (phương án A của EXAMROOM-0066:
   biến `AVER_EXAM_ROOM_SURFACES` trên Vercel staging rồi redeploy).
3. Nghiệm thu bằng tài khoản QA với bài "QA TEST Task 2 – do not use": Scenario 1–7. Bài
   nộp thử được ghi vào PR để admin dọn; không gọi chấm AI trả phí ngoài một lần nộp thử
   (báo trước chi phí ước tính cho anh Andy).

## Production

- Anh Andy nói rõ cho bật Writing thì thêm `writing` vào cờ production.
- Giữ nhánh cờ tắt tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.
- Không nộp bài trên production bằng tài khoản thật.

## Rollback and repair

- Mức 1: bỏ `writing` khỏi cờ. Trình soạn mở lại theo giao diện cũ với cùng bản nháp
  server; bản sao tại máy vô hại (giao diện cũ không đọc).
- Mức 2: revert PR trên `staging` theo quy trình phát hành thường.
- Không có dữ liệu server cần sửa.

## Observability

- Sự kiện `exam_room_*` với `surface='writing'`, `exam_room_short_essay_warning`.
- Log hiện có của `submit` và `PATCH /draft` không đổi.
- Chủ: anh Andy.
