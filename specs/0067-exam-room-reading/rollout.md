# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`.
- G08-T02…T05 (khung, dạng câu, Highlight/Note) đã merge vào `staging`.
- Không migration. Route bỏ bài (T003) có `response_model` và `types/api.d.ts` đã sinh lại.

## Staging

1. Merge PR T001/T002 (cờ `reading` vẫn tắt): bộ `reading-native`, write-flow
   `reading-exam-*`, `verify-mock-exam-flow.mjs` xanh trên đúng SHA.
2. Merge PR T003. Cờ tắt thì nút "Abandon test" không hiện; route có nhưng giao diện cũ
   không gọi.
3. Bật `reading` trong `examRoomSurfaces` trên staging (phương án A: biến
   `AVER_EXAM_ROOM_SURFACES` trên Vercel staging rồi redeploy; phương án B: khoá
   `exam_room.reading` trong `runtime_flags` staging).
4. Nghiệm thu theo GOI-08 mục 9 bằng tài khoản QA: Scenario 1–6 và 8 của `spec.md`, đề
   AVR-READ-001; ghi lượt đã làm vào PR để admin dọn.

## Production

- Anh Andy nói rõ cho bật Reading thì bật `reading` trên production.
- Giữ nhánh cờ tắt (trình hiện tại) tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.
- Không làm đề hay nộp bài trên production bằng tài khoản thật.

## Rollback and repair

- Mức 1: bỏ `reading` khỏi cờ. Lượt đang làm tải lại về giao diện cũ, cùng dữ liệu server,
  không mất câu trả lời.
- Mức 2: revert PR trên `staging` theo quy trình phát hành thường. Revert route bỏ bài
  không làm hỏng dữ liệu: lượt đã `abandoned` giữ nguyên, giống lượt bị bỏ khi bắt đầu
  lượt mới hôm nay.
- Không có dữ liệu server cần sửa. Khoá `exam-room:*` ở trình duyệt vô hại.

## Observability

- Sự kiện `exam_room_*` với `surface='reading'`.
- Log backend của route bỏ bài ghi `attempt_id` và kết quả (không email).
- Theo dõi tỉ lệ lượt `abandoned` so với `submitted` theo tuần sau khi bật.
- Chủ: anh Andy.
