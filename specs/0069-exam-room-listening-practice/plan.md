# Implementation plan

## Architecture impact

- Frontend:
  - `programme-form-runner.tsx`: một chỗ rẽ nhánh `examRoomEnabled('listening-practice')`
    sau các hook; logic boot, hàng đợi lưu, `reveal`, `submit`, `controlOnce` ở lại file này
    và được truyền sang file vẽ mới. Nhánh mới thêm `{ noRedirect: true }` vào các lời gọi
    `window.api.*` và báo 401 lên khung.
  - File mới `programme-form-room.tsx` cạnh file trên: chỉ vẽ, dùng thành phần của khung
    (trạng thái lưu, hộp nộp, dải mất mạng, hộp đăng nhập lại, thông báo tab khác, dải câu,
    `exam-room/audio-player.tsx`). Không dùng thanh tập trung (bài không giờ).
  - `frontend/lib/listening-programme-answer-queue.mjs`: thêm hàm chuyển khoá bản nháp cũ
    sang khoá theo `ownerKey` (FR-009), có test `node --test`; không đổi hàng đợi.
  - `source-day.tsx`: không đổi ngoài việc runner tự chọn nhánh; `active` quyết định runner
    nào được mở hộp và giữ khoá.
- Backend: không đổi.

## Data and contracts

- Không migration, không route mới, không đổi shape. Mọi request giữ nguyên (xem `spec.md`
  Scope).
- Khoá trình duyệt theo EXAMROOM-0066 FR-032/FR-035 với `surface='listening-practice'`,
  `attemptKey=attemptId`, `ownerKey=userId`. Khoá cũ `listening-programme-draft:{attemptId}`
  chỉ được đọc một lần để chuyển rồi xoá.
- `baseSavedAt` mỗi câu: giờ ack của `PATCH .../answers` gần nhất mà runner biết; câu khôi
  phục từ `attempt.answers` lúc boot lấy mốc boot.

## UI and interaction

- Xem `ui-states.md`. Chế độ `practice`, tiếng Việt, "bạn". Thanh điều hướng bình thường
  của trang giữ nguyên.
- Bàn phím: phím cách phát/tạm dừng chỉ ở `policy='practice'` và khi tiêu điểm không ở ô
  nhập; bẫy tiêu điểm trong hộp; 390px dùng được.

## Work decomposition

1. G08-T11 (PR `high-risk`, frontend): nhánh mới sau cờ, FR-001…014, chuyển khoá bản nháp,
   journey cờ bật; chạy `verify-listening-programme-guided-flow.mjs` tại máy (không nằm
   trong CI) và ghi kết quả vào PR. Phụ thuộc EXAMROOM-0066 T001–T004 và `AudioPlayer`
   (#2492) trên `staging`.
2. Bật cờ trên staging, nghiệm thu, rồi production khi anh Andy nói rõ.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- React test mới `frontend/tests/react/programme-form-room.test.tsx`: hộp nộp còn/không câu
  trống, Esc không nộp, đang đối chiếu khoá nút, nộp lỗi giữ hộp, "Đã lưu lúc HH:MM",
  "Thử lưu lại", bài nghe một lần không có tạm dừng, chỉ runner `active` mở hộp.
- `node --test frontend/tests/listening-programme-draft-migrate.test.mjs`: chuyển khoá cũ,
  không đọc khoá của chủ khác.
- Playwright journey cờ bật trong `verify-listening-programme-context-flow.mjs` (thêm bước
  `clickIfPresent` cho nút xác nhận) và `verify-listening-programme-guided-flow.mjs` tại
  máy: `writes` giống hệt hai nhánh, `dialog` = 0.
- React test hiện có `listening-programme-form-scope.test.tsx`,
  `listening-programme-replay-stop.test.tsx`; test đọc nguồn
  `listening-programmes-next-behavior.test.mjs` (sửa và liệt kê test vỡ có chủ ý).
- `test:react`, `tsc --noEmit`, `npm run build`.
- Staging: Day 52 và một bài General "Vận dụng": nộp còn câu trống, Esc quay lại.
