# Implementation plan

## Architecture impact

- Frontend:
  - `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx`:
    thêm một chỗ rẽ nhánh `examRoomEnabled('reading')` sau các hook; truyền state và hàm
    sang file vẽ mới; trong nhánh mới, lời gọi boot của lượt có tài khoản truyền
    `{ noRedirect: true }`, 401 báo lên khung.
  - File mới `reading-exam-room.tsx` cạnh file trên: chỉ vẽ, dựng trên `ExamRoomShell`
    (EXAMROOM-0066), dạng câu, Highlight/Note của khung.
  - Không sửa layout `(authed-reading-player)/layout.tsx` hay `pageStylesheets`; CSS của
    khung có gốc `[data-exam-room]` nên không bị `reading-exam*.css` đè.
- Backend (chỉ cho FR-012, PR riêng G08-T23):
  - `backend/routers/reading_student.py`: `POST /api/reading/test/attempts/{attempt_id}/abandon`,
    `response_model` cụ thể, xác thực như `submit` (chủ lượt), từ chối lượt gắn
    `sitting_id`, `class_item` hoặc lượt khách. Handler gọi
    `await _learner_write(await _attempt_write_keys(attempt_id, user, None), _abandon_reading_test_attempt_sync, ...)`
    như `submit`; thân `_sync` đọc lại lượt dưới khoá.
  - `_fetch_in_progress_payload` thêm `submit_deadline_passed: bool` (cùng phép so với
    `_SUBMIT_GRACE_SECONDS` của `submit`); sinh lại type. Trường thêm, không đổi trường cũ.
  - Sinh lại `frontend/types/api.d.ts`.

## Data and contracts

- Không migration: `reading_test_attempts.status` đã cho `abandoned` (mig 087).
- Route bỏ bài:
  - Request: không body.
  - 200 `{ "attempt_id": uuid, "status": "abandoned" }` (cả khi gọi lại lượt đã bỏ).
  - 404 khi không phải chủ lượt hoặc không có lượt; 409 `{ "reason": "already_submitted" }`
    khi đã nộp; 409 `{ "reason": "not_self_selected" }` khi lượt gắn sitting hay bài giao;
    409 `{ "reason": "time_expired" }` khi đã hết giờ (không hứa lượt được tự nộp).
  - Một câu UPDATE có điều kiện, như `submit` (L1663): `.eq("id")`, chủ lượt,
    `.eq("status", "in_progress")`, `sitting_id IS NULL`, không bài giao, không khách,
    `.gt("resume_expires_at", now_ghi)`, `.gt("started_at", now_ghi - time_limit)`; `now_ghi`
    lấy ngay trước câu UPDATE. Không có dòng nào đổi thì đọc lại để chọn 200/409.
- Mọi chỗ đọc kết quả, lịch sử, Tiến độ của Reading phải chỉ lấy `submitted`; PR backend
  liệt kê từng chỗ đã kiểm và thêm test cho lượt `abandoned`.
- Mọi request khác giữ nguyên. `renderer_affinity` vẫn `next`.
- Khoá trình duyệt theo EXAMROOM-0066 FR-032 với `surface='reading'`, `attemptKey=attempt_id`.

## UI and interaction

- Xem `ui-states.md`. Chế độ `test`, chuỗi tiếng Anh, full test luôn sáng.
- Bàn phím và giảm chuyển động theo khung. Bề rộng 1280/768/390; full test dưới 768px là
  màn chặn.

## Work decomposition

1. G08-T07 (PR `high-risk`, frontend): nhánh mới sau cờ, FR-001…011, 013…020; test
   `frontend/tests/reading-native/exam-room.spec.js` chạy với `?exam_room=on`.
2. G08-T23 phần Reading (PR `high-risk`, backend + nút): route bỏ bài, nút "Abandon test",
   test pytest và journey. Sau PR 1.
3. Bật cờ `reading` trên staging, nghiệm thu, rồi production khi anh Andy nói rõ.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- `npx playwright test -c frontend/playwright.reading-native.config.js`: bộ cũ (cờ tắt) và
  `exam-room.spec.js` (cờ bật): kéo tay nắm, tải lại giữ tỉ lệ, nộp còn câu trống, offline →
  online, hết giờ khi đang gõ (`page.clock`), hai tab, 401 giữa bài, `dialog` = 0.
- `node frontend/tooling/verify-write-flows.mjs` với luồng `reading-exam-*`: danh sách
  `writes` giống hệt ở hai nhánh cờ.
- `node frontend/tooling/verify-mock-exam-flow.mjs`: `mock-flush` vẫn được trả lời.
- Bộ hợp đồng frontend, `test:react`, `tsc --noEmit`, `npm run build`.
- Pytest route bỏ bài: chủ lượt, người khác (404), đã nộp (409), gắn sitting/bài giao (409),
  hết giờ (409), request bắt đầu trước hạn nhưng ghi sau hạn (409, giả `now`), nộp và bỏ
  đồng thời (đúng một bên thắng), gọi lại (200 cùng kết quả), lượt bỏ không có trong kết
  quả, lịch sử, Tiến độ.
- Playwright: đề có mật khẩu (`dialog` = 0); offline qua ân hạn → 422 → màn
  `expired_unsubmitted`; offline trong ân hạn → nộp được.
- Staging: tài khoản QA làm đề AVR-READ-001 tới khi nộp ở cả hai nhánh, so kết quả.
- Ảnh 1280/768/390 đối chiếu tờ `PhongThi` (390 của full test là màn chặn).
