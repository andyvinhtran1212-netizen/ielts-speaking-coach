# Implementation plan

## Architecture impact

- Frontend:
  - `frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx`:
    một chỗ rẽ nhánh `examRoomEnabled('listening')` sau các hook. Logic boot, hàng đợi lưu
    (`createListeningSaveCoordinator`), cờ xem lại, nộp (`coreOperationRequest`), khoá
    renderer, `MockHook`, `mock-flush` ở lại file này. Nhánh mới chỉ thêm
    `{ noRedirect: true }` vào các lời gọi `window.api.*` còn thiếu và đổi cách xử lý lỗi
    nộp: không `setPhase('error')`, mà đưa `submit.outcome` cho khung (FR-010).
  - File mới `listening-test-room.tsx` cạnh file trên: chỉ vẽ, dựng trên `ExamRoomShell`
    (EXAMROOM-0066), dạng câu dùng chung, `exam-room/audio-player.tsx`.
  - `frontend/lib/listening-test-controller.mjs`: hàm thuần mới `listeningAudioPolicy(test,
    context)` trả `'test' | 'practice'` theo FR-006, và `listeningSubmitOutcome(result)` suy
    trạng thái FR-034 từ kết quả `coreOperationRequest`; test `node --test`. Hàm cũ không đổi.
  - Không sửa layout `(authed-listening-player)/layout.tsx` hay `pageStylesheets`; CSS của
    khung có gốc `[data-exam-room]`.
- Backend (chỉ FR-012, PR riêng G08-T23 phần Listening):
  - `backend/routers/listening/attempts.py`: `POST /api/listening/tests/attempts/{attempt_id}/abandon`,
    `response_model` cụ thể, xác thực như `submit` (`_require_auth`, chủ lượt qua
    `_fetch_attempt_or_404`).
  - Sinh lại `frontend/types/api.d.ts`.

## Data and contracts

- Không migration: `listening_test_attempts.status` đã cho `abandoned` (đường bắt đầu lượt mới
  đã ghi giá trị này ở `attempts.py` L530).
- Route bỏ bài:
  - Request: không body.
  - 200 `{ "attempt_id": uuid, "status": "abandoned" }` (cả khi gọi lại lượt đã bỏ).
  - 404 khi không phải chủ hoặc không có lượt; 409 `{ "reason": "already_submitted" }`;
    409 `{ "reason": "not_self_selected" }` khi gắn `mock_sitting_id` hay bài giao;
    409 `{ "reason": "resume_expired" }` khi quá `resume_expires_at`.
  - Một câu UPDATE có điều kiện: `.eq("id")`, `.eq("user_id")`, `.eq("status", "in_progress")`,
    `.is_("mock_sitting_id", "null")`, `.is_("class_assignment_item_id", "null")`,
    `.gt("resume_expires_at", now_ghi)`; `now_ghi` lấy ngay trước câu UPDATE. Không dòng nào
    đổi thì đọc lại để chọn 200/404/409.
- Mọi chỗ đọc kết quả, lịch sử, Tiến độ của Listening test phải chỉ lấy `submitted`; PR
  backend liệt kê từng chỗ đã kiểm và thêm test cho lượt `abandoned` ở ba chỗ đó.
- Khoá trình duyệt theo EXAMROOM-0066 FR-032/FR-035 với `surface='listening'`,
  `attemptKey=attemptId`, `ownerKey=user.id`.
- Mọi request khác giữ nguyên. `renderer_affinity` vẫn `next`.

## UI and interaction

- Xem `ui-states.md`. Chế độ `test`, chuỗi tiếng Anh, full test luôn sáng.
- Bàn phím và giảm chuyển động theo khung; phím cách chỉ ở `policy='practice'`.
- Bề rộng 1280/768/390; full test dưới 768px là màn chặn (PHONEGATE-0081, dự phòng theo 0066
  FR-024).

## Work decomposition

1. G08-T14 (PR `high-risk`, frontend, sau G10): hàm thuần, nhánh mới sau cờ FR-001…011,
   013…019, journey cờ bật trong `verify-listening-test-session-flow.mjs`. Phụ thuộc
   EXAMROOM-0066 T001–T004 và `AudioPlayer` (#2492) trên `staging`.
2. G08-T23 phần Listening (PR backend + frontend nhỏ): route bỏ bài FR-012, sinh lại type,
   nút "Abandon test".
3. Bật cờ trên staging sau khi có dữ liệu nghiệm thu (câu hỏi mở 3), rồi production khi anh
   Andy nói rõ.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- `node --test frontend/tests/listening-test-room-model.test.mjs`: `listeningAudioPolicy`
  (full, mini, drill, practice, bài giao kiểu full, sitting), `listeningSubmitOutcome`
  (ack khớp, biên nhận `sealed`, đọc lại `submitted`, offline, 401, mất phản hồi, 409).
- React test `frontend/tests/react/listening-test-room.test.tsx`: thanh trên không email,
  "Part i of n", hộp "Start a new attempt", hộp nộp còn câu trống và câu chưa lưu, nộp lỗi ở
  lại trong bài, lối thoát, nút bỏ bài chỉ ở đề tự chọn, hộp không hứa giữ bản khi đọc lại
  không khớp.
- Playwright: thêm bước cờ bật vào `verify-listening-test-session-flow.mjs` và
  `verify-listening-player-overflow-flow.mjs` (fixture hiện có); `writes` giống hệt hai nhánh,
  `dialog` = 0.
- So chuỗi đáp án dạng câu dùng chung với trình hiện tại trên fixture hiện có (FR-008).
- pytest `backend/tests/test_listening_abandon_attempt.py`: các nhánh 200/404/409, đua với
  `submit`, lượt bỏ không vào kết quả/lịch sử/Tiến độ.
- Test đọc nguồn hiện có (`listening-test-native-controller.test.mjs`,
  `core-operation-integration`, `mock-exam-next-*`): sửa và liệt kê test vỡ có chủ ý.
- `test:react`, `tsc --noEmit`, `npm run build`, bộ hợp đồng frontend.
