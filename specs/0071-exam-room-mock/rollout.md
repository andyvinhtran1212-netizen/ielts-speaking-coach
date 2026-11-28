# Rollout and rollback

## Preconditions

- EXAMROOM-0066 và spec này `approved` trên `staging`.
- G08-T02…T05, EXAMREAD-0067 T001 và EXAMLISTENT-0070 T002 (chế độ nhúng của trang con) đã merge
  vào `staging`.
- G08-T16 không migration, không đổi backend. G08-T22 chỉ bắt đầu khi G09-T31 (MOCKORG-0086) đã
  lên `staging`.

## Staging

1. Merge PR G08-T16 (cờ vẫn tắt): `verify-mock-exam-flow.mjs`, React test và test đọc nguồn
   xanh trên đúng SHA; kết quả chạy tay ghi trong PR.
2. Bật cờ `mock` trong `examRoomSurfaces` trên staging. Chỉ bật khi `reading` và `listening`
   cũng đã bật trên staging (trang con nhúng phải có chế độ nhúng của khung).
3. Nghiệm thu bằng fixture; thử tay khi admin mở được một kỳ cho tài khoản QA. Kỳ được giao
   không trừ lượt (FR-015); phần Writing có chấm AI tự động khi nộp (`submit_section`), nên
   báo anh Andy chi phí dự kiến theo nhà cung cấp trước khi nộp một bài Writing thử, và chi phí
   thật sau đó.
4. G08-T22: merge PR backend (cờ `mock_exam_audiences_learner` tắt), rồi PR frontend. Thứ tự
   áp 445, triển khai backend tương thích rồi áp 446 theo [điều kiện mở cổng học viên](../0086-mock-exam-organisation/rollout.md#phạm-vi-môn-của-học-viên).
   Sau khi đủ điều kiện bật cờ trên staging, nghiệm thu `self_paced` với kỳ QA do G09 tạo cho hai lớp thử.

## Production

- Chỉ khi anh Andy nói rõ, sau một lần nghiệm thu thật trên staging.
- Không bật `mock` trên production trước `reading` và `listening`.
- Giữ nhánh cờ tắt tới khi anh nghiệm thu; gỡ nhánh cũ là G08-T21.

## Rollback and repair

- Mức 1: bỏ `mock` khỏi `examRoomSurfaces`. Runner về giao diện cũ, cùng dữ liệu máy chủ. Bản
  sao khoá mới không được nhánh cũ đọc: khoá cũ chỉ bị xoá sau khi khoá mới đọc lại khớp hoặc
  máy chủ đã ack, nên chữ chưa ack vẫn ở khoá cũ hoặc ở máy chủ.
- Mức 2: tắt `mock_exam_audiences_learner` (đường `cohort_id` cũ), hoặc revert PR trên
  `staging` theo quy trình phát hành thường.
- Không có dữ liệu máy chủ cần sửa ở G08-T16.

## Observability

- Sự kiện `exam_room_*` với `surface='mock'`; số lần `unconfirmed`, `closed_unconfirmed` theo
  phần.
- Chủ: anh Andy.
